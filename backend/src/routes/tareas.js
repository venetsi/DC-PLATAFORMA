import { usuarioActual, puedeGestionarDepartamento, esAdminGlobal } from '../lib/permisos.js'

// CRUD del catalogo de Tarea (nombre + departamento fijo). Admin global
// gestiona cualquier departamento; un usuario de departamento gestiona
// solo el propio -- y ninguno de los dos puede desactivarla salvo admin
// (ver el chequeo de `activa` en PATCH).
export default async function tareasRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento, incluirInactivas } = request.query
    const usuario = await usuarioActual(fastify, request)
    // Las inactivas solo las pide un admin (para llegar a "Eliminar
    // definitivamente") -- todos los demas listados del resto de la app
    // siguen viendo solo el catalogo activo, sin cambios.
    const soloActivas = !(incluirInactivas === 'true' && esAdminGlobal(usuario))
    return fastify.db.tarea.findMany({
      where: { ...(soloActivas ? { activa: true } : {}), ...(departamento ? { id_departamento: departamento } : {}) },
      orderBy: { nombre: 'asc' }
    })
  })

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { nombre, id_departamento, descripcion } = request.body || {}
    if (!nombre || !id_departamento) {
      return reply.code(400).send({ error: 'nombre e id_departamento son requeridos' })
    }

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés crear tareas de tu propio departamento' })
    }

    const tarea = await fastify.db.tarea.create({ data: { nombre, id_departamento, descripcion } })
    return reply.code(201).send(tarea)
  })

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const existente = await fastify.db.tarea.findUnique({
      where: { id: request.params.id },
      include: { departamento: true }
    })
    if (!existente) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, existente.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés editar tareas de tu propio departamento' })
    }

    const { nombre, descripcion, activa } = request.body || {}
    // Desactivar queda reservado a admin global -- un usuario de
    // departamento puede crear/editar, no borrar.
    if (activa !== undefined && !esAdminGlobal(usuario)) {
      return reply.code(403).send({ error: 'Solo un admin global puede desactivar una tarea' })
    }

    // Al desactivar, cierra hacia adelante (UNTIL, nunca events.delete) la
    // recurrencia de cada asignacion activa con evento propio -- mismo
    // patron que reconciliar.js ya usa al desactivarse un local. Sin esto,
    // el evento seguia apareciendo en el checklist/kiosko para siempre: la
    // tarea solo desaparecia del catalogo de admin, nada mas. Si alguna
    // asignacion esta compartida con otros departamentos (TareaAsignacionDepto),
    // tambien se cierra la copia de cada uno -- son el mismo evento
    // conceptualmente, tienen que dejar de repetirse juntas.
    if (activa === false && existente.activa !== false) {
      const asignaciones = await fastify.db.tareaAsignacion.findMany({
        where: { id_tarea: existente.id, activa: true },
        include: { compartidas: { include: { departamento: true } } }
      })
      const calendarId = existente.departamento.id_calendar_google
      const hoy = new Date().toISOString().slice(0, 10)
      for (const asignacion of asignaciones) {
        if (calendarId && asignacion.id_calendar_event) {
          await fastify.gcal.cerrarRecurrencia({ calendarId, eventId: asignacion.id_calendar_event, untilDate: hoy })
        }
        for (const compartida of asignacion.compartidas) {
          const calIdCompartida = compartida.departamento.id_calendar_google
          if (calIdCompartida && compartida.id_calendar_event) {
            await fastify.gcal.cerrarRecurrencia({ calendarId: calIdCompartida, eventId: compartida.id_calendar_event, untilDate: hoy })
          }
        }
        await fastify.db.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: false } })
      }
    }

    return fastify.db.tarea.update({
      where: { id: request.params.id },
      data: { nombre, descripcion, ...(activa !== undefined ? { activa } : {}) }
    })
  })

  // Paso 2 de "desactivar y despues eliminar": borrado real e irreversible
  // -- events.delete() de Calendar (se pierde el historial/description) +
  // borra las filas de TareaAsignacion/Tarea de la base. A diferencia de
  // desactivar (soft, reversible), esto es a proposito la excepcion a la
  // convencion "activo en vez de hard-delete" del resto de la app: solo
  // llega hasta acá quien ya la desactivó primero y lo confirma de nuevo.
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const existente = await fastify.db.tarea.findUnique({
      where: { id: request.params.id },
      include: { departamento: true }
    })
    if (!existente) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!esAdminGlobal(usuario)) {
      return reply.code(403).send({ error: 'Solo un admin global puede eliminar una tarea definitivamente' })
    }
    if (existente.activa) {
      return reply.code(409).send({ error: 'Desactivá la tarea primero' })
    }

    const asignaciones = await fastify.db.tareaAsignacion.findMany({
      where: { id_tarea: existente.id },
      include: { compartidas: { include: { departamento: true } } }
    })
    const calendarId = existente.departamento.id_calendar_google
    for (const asignacion of asignaciones) {
      if (calendarId && asignacion.id_calendar_event) {
        await fastify.gcal.eliminarEvento({ calendarId, eventId: asignacion.id_calendar_event })
      }
      // Las copias compartidas hay que borrarlas de la base antes que la
      // asignacion original -- la FK de TareaAsignacionDepto es RESTRICT.
      for (const compartida of asignacion.compartidas) {
        const calIdCompartida = compartida.departamento.id_calendar_google
        if (calIdCompartida && compartida.id_calendar_event) {
          await fastify.gcal.eliminarEvento({ calendarId: calIdCompartida, eventId: compartida.id_calendar_event })
        }
      }
      await fastify.db.tareaAsignacionDepto.deleteMany({ where: { id_asignacion: asignacion.id } })
    }

    await fastify.db.tareaAsignacion.deleteMany({ where: { id_tarea: existente.id } })
    await fastify.db.tarea.delete({ where: { id: existente.id } })
    return reply.code(204).send()
  })
}
