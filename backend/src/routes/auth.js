import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { asegurarDepartamento, sincronizarMembresiaGroup } from '../lib/departamentos.js'
import { resolverDepartamento } from '../lib/departamento-alias.js'

// Email de dev que actua como admin global (equivalente a super_admin/dcsmart
// una vez migrado al ticket real en Fase 8). Solo tiene efecto con
// ALLOW_DEV_LOGIN=true -- nunca usar este mecanismo en produccion.
const DEV_ADMIN_EMAIL = 'admin@dcsmart.app'

function signSession(fastify, { id, email, nombre }) {
  return fastify.jwt.sign({ id, email, nombre }, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' })
}

export default async function authRoutes(fastify) {
  // --- Login temporal de desarrollo (Fase 2-7) ---
  // Se reemplaza en Fase 8 por el canje real del ticket SSO de dcsmart.
  // Gateado por ALLOW_DEV_LOGIN para que nunca quede expuesto por accidente.
  fastify.post('/dev-login', async (request, reply) => {
    if (process.env.ALLOW_DEV_LOGIN !== 'true') {
      return reply.code(404).send({ error: 'No encontrado' })
    }
    const email = String(request.body?.email || '').toLowerCase().trim()
    if (!email) return reply.code(400).send({ error: 'email requerido' })

    const usuario = await fastify.db.extUser.findUnique({ where: { email } })
    if (!usuario) {
      return reply.code(404).send({
        error: `No existe ExtUser con email ${email} -- sembrar con prisma/seed.js primero`
      })
    }

    await sincronizarMembresiaGroup(fastify, usuario)

    const token = signSession(fastify, usuario)
    reply.setCookie('dc_plataforma_token', token, { path: '/', httpOnly: true, sameSite: 'lax' })
    return { token }
  })

  // --- SSO real con dcsmart (Fase 8) ---
  // Canjea el ticket firmado por dcsmart (POST /api/auth/tareas-ticket) por
  // una sesion propia. Mismo patron que costos-ticket/analytics-ticket: JWT
  // corto (60s), firmado con INTERNAL_SHARED_SECRET, nunca comparte JWT_SECRET.
  fastify.post('/sso', async (request, reply) => {
    if (!process.env.INTERNAL_SHARED_SECRET) {
      return reply.code(501).send({ error: 'SSO con dcsmart todavia no configurado (Fase 8)' })
    }
    const { ticket } = request.body || {}
    if (!ticket) return reply.code(400).send({ error: 'ticket requerido' })

    let payload
    try {
      payload = jwt.verify(ticket, process.env.INTERNAL_SHARED_SECRET, {
        issuer: 'dcsmart-gestion',
        audience: 'dc-plataforma'
      })
    } catch {
      return reply.code(401).send({ error: 'Ticket invalido o expirado' })
    }

    const { email, nombre, departamento: departamentoRaw, es_super_admin } = payload

    // dcsmart no tiene tabla de departamentos propia (es un texto libre en
    // users.departamento) -- se resuelve contra el catalogo real de acá antes
    // de guardar nada, para no heredar mayusculas/nombres sueltos de dcsmart.
    // asegurarDepartamento devuelve la fila EXISTENTE si el slug ya existe
    // (ignora el id/nombre pasados), y solo los usa si es un departamento
    // nuevo que nunca se vio -- por eso da igual que acá no exista un id
    // estable del lado de dcsmart, se genera uno nuevo solo si hace falta.
    const resuelto = resolverDepartamento(departamentoRaw)
    const departamento = resuelto
      ? await asegurarDepartamento(fastify, { id: randomUUID(), nombre: resuelto.nombre, slug: resuelto.slug })
      : null

    const usuario = await fastify.db.extUser.upsert({
      where: { email },
      create: { id: payload.id_user ?? email, email, nombre, id_departamento: departamento?.id ?? null, es_admin_global: !!es_super_admin },
      update: { nombre, id_departamento: departamento?.id ?? null, es_admin_global: !!es_super_admin }
    })

    await sincronizarMembresiaGroup(fastify, usuario)

    const token = signSession(fastify, usuario)
    reply.setCookie('dc_plataforma_token', token, { path: '/', httpOnly: true, sameSite: 'lax' })
    return { token }
  })

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    if (!usuario) return reply.code(404).send({ error: 'Usuario no encontrado' })

    // select acotado a proposito -- Departamento tambien guarda kiosko_key y
    // chat_webhook_url (secretos), que no tienen nada que hacer en una
    // respuesta que llega al navegador del usuario.
    const departamento = usuario.id_departamento
      ? await fastify.db.departamento.findUnique({
          where: { id: usuario.id_departamento },
          select: { id: true, nombre: true, slug: true, id_calendar_google: true }
        })
      : null

    return {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      departamento,
      // es_admin_global viene del ticket SSO real (Fase 8); el email hardcodeado
      // sigue andando para el login temporal de dev, que nunca lo setea.
      esAdminGlobal: usuario.es_admin_global || usuario.email === DEV_ADMIN_EMAIL
    }
  })

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('dc_plataforma_token', { path: '/' })
    return { ok: true }
  })
}
