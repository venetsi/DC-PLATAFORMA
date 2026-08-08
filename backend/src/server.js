import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import 'dotenv/config'

import dbPlugin from './plugins/db.js'
import gcalPlugin from './plugins/gcal.js'
import groupsPlugin from './plugins/groups.js'
import authRoutes from './routes/auth.js'
import departamentosRoutes from './routes/departamentos.js'
import localesRoutes from './routes/locales.js'
import tareasRoutes from './routes/tareas.js'
import asignacionesRoutes from './routes/asignaciones.js'
import instanciasRoutes from './routes/instancias.js'
import reportesRoutes from './routes/reportes.js'
import tvRoutes from './routes/tv.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: process.env.FRONTEND_URL, credentials: true })
await app.register(cookie)
await app.register(jwt, {
  secret: process.env.JWT_SECRET,
  cookie: { cookieName: 'dc_plataforma_token', signed: false }
})
await app.register(dbPlugin)
await app.register(gcalPlugin)
await app.register(groupsPlugin)

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.code(401).send({ error: 'No autenticado' })
  }
})

// Admin global (super_admin/dcsmart via ticket en Fase 8; DEV_ADMIN_EMAIL en dev-login).
app.decorate('requireAdminGlobal', async (request, reply) => {
  const usuario = await app.db.extUser.findUnique({ where: { id: request.user.id } })
  const esAdmin = usuario?.email === 'admin@dcsmart.app' // TODO Fase 8: leer rol real del ticket
  if (!esAdmin) reply.code(403).send({ error: 'Requiere admin global' })
})

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(departamentosRoutes, { prefix: '/api/departamentos' })
await app.register(localesRoutes, { prefix: '/api/locales' })
await app.register(tareasRoutes, { prefix: '/api/tareas' })
await app.register(asignacionesRoutes, { prefix: '/api/asignaciones' })
await app.register(instanciasRoutes, { prefix: '/api/instancias' })
await app.register(reportesRoutes, { prefix: '/api/reportes' })
await app.register(tvRoutes, { prefix: '/api/tv' })

try {
  await app.listen({ port: process.env.PORT || 3100, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
