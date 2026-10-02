import { construirRecurrence, primeraFecha, mismaRegla, leerRecurrence, untilDe, conUntil, horizontePorDefecto, esSerieDeFechas, conFechasAbiertas } from './recurrencia.js'
import { componerTitulo } from './titulo.js'
import { hoyEnArgentina } from './vencimiento.js'

// Urgencia de la tarea (la columna "grupo" del Excel traia 🔴/🟢): ALTA o
// NORMAL. Fija por asignacion; null = sin clasificar.
export const PRIORIDADES = ['ALTA', 'NORMAL']
export function prioridadValida(valor) {
  if (valor === undefined || valor === null || valor === '') return null
  const v = String(valor).toUpperCase()
  if (!PRIORIDADES.includes(v)) throw Object.assign(new Error('La urgencia es ALTA o NORMAL'), { status: 400 })
  return v
}

export function sumarDias(fechaISO, n) {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Define/edita la agenda de una asignacion -- crea el evento de Calendar si
// todavia no tiene, o edita el recurrence del maestro si ya lo tiene. Si la
// asignacion esta compartida con otros departamentos (TareaAsignacionDepto),
// replica la misma escritura en el calendario de cada uno: mismo
// id_asignacion en extendedProperties (lo que los une), pero cada Calendar
// necesita su propia copia fisica del evento.
//
// Vivia inline en PUT /asignaciones/:id/agenda; se extrae para que "duplicar
// tarea" (routes/tareas.js) agende las copias con exactamente la misma logica.
// `asignacion` tiene que venir con tarea.departamento, local y
// compartidas.departamento incluidos. Tira Error con `status` si falta algo.
export async function definirAgenda(fastify, asignacion, { recurrencia_tipo, recurrencia_config, vigencia_desde, vigencia_hasta, asignado_a, prioridad }) {
  const calendarId = asignacion.tarea.departamento.id_calendar_google
  if (!calendarId) throw Object.assign(new Error('El departamento todavia no tiene calendario propio'), { status: 409 })

  // Sin vigencia_hasta explicita, la serie se acota a 6 meses y la renueva
  // reconciliar.js -- nunca infinita (ver lib/recurrencia.js).
  // Al editar, un cambio de agenda rige desde "desde" pero nunca antes de hoy:
  // el pasado ya ocurrio (y tiene lo marcado) y no se reescribe.
  const hoy = hoyEnArgentina()
  const corte = asignacion.id_calendar_event && vigencia_desde < hoy ? hoy : vigencia_desde
  const recurrence = construirRecurrence(recurrencia_tipo, recurrencia_config, vigencia_hasta, corte)
  const startDate = primeraFecha(recurrencia_tipo, recurrencia_config, corte)
  const endDate = sumarDias(startDate, 1)

  // Titulo con el local/grupo al que aplica -- ver lib/titulo.js. El nombre
  // limpio ademas viaja en extendedProperties.nombre_tarea para que el
  // kiosko/app no repitan el local en cada bullet (ya agrupan por local).
  const titulo = componerTitulo(asignacion.tarea.nombre, asignacion.local)
  const responsable = (asignado_a ?? asignacion.asignado_a) || ''
  // undefined = conserva la que tiene; null/'' = la saca.
  const urgencia = prioridad === undefined ? asignacion.prioridad || null : prioridadValida(prioridad)

  async function escribirEvento({ calendarId: calId, eventIdActual, idDepartamentoEvento }) {
    const props = {
      id_asignacion: asignacion.id,
      id_departamento: idDepartamentoEvento,
      id_local_ext: asignacion.id_local_ext ?? '',
      nombre_tarea: asignacion.tarea.nombre,
      asignado_a: responsable,
      prioridad: urgencia || ''
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

  return fastify.db.tareaAsignacion.update({
    where: { id: asignacion.id },
    data: { id_calendar_event: eventId, asignado_a: responsable || null, prioridad: urgencia }
  })
}

const INCLUDES_AGENDA = { tarea: { include: { departamento: true } }, local: true, compartidas: { include: { departamento: true } } }

// Asignacion activa de `tarea` para un local (null = toda la empresa), lista
// para pasarle a definirAgenda. Si ya existia una desactivada para ese mismo
// local (hay un unico por tarea+local), se reactiva con una serie NUEVA: la
// vieja quedo cerrada con UNTIL y "misma regla" no la reabriria. Comparte con
// `compartirCon` (ids de departamento), salteando el dueño y los inactivos.
export async function asegurarAsignacion(fastify, { tarea, idLocal, asignadoA = null, compartirCon = [], prioridad }) {
  const urgencia = prioridad === undefined ? undefined : prioridadValida(prioridad)
  const existente = await fastify.db.tareaAsignacion.findFirst({ where: { id_tarea: tarea.id, id_local_ext: idLocal } })
  let asignacion
  let yaActiva = false
  if (existente?.activa) {
    asignacion = existente
    yaActiva = true
  } else if (existente) {
    asignacion = await fastify.db.tareaAsignacion.update({
      where: { id: existente.id },
      data: { activa: true, id_calendar_event: null, asignado_a: asignadoA, ...(urgencia !== undefined ? { prioridad: urgencia } : {}) }
    })
    // Las copias compartidas de la serie vieja tambien quedaron cerradas.
    await fastify.db.tareaAsignacionDepto.updateMany({ where: { id_asignacion: existente.id }, data: { id_calendar_event: null } })
  } else {
    asignacion = await fastify.db.tareaAsignacion.create({ data: { id_tarea: tarea.id, id_local_ext: idLocal, asignado_a: asignadoA, ...(urgencia ? { prioridad: urgencia } : {}) } })
  }

  const destinos = compartirCon.length
    ? await fastify.db.departamento.findMany({ where: { id: { in: compartirCon }, activo: true } })
    : []
  const filas = destinos.filter((d) => d.id !== tarea.id_departamento).map((d) => ({ id_asignacion: asignacion.id, id_departamento: d.id }))
  if (filas.length) await fastify.db.tareaAsignacionDepto.createMany({ data: filas, skipDuplicates: true })

  const conIncludes = await fastify.db.tareaAsignacion.findUnique({ where: { id: asignacion.id }, include: INCLUDES_AGENDA })
  return { asignacion: conIncludes, yaActiva }
}

// Cierra hacia adelante (UNTIL hoy, nunca events.delete) la serie de una
// asignacion y la de cada copia compartida, y la marca inactiva. El historial
// de lo ya marcado queda en Calendar. Mismo criterio que desactivar una tarea.
export async function cerrarAsignacion(fastify, asignacion) {
  const hoy = hoyEnArgentina()
  const calendarId = asignacion.tarea.departamento.id_calendar_google
  if (calendarId && asignacion.id_calendar_event) {
    await fastify.gcal.cerrarRecurrencia({ calendarId, eventId: asignacion.id_calendar_event, untilDate: hoy })
  }
  for (const compartida of asignacion.compartidas) {
    const calId = compartida.departamento.id_calendar_google
    if (calId && compartida.id_calendar_event) {
      await fastify.gcal.cerrarRecurrencia({ calendarId: calId, eventId: compartida.id_calendar_event, untilDate: hoy })
    }
  }
  return fastify.db.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: false } })
}

