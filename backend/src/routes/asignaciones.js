import { construirRecurrence, primeraFecha, leerRecurrence, mismaRegla } from '../lib/recurrencia.js'
import { usuarioActual, puedeGestionarDepartamento } from '../lib/permisos.js'
import { componerTitulo } from '../lib/titulo.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'

function sumarDias(fechaISO, n) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const sumarUnDia = (fechaISO) => sumarDias(fechaISO, 1)

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
    if (!puedeGestionarDepartamento(usuario, tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés asignar tareas de tu propio departamento' })
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
    if (!asignacion.id_calendar_event) return { agenda: null }

    const maestro = await fastify.gcal.leerInstancia({
      calendarId: asignacion.tarea.departamento.id_calendar_google,
      instanceId: asignacion.id_calendar_event
    })
    if (!maestro) return { agenda: null }
    return { agenda: leerRecurrence(maestro.recurrence, maestro.start?.date) }
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
    if (!puedeGestionarDepartamento(usuario, asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés definir la agenda de tu propio departamento' })
    }

    const { recurrencia_tipo, recurrencia_config, vigencia_desde, vigencia_hasta, asignado_a } = request.body || {}
    if (!recurrencia_tipo || !vigencia_desde) {
      return reply.code(400).send({ error: 'recurrencia_tipo y vigencia_desde son requeridos' })
    }

    const calendarId = asignacion.tarea.departamento.id_calendar_google
    if (!calendarId) return reply.code(409).send({ error: 'El departamento todavia no tiene calendario propio' })

    // Sin vigencia_hasta explicita, la serie se acota a 12 meses y la renueva
    // reconciliar.js -- nunca infinita (ver lib/recurrencia.js).
    // Al editar, un cambio de agenda rige desde "desde" pero nunca antes de hoy:
    // el pasado ya ocurrio (y tiene lo marcado) y no se reescribe.
    const hoy = hoyEnArgentina()
    const corte = asignacion.id_calendar_event && vigencia_desde < hoy ? hoy : vigencia_desde
    const recurrence = construirRecurrence(recurrencia_tipo, recurrencia_config, vigencia_hasta, corte)
    const startDate = primeraFecha(recurrencia_tipo, recurrencia_config, corte)
    const endDate = sumarUnDia(startDate)

    // Titulo con el local/grupo al que aplica -- ver lib/titulo.js. El nombre
    // limpio ademas viaja en extendedProperties.nombre_tarea para que el
    // kiosko/app no repitan el local en cada bullet (ya agrupan por local).
    const titulo = componerTitulo(asignacion.tarea.nombre, asignacion.local)
    const responsable = (asignado_a ?? asignacion.asignado_a) || ''

    async function escribirEvento({ calendarId: calId, eventIdActual, idDepartamentoEvento }) {
      const props = {
        id_asignacion: asignacion.id,
        id_departamento: idDepartamentoEvento,
        id_local_ext: asignacion.id_local_ext ?? '',
        nombre_tarea: asignacion.tarea.nombre,
        asignado_a: responsable
      }
      const maestro = eventIdActual ? await fastify.gcal.leerInstancia({ calendarId: calId, instanceId: eventIdActual }) : null
      if (maestro) {
        const inicioActual = maestro.start?.date
        const mismaAgenda = recurrence
          ? mismaRegla(maestro.recurrence, recurrence)
          : !maestro.recurrence?.length && inicioActual === startDate

        // Solo cambio el titulo o el responsable: no se toca la recurrencia.
        // `estado` queda afuera a proposito -- lo maneja marcarInstancia.
        if (mismaAgenda) {
          await fastify.gcal.editarRecurrencia({ calendarId: calId, eventId: eventIdActual, summary: titulo, extendedProperties: props })
          return eventIdActual
        }

        // Cambio de agenda sobre algo que todavia no empezo: se reemplaza entero.
        if (inicioActual >= corte) {
          await fastify.gcal.editarRecurrencia({
            calendarId: calId,
            eventId: eventIdActual,
            recurrence: recurrence ?? [],
            summary: titulo,
            extendedProperties: props,
            startDate,
            endDate
          })
          return eventIdActual
        }

        // Cambio de agenda sobre una serie que ya tiene pasado: se cierra la
        // vieja el dia anterior al corte y arranca una nueva. Reescribir la
        // RRULE sobre el DTSTART viejo re-expandia el pasado (aparecian
        // vencidas retroactivas) o hacia desaparecer vencidas reales.
        if (maestro.recurrence?.length) {
          await fastify.gcal.cerrarRecurrencia({ calendarId: calId, eventId: eventIdActual, untilDate: sumarDias(corte, -1) })
        }
      }
      const evento = await fastify.gcal.crearEventoRecurrente({
        calendarId: calId,
        summary: titulo,
        startDate,
        endDate,
        recurrence: recurrence ?? undefined,
        extendedProperties: { ...props, estado: 'PENDIENTE' }
      })
      return evento.id
    }

    const eventId = await escribirEvento({
      calendarId,
      eventIdActual: asignacion.id_calendar_event,
      idDepartamentoEvento: asignacion.tarea.id_departamento
    })

    for (const compartida of asignacion.compartidas) {
      const calIdCompartida = compartida.departamento.id_calendar_google
      if (!calIdCompartida) continue
      const eventIdCompartida = await escribirEvento({
        calendarId: calIdCompartida,
        eventIdActual: compartida.id_calendar_event,
        idDepartamentoEvento: compartida.id_departamento
      })
      if (eventIdCompartida !== compartida.id_calendar_event) {
        await fastify.db.tareaAsignacionDepto.update({ where: { id: compartida.id }, data: { id_calendar_event: eventIdCompartida } })
      }
    }

    const actualizada = await fastify.db.tareaAsignacion.update({
      where: { id: asignacion.id },
      data: { id_calendar_event: eventId, asignado_a: responsable || null }
    })
    return actualizada
  })
}
