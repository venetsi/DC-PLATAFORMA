import { usuarioActual, puedeGestionarDepartamento } from '../lib/permisos.js'

function inicioDelDia(fecha = new Date()) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())).toISOString()
}
function finDelDia(fecha = new Date()) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 23, 59, 59)).toISOString()
}

async function resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento) {
  const usuario = await usuarioActual(fastify, request)
  if (!puedeGestionarDepartamento(usuario, idDepartamento)) {
    reply.code(403).send({ error: 'No tenes acceso a este departamento' })
    return null
  }
  const departamento = await fastify.db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento?.id_calendar_google) {
    reply.code(409).send({ error: 'El departamento no tiene calendario configurado' })
    return null
  }
  return departamento
}

export default async function instanciasRoutes(fastify) {
  // Checklist del dia para el departamento del usuario logueado.
  fastify.get('/hoy', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    if (!usuario?.id_departamento) return reply.code(409).send({ error: 'Tu usuario no tiene departamento asignado' })

    const departamento = await fastify.db.departamento.findUnique({ where: { id: usuario.id_departamento } })
    if (!departamento?.id_calendar_google) return { items: [] }

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: inicioDelDia(),
      timeMax: finDelDia()
    })
    return { items }
  })

  // Filtro general -- ?departamento=<id>&estado=PENDIENTE, acotado a locales via extendedProperties del lado del cliente.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, estado, desde, hasta } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento)
    if (!departamento) return

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: desde ? new Date(desde).toISOString() : undefined,
      timeMax: hasta ? new Date(hasta).toISOString() : undefined,
      estado
    })
    return { items }
  })

  fastify.post('/:instanceId/marcar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento } = request.body || {}
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento)
    if (!departamento) return

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    const ahora = new Date().toISOString()
    const evento = await fastify.gcal.marcarInstancia({
      calendarId: departamento.id_calendar_google,
      instanceId: request.params.instanceId,
      extendedProperties: { estado: 'REALIZADA', realizada_por: usuario.email, realizada_en: ahora },
      logLine: `${ahora} - REALIZADA por ${usuario.email}`
    })
    return evento
  })

  // Preparados para Fase 9 (aprobacion real) -- no expuestos en la UI de v1.
  fastify.post('/:instanceId/aprobar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
  fastify.post('/:instanceId/rechazar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
}
