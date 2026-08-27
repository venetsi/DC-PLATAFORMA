import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import 'dotenv/config'

import dbPlugin from './plugins/db.js'
import gcalPlugin from './plugins/gcal.js'
import groupsPlugin from './plugins/groups.js'
import bigqueryPlugin from './plugins/bigquery.js'
import authRoutes from './routes/auth.js'
import departamentosRoutes from './routes/departamentos.js'
import localesRoutes from './routes/locales.js'
import usuariosRoutes from './routes/usuarios.js'
import tareasRoutes from './routes/tareas.js'
import asignacionesRoutes from './routes/asignaciones.js'
import dependenciasRoutes from './routes/dependencias.js'
import instanciasRoutes from './routes/instancias.js'
import reportesRoutes from './routes/reportes.js'
import tvRoutes from './routes/tv.js'
import chatRoutes from './routes/chat.js'
import { esAdminGlobal } from './lib/permisos.js'

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
await app.register(bigqueryPlugin)

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.code(401).send({ error: 'No autenticado' })
  }
})

// Admin global: es_admin_global viene del ticket SSO real (rol super_admin/
// dcsmart, Fase 8); el email hardcodeado (lib/permisos.js) sigue andando
// para el login temporal de dev, que nunca setea esa columna.
app.decorate('requireAdminGlobal', async (request, reply) => {
  const usuario = await app.db.extUser.findUnique({ where: { id: request.user.id } })
  if (!esAdminGlobal(usuario)) reply.code(403).send({ error: 'Requiere admin global' })
})

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(departamentosRoutes, { prefix: '/api/departamentos' })
await app.register(localesRoutes, { prefix: '/api/locales' })
await app.register(usuariosRoutes, { prefix: '/api/usuarios' })
await app.register(tareasRoutes, { prefix: '/api/tareas' })
await app.register(asignacionesRoutes, { prefix: '/api/asignaciones' })
await app.register(dependenciasRoutes, { prefix: '/api/dependencias' })
await app.register(instanciasRoutes, { prefix: '/api/instancias' })
await app.register(reportesRoutes, { prefix: '/api/reportes' })
await app.register(tvRoutes, { prefix: '/api/tv' })
await app.register(chatRoutes, { prefix: '/api/chat' })

try {
  await app.listen({ port: process.env.PORT || 3100, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
