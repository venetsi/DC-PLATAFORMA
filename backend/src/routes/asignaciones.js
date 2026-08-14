import { construirRecurrence, primeraFecha } from '../lib/recurrencia.js'
import { usuarioActual, puedeGestionarDepartamento } from '../lib/permisos.js'

function sumarUnDia(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// CRUD de TareaAsignacion (agenda por local). Crear/editar la agenda
// (recurrencia) llama a Google Calendar por debajo -- ver docs/superpowers.
// Mismo modelo de permisos que tareas.js: admin gestiona cualquier
// departamento, un usuario de departamento solo el propio (via la tarea).
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
  // solo el puntero, sin evento de Calendar. `id_grupo` es un atajo para
  // asignar de una a todos los locales de ese grupo (ExtLocal.grupo) --
  // crea una TareaAsignacion por local, no un scope nuevo en el modelo.
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id_tarea, id_local_ext, id_grupo } = request.body || {}
    if (!id_tarea) return reply.code(400).send({ error: 'id_tarea requerido' })

    const tarea = await fastify.db.tarea.findUnique({ where: { id: id_tarea } })
    if (!tarea) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés asignar tareas de tu propio departamento' })
    }

    if (id_grupo) {
      const locales = await fastify.db.extLocal.findMany({ where: { grupo: id_grupo, activo: true } })
      if (locales.length === 0) return reply.code(404).send({ error: `Ningún local activo en el grupo "${id_grupo}"` })

      const creadas = []
      const yaExistian = []
      for (const local of locales) {
        try {
          creadas.push(await fastify.db.tareaAsignacion.create({ data: { id_tarea, id_local_ext: local.id } }))
        } catch (err) {
          if (err.code === 'P2002') { yaExistian.push(local.nombre); continue }
          throw err
        }
      }
      return reply.code(201).send({ creadas, ya_existian: yaExistian })
    }

    try {
      const asignacion = await fastify.db.tareaAsignacion.create({ data: { id_tarea, id_local_ext: id_local_ext || null } })
      return reply.code(201).send(asignacion)
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'Ya existe una asignacion para esta tarea y local' })
      }
      throw err
    }
  })

  // Define/edita la agenda de una asignacion existente -- crea el evento de
  // Calendar si todavia no tiene, o edita el recurrence del maestro si ya lo tiene.
  fastify.put('/:id/agenda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const asignacion = await fastify.db.tareaAsignacion.findUnique({
      where: { id: request.params.id },
      include: { tarea: { include: { departamento: true } } }
    })
    if (!asignacion) return reply.code(404).send({ error: 'Asignacion no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés definir la agenda de tu propio departamento' })
    }

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
