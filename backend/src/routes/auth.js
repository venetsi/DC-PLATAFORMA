import jwt from 'jsonwebtoken'

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

    const { email, nombre, id_departamento, departamento_slug, departamentos } = payload

    const usuario = await fastify.db.extUser.upsert({
      where: { email },
      create: { id: payload.id_user ?? email, email, nombre, id_departamento },
      update: { nombre, id_departamento }
    })

    // Admin global: el ticket trae el catalogo completo de departamentos --
    // sync perezoso de cada uno que todavia no exista localmente.
    if (Array.isArray(departamentos)) {
      for (const d of departamentos) {
        await fastify.db.departamento.upsert({
          where: { id: d.id },
          create: { id: d.id, nombre: d.nombre, slug: d.slug ?? d.nombre.toLowerCase() },
          update: { nombre: d.nombre }
        })
      }
    } else if (id_departamento && departamento_slug) {
      await fastify.db.departamento.upsert({
        where: { id: id_departamento },
        create: { id: id_departamento, nombre: departamento_slug, slug: departamento_slug },
        update: {}
      })
    }

    const token = signSession(fastify, usuario)
    reply.setCookie('dc_plataforma_token', token, { path: '/', httpOnly: true, sameSite: 'lax' })
    return { token }
  })

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    if (!usuario) return reply.code(404).send({ error: 'Usuario no encontrado' })

    const departamento = usuario.id_departamento
      ? await fastify.db.departamento.findUnique({ where: { id: usuario.id_departamento } })
      : null

    return {
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      departamento,
      // Dev-only: en Fase 8 esto se resuelve leyendo el rol super_admin/dcsmart del ticket.
      esAdminGlobal: usuario.email === DEV_ADMIN_EMAIL
    }
  })

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('dc_plataforma_token', { path: '/' })
    return { ok: true }
  })
}