// Lo contrario de cerrarAsignacion. `asignacion` viene con INCLUDES_AGENDA.
//
// Si la serie se cerro hace poco (hoy o ayer), se reabre LA MISMA: vuelve el
// UNTIL al horizonte y reaparecen las mismas instancias, con sus marcas y sus
// dependencias. Si se cerro antes, reabrirla traeria de vuelta como atrasadas
// todas las fechas del medio: ahi se arranca una serie nueva desde hoy, con la
// misma regla y el mismo responsable.
export async function reabrirAsignacion(fastify, asignacion) {
  const hoy = hoyEnArgentina()
  const calendarId = asignacion.tarea.departamento.id_calendar_google
  const maestro = calendarId && asignacion.id_calendar_event
    ? await fastify.gcal.leerInstancia({ calendarId, instanceId: asignacion.id_calendar_event })
    : null
  const until = untilDe(maestro?.recurrence)

  // Si al cerrarla todavia no habia empezado, se borro entera (ver
  // lib/cerrar-serie.js). Si su primera fecha no paso, vuelve tal cual (con
  // sus copias); si ya paso, traerla generaria atrasadas: va por una nueva.
  if (maestro?.status === 'cancelled') {
    if (String(maestro.start?.date || '') >= hoy) {
      await fastify.gcal.restaurarSerie({ calendarId, eventId: maestro.id })
      for (const compartida of asignacion.compartidas || []) {
        const calId = compartida.departamento.id_calendar_google
        if (!calId || !compartida.id_calendar_event) continue
        const copia = await fastify.gcal.leerInstancia({ calendarId: calId, instanceId: compartida.id_calendar_event })
        if (copia?.status === 'cancelled') await fastify.gcal.restaurarSerie({ calendarId: calId, eventId: copia.id })
      }
      return fastify.db.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: true } })
    }
  } else if (maestro && esSerieDeFechas(maestro.recurrence)) {
    // Una serie de fechas se cierra con EXDATE (nada se borra). Si se cerro
    // hace poco, vuelve LA MISMA con todas sus fechas; si no, va una nueva
    // desde hoy con las que queden (abajo).
    const cerradaHasta = maestro.extendedProperties?.private?.cerrada_hasta || null
    if (!cerradaHasta || cerradaHasta >= sumarDias(hoy, -1)) {
      const abrir = (calId, evento) => fastify.gcal.editarRecurrencia({
        calendarId: calId,
        eventId: evento.id,
        recurrence: conFechasAbiertas(evento.recurrence),
        extendedProperties: { cerrada_hasta: '' }
      })
      await abrir(calendarId, maestro)
      for (const compartida of asignacion.compartidas || []) {
        const calId = compartida.departamento.id_calendar_google
        if (!calId || !compartida.id_calendar_event) continue
        const copia = await fastify.gcal.leerInstancia({ calendarId: calId, instanceId: compartida.id_calendar_event })
        if (copia && esSerieDeFechas(copia.recurrence)) await abrir(calId, copia)
      }
      return fastify.db.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: true } })
    }
  } else if (maestro && (!until || until >= sumarDias(hoy, -1))) {
    const hasta = horizontePorDefecto(hoy)
    if (until) {
      await fastify.gcal.editarRecurrencia({ calendarId, eventId: maestro.id, recurrence: conUntil(maestro.recurrence, hasta) })
    }
    for (const compartida of asignacion.compartidas || []) {
      const calId = compartida.departamento.id_calendar_google
      if (!calId || !compartida.id_calendar_event) continue
      const copia = await fastify.gcal.leerInstancia({ calendarId: calId, instanceId: compartida.id_calendar_event })
      if (copia && untilDe(copia.recurrence)) {
        await fastify.gcal.editarRecurrencia({ calendarId: calId, eventId: copia.id, recurrence: conUntil(copia.recurrence, hasta) })
      }
    }
    return fastify.db.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: true } })
  }

  // `conExcluidas`: en una serie de fechas cerrada, las futuras estan en EXDATE.
  const agenda = maestro ? leerRecurrence(maestro.recurrence, maestro.start?.date, { conExcluidas: true }) : null
  const { asignacion: nueva } = await asegurarAsignacion(fastify, {
    tarea: asignacion.tarea,
    idLocal: asignacion.id_local_ext,
    asignadoA: asignacion.asignado_a,
    prioridad: asignacion.prioridad ?? undefined
  })
  if (agenda && agenda.recurrencia_tipo !== 'UNICA') {
    await definirAgenda(fastify, nueva, { ...agenda, vigencia_desde: hoy, vigencia_hasta: null, asignado_a: asignacion.asignado_a || '' })
  }
  return nueva
}

export { INCLUDES_AGENDA }
