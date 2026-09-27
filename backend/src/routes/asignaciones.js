import { leerRecurrence } from '../lib/recurrencia.js'
import { usuarioActual, puede } from '../lib/permisos.js'
import { definirAgenda } from '../lib/agenda.js'

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
      include: { tarea: true, local: true, compartidas: { include: { departamento: true } } }
    })
  })

  // Sin agenda definida todavia ("fecha a asignar" del ejemplo real): crea
  // solo el puntero, sin evento de Calendar. `id_grupo` es un atajo para
  // asignar de una a todos los locales de ese grupo (ExtLocal.grupo) --
  // crea una TareaAsignacion por local, no un scope nuevo en el modelo.
  //
  // `departamentos_compartidos`: comparte la(s) asignacion(es) creadas con
  // departamentos ademas del dueño de la tarea -- "un solo evento visible
  // para ambos deptos". Vale tambien para "por grupo": se aplica a cada
  // local del grupo (N locales x M departamentos compartidos), no solo al
  // alcance simple. Crea las filas TareaAsignacionDepto sin evento de
  // Calendar todavia (se materializa recien al definir la agenda, ver
  // PUT /:id/agenda).
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id_tarea, id_local_ext, id_grupo, departamentos_compartidos } = request.body || {}
    if (!id_tarea) return reply.code(400).send({ error: 'id_tarea requerido' })

    const tarea = await fastify.db.tarea.findUnique({ where: { id: id_tarea } })
    if (!tarea) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Asignar tareas lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    async function compartirCon(idAsignacion) {
      if (!Array.isArray(departamentos_compartidos) || !departamentos_compartidos.length) return
      await fastify.db.tareaAsignacionDepto.createMany({
        data: departamentos_compartidos.map((idDepartamento) => ({ id_asignacion: idAsignacion, id_departamento: idDepartamento })),
        skipDuplicates: true
      })
    }

    if (id_grupo) {
      const locales = await fastify.db.extLocal.findMany({ where: { grupo: id_grupo, activo: true } })
      if (locales.length === 0) return reply.code(404).send({ error: `Ningún local activo en el grupo "${id_grupo}"` })

      const creadas = []
      const yaExistian = []
      for (const local of locales) {
        try {
          const asignacion = await fastify.db.tareaAsignacion.create({ data: { id_tarea, id_local_ext: local.id } })
          await compartirCon(asignacion.id)
          creadas.push(asignacion)
        } catch (err) {
          if (err.code === 'P2002') { yaExistian.push(local.nombre); continue }
          throw err
        }
      }
      return reply.code(201).send({ creadas, ya_existian: yaExistian })
    }

    try {
      const asignacion = await fastify.db.tareaAsignacion.create({ data: { id_tarea, id_local_ext: id_local_ext || null } })
      await compartirCon(asignacion.id)
      return reply.code(201).send(asignacion)
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'Ya existe una asignacion para esta tarea y local' })
      }
      throw err
    }
  })

  // La agenda vigente, leida del maestro de Calendar (la base no la guarda),
  // para precargar el formulario: sin esto se abria siempre en "Diaria, desde
  // hoy" y al guardar se pisaba la frecuencia real.
  fastify.get('/:id/agenda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const asignacion = await fastify.db.tareaAsignacion.findUnique({
      where: { id: request.params.id },
      include: { tarea: { include: { departamento: true } } }
    })
    if (!asignacion) return reply.code(404).send({ error: 'Asignacion no encontrada' })
    if (!puede(await usuarioActual(fastify, request), 'ver', asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'No tenés acceso a este departamento' })
    }
    // Lo que necesita el panel Editar del detalle de una tarea (Mi agenda).
    const datos = {
      id: asignacion.id,
      id_tarea: asignacion.id_tarea,
      nombre_tarea: asignacion.tarea.nombre,
      id_departamento: asignacion.tarea.id_departamento,
      asignado_a: asignacion.asignado_a
    }
    if (!asignacion.id_calendar_event) return { agenda: null, asignacion: datos }

    const maestro = await fastify.gcal.leerInstancia({
      calendarId: asignacion.tarea.departamento.id_calendar_google,
      instanceId: asignacion.id_calendar_event
    })
    if (!maestro) return { agenda: null, asignacion: datos }
    return { agenda: leerRecurrence(maestro.recurrence, maestro.start?.date), asignacion: datos }
  })

  // Define/edita la agenda de una asignacion existente -- crea el evento de
  // Calendar si todavia no tiene, o edita el recurrence del maestro si ya lo
  // tiene. Si la asignacion esta compartida con otros departamentos
  // (TareaAsignacionDepto), replica la misma escritura en el calendario de
  // cada uno: mismo id_asignacion en extendedProperties (lo que los une),
  // pero cada Calendar necesita su propia copia fisica del evento.
  fastify.put('/:id/agenda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const asignacion = await fastify.db.tareaAsignacion.findUnique({
      where: { id: request.params.id },
      include: {
        tarea: { include: { departamento: true } },
        local: true,
        compartidas: { include: { departamento: true } }
      }
    })
    if (!asignacion) return reply.code(404).send({ error: 'Asignacion no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Cambiar la agenda lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    const { recurrencia_tipo, recurrencia_config, vigencia_desde, vigencia_hasta, asignado_a } = request.body || {}
    if (!recurrencia_tipo || !vigencia_desde) {
      return reply.code(400).send({ error: 'recurrencia_tipo y vigencia_desde son requeridos' })
    }

    if (!asignacion.tarea.departamento.id_calendar_google) {
      return reply.code(409).send({ error: 'El departamento todavia no tiene calendario propio' })
    }

    // La escritura en Calendar (y en las copias de los departamentos compartidos)
    // vive en lib/agenda.js -- la comparte "duplicar tarea".
    return definirAgenda(fastify, asignacion, { recurrencia_tipo, recurrencia_config, vigencia_desde, vigencia_hasta, asignado_a })
  })
}
