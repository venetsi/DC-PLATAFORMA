import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { asegurarDepartamento, sincronizarMembresiaGroup } from '../lib/departamentos.js'
import { resolverDepartamento } from '../lib/departamento-alias.js'
import { esAdminGlobal } from '../lib/permisos.js'

// Dominios habilitados para entrar via SSO real -- despues de esto, dcsmart
// ya filtro con sus propias politicas de usuario (activo, rol, etc.); esto
// es una segunda barrera para que ningun ticket con un dominio ajeno entre,
// aunque el JWT este bien firmado.
const DOMINIOS_PERMITIDOS = ['dcsmart.app', 'venetsi.com', 'dcmanagement.com.ar']

function dominioPermitido(email) {
  const dominio = String(email || '').split('@')[1]?.toLowerCase()
  return DOMINIOS_PERMITIDOS.includes(dominio)
}

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

    // Mientras el SSO real de dcsmart no esta activo, esta URL puede tener
    // acceso publico -- sin este chequeo, saber CUALQUIER email de ExtUser
    // (varios circularon en texto plano durante el desarrollo) alcanzaria
    // para entrar sin contraseña. DEV_LOGIN_ALLOWLIST son los unicos emails
    // habilitados; vacio/sin setear = nadie (fail-closed).
    const permitidos = String(process.env.DEV_LOGIN_ALLOWLIST || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean)
    if (!permitidos.includes(email)) {
      return reply.code(404).send({ error: 'No encontrado' })
    }

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

    const { email, nombre, departamento: departamentoRaw, es_super_admin, locales } = payload

    if (!dominioPermitido(email)) {
      return reply.code(403).send({ error: 'Este dominio de email no tiene acceso a DC-PLATAFORMA' })
    }

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

    // El ticket manda el catalogo COMPLETO de locales activos de dcsmart (no
    // acotado al departamento de quien pidio el ticket) -- por eso, ademas de
    // upsertear cada uno, tratamos la ausencia de un id como "se desactivo del
    // lado de dcsmart" y lo reflejamos aca. Si el ticket todavia no manda
    // locales (version vieja del lado de dcsmart), no tocamos nada.
    if (Array.isArray(locales) && locales.length) {
      await Promise.all(
        locales.map((local) =>
          fastify.db.extLocal.upsert({
            where: { id: local.id },
            create: { id: local.id, nombre: local.nombre, grupo: local.grupo ?? null, activo: true },
            update: { nombre: local.nombre, grupo: local.grupo ?? null, activo: true, synced_at: new Date() }
          })
        )
      )
      await fastify.db.extLocal.updateMany({
        where: { activo: true, id: { notIn: locales.map((local) => local.id) } },
        data: { activo: false }
      })
    }

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
      // (lib/permisos.js) sigue andando para el login temporal de dev.
      esAdminGlobal: esAdminGlobal(usuario)
    }
  })

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('dc_plataforma_token', { path: '/' })
    return { ok: true }
  })
}
