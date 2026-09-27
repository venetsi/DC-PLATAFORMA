import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import 'dotenv/config'

import dbPlugin from './plugins/db.js'
import gcalPlugin from './plugins/gcal.js'
import groupsPlugin from './plugins/groups.js'
import bigqueryPlugin from './plugins/bigquery.js'
import geminiPlugin from './plugins/gemini.js'
import authRoutes from './routes/auth.js'
import departamentosRoutes from './routes/departamentos.js'
import localesRoutes from './routes/locales.js'
import usuariosRoutes from './routes/usuarios.js'
import tareasRoutes from './routes/tareas.js'
import asignacionesRoutes from './routes/asignaciones.js'
import dependenciasRoutes from './routes/dependencias.js'
import instanciasRoutes from './routes/instancias.js'
import reportesRoutes from './routes/reportes.js'
import agendasRoutes from './routes/agendas.js'
import tvRoutes from './routes/tv.js'
import chatRoutes from './routes/chat.js'
import repositoriosRoutes from './routes/repositorios.js'
import { esAdminGlobal, usuarioActual } from './lib/permisos.js'
import { asegurarMembresiasFrescas } from './lib/membresias.js'
import { cargarFeriados } from './lib/feriados.js'

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
await app.register(geminiPlugin)

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify()
  } catch (err) {
    return reply.code(401).send({ error: 'No autenticado' })
  }
  // Refresca en segundo plano la copia de los Groups si tiene mas de 15 min.
  asegurarMembresiasFrescas(app)
})

// Admin global: es_admin_global viene del ticket SSO real (rol super_admin/
// dcsmart, Fase 8); el email hardcodeado (lib/permisos.js) sigue andando
// para el login temporal de dev, que nunca setea esa columna.
app.decorate('requireAdminGlobal', async (request, reply) => {
  const usuario = await usuarioActual(app, request)
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
await app.register(agendasRoutes, { prefix: '/api/agendas' })
await app.register(tvRoutes, { prefix: '/api/tv' })
await app.register(chatRoutes, { prefix: '/api/chat' })
await app.register(repositoriosRoutes, { prefix: '/api/repositorios' })

// Feriados para contar dias habiles de atraso; se refrescan dos veces por dia.
// No bloquea el arranque: si falla, se cuenta lunes a viernes como antes.
cargarFeriados({ log: app.log })
asegurarMembresiasFrescas(app)
setInterval(() => cargarFeriados({ log: app.log }), 12 * 60 * 60 * 1000).unref()

try {
  await app.listen({ port: process.env.PORT || 3100, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
