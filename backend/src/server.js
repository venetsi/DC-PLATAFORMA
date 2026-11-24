import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
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
import circuitoRoutes from './routes/circuito.js'
import tvRoutes from './routes/tv.js'
import pantallasRoutes from './routes/pantallas.js'
import chatRoutes from './routes/chat.js'
import repositoriosRoutes from './routes/repositorios.js'
import { esAdminGlobal, usuarioActual } from './lib/permisos.js'
import { asegurarMembresiasFrescas } from './lib/membresias.js'
import { cargarFeriados } from './lib/feriados.js'

// trustProxy: en produccion todo llega por el rewrite de Firebase Hosting y
// el frente de Cloud Run, asi que la IP real viene en X-Forwarded-For. Sin
// esto request.ip era la del proxy y los limites por IP contaban a todas las
// TVs como una sola. (El primer valor de ese header lo puede inventar el
// cliente: por eso el limite que importa, adivinar codigos, va por persona.)
const app = Fastify({ logger: true, trustProxy: true })

await app.register(cors, { origin: process.env.FRONTEND_URL, credentials: true })
// Sin limite global: cada ruta que lo necesita trae el suyo (config.rateLimit).
// Va antes de las rutas: el plugin engancha los limites cuando se registran.
await app.register(rateLimit, { global: false })
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
  // Una sesion de un usuario desactivado (p.ej. la identidad vieja de una cuenta
  // renombrada, ya unificada con la nueva) deja de valer en el acto, no a los 7 dias.
  const vigente = await app.db.extUser.findUnique({ where: { id: request.user.id }, select: { activo: true } })
  if (!vigente?.activo) return reply.code(401).send({ error: 'Tu sesión ya no es válida. Volvé a entrar desde dcsmart → Tareas.' })
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
await app.register(circuitoRoutes, { prefix: '/api/circuito' })
await app.register(tvRoutes, { prefix: '/api/tv' })
await app.register(pantallasRoutes, { prefix: '/api/pantallas' })
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
