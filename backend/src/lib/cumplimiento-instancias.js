import { clasificarInstancia, fechaDeInstancia, finDeInstancia } from './vencimiento.js'

// Escribe CumplimientoInstancia (una fila por tarea x local x dia) para los
// dias cerrados entre `desde` y `hasta` (inclusive, 'YYYY-MM-DD'). Idempotente:
// re-correrlo sobre el mismo rango actualiza el estado (una atrasada que se
// hizo despues pasa a REALIZADA con a_tiempo=false). El job diario lo llama
// con los ultimos 60 dias -- la misma ventana de "atrasadas" del resto de la app.
//
// `listarInstancias` se inyecta: el job usa la de jobs/lib.js (sin Fastify).
export async function registrarInstancias({ db, listarInstancias, log = console }, { desde, hasta }) {
  const departamentos = await db.departamento.findMany({ where: { activo: true, id_calendar_google: { not: null } } })
  const timeMin = `${desde}T00:00:00.000Z`
  const timeMax = `${hasta}T23:59:59.999Z`
  let filas = 0

  for (const depto of departamentos) {
    let items
    try {
      items = await listarInstancias({ calendarId: depto.id_calendar_google, timeMin, timeMax })
    } catch (err) {
      // Un calendario caido no frena al resto; se reintenta en la corrida de mañana.
      log.warn?.(`[instancias] no se pudo leer ${depto.slug}: ${err.message}`)
      continue
    }

    const eventos = items.filter((ev) => {
      const fecha = fechaDeInstancia(ev)
      return ev.extendedProperties?.private?.id_asignacion && fecha && fecha >= desde && fecha <= hasta
    })
    if (!eventos.length) continue

    // Una sola consulta para saber de que tarea es cada asignacion y si este
    // calendario es el dueño o una copia compartida.
    const ids = [...new Set(eventos.map((ev) => ev.extendedProperties.private.id_asignacion))]
    const asignaciones = await db.tareaAsignacion.findMany({
      where: { id: { in: ids } },
      select: { id: true, id_tarea: true, tarea: { select: { id_departamento: true, nombre: true } } }
    })
    const porId = new Map(asignaciones.map((a) => [a.id, a]))

    for (const ev of eventos) {
      const props = ev.extendedProperties.private
      const fechaISO = fechaDeInstancia(ev)
      const fin = finDeInstancia(ev)
      // Contra el cierre del dia de la tarea: todas las que entran aca ya vencieron o se cerraron.
      const { hecha, noAplica } = clasificarInstancia(ev, { referencia: new Date(fin.getTime() + 1) })
      const estado = noAplica ? 'NO_APLICA' : hecha ? 'REALIZADA' : 'VENCIDA'
      const realizadaEn = estado === 'REALIZADA' && props.realizada_en ? new Date(props.realizada_en) : null
      const asignacion = porId.get(props.id_asignacion)

      const datos = {
        id_tarea: asignacion?.id_tarea ?? null,
        nombre_tarea: props.nombre_tarea || asignacion?.tarea?.nombre || String(ev.summary || '').replace(/^[✓⊘] /, ''),
        id_local_ext: props.id_local_ext || '',
        compartida: !!asignacion && asignacion.tarea.id_departamento !== depto.id,
        estado,
        a_tiempo: estado === 'REALIZADA' ? (realizadaEn ? realizadaEn <= fin : null) : null,
        realizada_por: estado === 'REALIZADA' ? props.realizada_por || null : null,
        realizada_en: realizadaEn,
        asignado_a: props.asignado_a || null
      }
      const fecha = new Date(`${fechaISO}T00:00:00.000Z`)
      await db.cumplimientoInstancia.upsert({
        where: { id_departamento_id_asignacion_fecha: { id_departamento: depto.id, id_asignacion: props.id_asignacion, fecha } },
        create: { id_departamento: depto.id, id_asignacion: props.id_asignacion, fecha, ...datos },
        update: datos
      })
      filas++
    }
  }
  return { desde, hasta, filas }
}
