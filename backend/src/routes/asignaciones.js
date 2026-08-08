import { construirRecurrence, primeraFecha } from '../lib/recurrencia.js'

function sumarUnDia(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// CRUD de TareaAsignacion (agenda por local). Crear/editar la agenda
// (recurrencia) llama a Google Calendar por debajo -- ver docs/superpowers.
export default async function asignacionesRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id_tarea, id_local_ext } = request.query
    return fastify.db.tareaAsignacion.findMany({
      where: {
        activa: true,
        ...(id_tarea ? { id_tarea } : {}),
        ...(id_local_ext ? { id_local_ext } : {})
      },
      include: { tarea: true, local: true }
    })
  })

  // Sin agenda definida todavia ("fecha a asignar" del ejemplo real): crea
  // solo el puntero, sin evento de Calendar.
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { id_tarea, id_local_ext } = request.body || {}
    if (!id_tarea) return reply.code(400).send({ error: 'id_tarea requerido' })
    const asignacion = await fastify.db.tareaAsignacion.create({ data: { id_tarea, id_local_ext } })
    return reply.code(201).send(asignacion)
  })

  // Define/edita la agenda de una asignacion existente -- crea el evento de
  // Calendar si todavia no tiene, o edita el recurrence del maestro si ya lo tiene.
  fastify.put('/:id/agenda', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const asignacion = await fastify.db.tareaAsignacion.findUnique({
      where: { id: request.params.id },
      include: { tarea: { include: { departamento: true } } }
    })
    if (!asignacion) return reply.code(404).send({ error: 'Asignacion no encontrada' })

    const { recurrencia_tipo, recurrencia_config, vigencia_desde, vigencia_hasta, asignado_a } = request.body || {}
    if (!recurrencia_tipo || !vigencia_desde) {
      return reply.code(400).send({ error: 'recurrencia_tipo y vigencia_desde son requeridos' })
    }

    const calendarId = asignacion.tarea.departamento.id_calendar_google
    if (!calendarId) return reply.code(409).send({ error: 'El departamento todavia no tiene calendario propio' })

    const recurrence = construirRecurrence(recurrencia_tipo, recurrencia_config, vigencia_hasta)
    const startDate = primeraFecha(recurrencia_tipo, recurrencia_config, vigencia_desde)
    const endDate = sumarUnDia(startDate)

    const extendedProperties = {
      id_asignacion: asignacion.id,
      id_departamento: asignacion.tarea.id_departamento,
      id_local_ext: asignacion.id_local_ext ?? '',
      asignado_a: asignado_a ?? '',
      estado: 'PENDIENTE'
    }

    let eventId = asignacion.id_calendar_event
    if (eventId) {
      await fastify.gcal.editarRecurrencia({ calendarId, eventId, recurrence: recurrence ?? [] })
    } else {
      const evento = await fastify.gcal.crearEventoRecurrente({
        calendarId,
        summary: asignacion.tarea.nombre,
        startDate,
        endDate,
        recurrence: recurrence ?? undefined,
        extendedProperties
      })
      eventId = evento.id
    }

    const actualizada = await fastify.db.tareaAsignacion.update({
      where: { id: asignacion.id },
      data: { id_calendar_event: eventId }
    })
    return actualizada
  })
}
