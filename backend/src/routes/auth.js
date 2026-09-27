import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { asegurarDepartamento } from '../lib/departamentos.js'
import { resolverDepartamento } from '../lib/departamento-alias.js'
import { esAdminGlobal, conPermisos, departamentosDe, fuenteMembresia } from '../lib/permisos.js'

// Dominios habilitados para entrar via SSO real -- despues de esto, dcsmart
// ya filtro con sus propias politicas de usuario (activo, rol, etc.); esto
// es una segunda barrera para que ningun ticket con un dominio ajeno entre,
// aunque el JWT este bien firmado.
const DOMINIOS_PERMITIDOS = ['dcsmart.app', 'venetsi.com', 'dcmanagement.com.ar']

function dominioPermitido(email) {
  const dominio = String(email || '').split('@')[1]?.toLowerCase()
  return DOMINIOS_PERMITIDOS.includes(dominio)
}

const clienteGoogle = new OAuth2Client()

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

    const { email: emailRaw, nombre, departamento: departamentoRaw, es_super_admin, locales } = payload
    // Normalizado igual que en dev-login: ExtUser.email es @unique, asi que
    // sin esto dos variantes de mayusculas del mismo email crearian dos
    // usuarios distintos -- y las comparaciones por responsable (asignado_a)
    // fallarian justo para quien entra por SSO real.
    const email = String(emailRaw || '').toLowerCase().trim()

    if (!dominioPermitido(email)) {
      return reply.code(403).send({ error: 'Este dominio de email no tiene acceso a DC-PLATAFORMA' })
    }

    // Con Groups como fuente de verdad, dcsmart deja de ser el gate de acceso:
    // el ticket es valido y el dominio esta permitido, pero si la persona no
    // esta en ningun grupo depto-* activo no entra a Tareas -- mismo criterio
    // que /google, para que no haya una puerta mas laxa que la otra. Se deja
    // pasar si el ticket trae es_super_admin (admin de dcsmart) o si ya es
    // admin global de esta plataforma, para no bloquear a un admin real que
    // todavia no este cargado en ningun grupo.
    if (fuenteMembresia(email) === 'groups') {
      const [membresias, existente] = await Promise.all([
        fastify.db.membresiaDepartamento.findMany({ where: { email, departamento: { activo: true } } }),
        fastify.db.extUser.findUnique({ where: { email } })
      ])
      if (!membresias.length && !es_super_admin && !existente?.es_admin_global) {
        return reply.code(403).send({
          error: 'Tu cuenta no está en ningún grupo de departamento. Pedí que te agreguen al grupo depto-<área>@dcsmart.app.'
        })
      }
    }

    // dcsmart no tiene tabla de departamentos propia (es un texto libre en
    // users.departamento) -- se resuelve contra el catalogo real de acá antes
    // de guardar nada, para no heredar mayusculas/nombres sueltos de dcsmart.
    // asegurarDepartamento devuelve la fila EXISTENTE si el slug ya existe
    // (ignora el id/nombre pasados), y solo los usa si es un departamento
    // nuevo que nunca se vio -- por eso da igual que acá no exista un id
    // estable del lado de dcsmart, se genera uno nuevo solo si hace falta.
    const resuelto = resolverDepartamento(departamentoRaw)
    // Con Groups como fuente de verdad, el texto de dcsmart ya no decide nada: se
    // guarda solo como dato heredado y nunca crea un departamento nuevo (un error
    // de tipeo en dcsmart generaba un Calendar y un Group reales).
    const departamento = !resuelto
      ? null
      : fuenteMembresia(email) === 'groups'
        ? await fastify.db.departamento.findUnique({ where: { slug: resuelto.slug } })
        : await asegurarDepartamento(fastify, { id: randomUUID(), nombre: resuelto.nombre, slug: resuelto.slug })

    const usuario = await fastify.db.extUser.upsert({
      where: { email },
      create: { id: payload.id_user ?? email, email, nombre, id_departamento: departamento?.id ?? null, es_admin_global: !!es_super_admin },
      update: { nombre, id_departamento: departamento?.id ?? null, es_admin_global: !!es_super_admin }
    })

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

  // --- Entrar con Google ---
  // Todos usan Google Workspace, y con los Groups como fuente de verdad hay
  // miembros que no tienen usuario en dcsmart (y por lo tanto no pueden entrar
  // por el SSO de arriba). Se verifica el ID token de Google Identity Services.
  fastify.post('/google', async (request, reply) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    if (!clientId) return reply.code(501).send({ error: 'Entrar con Google todavía no está configurado' })
    const { credential } = request.body || {}
    if (!credential) return reply.code(400).send({ error: 'credential requerido' })

    let payload
    try {
      const ticket = await clienteGoogle.verifyIdToken({ idToken: credential, audience: clientId })
      payload = ticket.getPayload()
    } catch {
      return reply.code(401).send({ error: 'No se pudo verificar la cuenta de Google' })
    }

    const email = String(payload?.email || '').toLowerCase().trim()
    if (!email || !payload.email_verified) return reply.code(401).send({ error: 'La cuenta de Google no tiene un email verificado' })
    if (!dominioPermitido(email)) {
      return reply.code(403).send({ error: 'Esta cuenta no tiene acceso a DC-PLATAFORMA' })
    }

    let usuario = await fastify.db.extUser.findUnique({ where: { email } })
    if (fuenteMembresia(email) === 'groups') {
      // Entra quien esta en algun grupo depto-* (o es admin de emergencia).
      const membresias = await fastify.db.membresiaDepartamento.findMany({ where: { email, departamento: { activo: true } } })
      if (!membresias.length && !usuario?.es_admin_global) {
        return reply.code(403).send({ error: 'Tu cuenta no está en ningún grupo de departamento. Pedí que te agreguen al grupo depto-<área>@dcsmart.app.' })
      }
      if (!usuario) {
        usuario = await fastify.db.extUser.create({
          data: { id: email, email, nombre: payload.name || email.split('@')[0], id_departamento: membresias[0]?.id_departamento ?? null, activo: true }
        })
      }
    }
    if (!usuario?.activo) {
      return reply.code(403).send({ error: 'Tu cuenta todavía no tiene acceso. Entrá una vez desde dcsmart → Tareas o pedí acceso a un administrador.' })
    }

    const token = signSession(fastify, usuario)
    reply.setCookie('dc_plataforma_token', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true })
    return { token }
  })

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await conPermisos(fastify.db, await fastify.db.extUser.findUnique({ where: { id: request.user.id } }))
    if (!usuario) return reply.code(404).send({ error: 'Usuario no encontrado' })

    // select acotado a proposito -- Departamento tambien guarda kiosko_key y
    // chat_webhook_url (secretos), que no tienen nada que hacer en una
    // respuesta que llega al navegador del usuario.
    const departamentos = await fastify.db.departamento.findMany({
      where: { id: { in: departamentosDe(usuario) }, activo: true },
      select: { id: true, nombre: true, slug: true, id_calendar_google: true },
      orderBy: { nombre: 'asc' }
    })

    return {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      // `departamento` (el principal) se mantiene para las pantallas que
      // todavia trabajan con uno solo; `departamentos` trae todos.
      departamento: departamentos[0] || null,
      departamentos,
      esDireccion: !!usuario.esDireccion,
      esAdminGlobal: esAdminGlobal(usuario)
    }
  })

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('dc_plataforma_token', { path: '/' })
    return { ok: true }
  })
}
