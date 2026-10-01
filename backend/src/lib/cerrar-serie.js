// Cerrar la serie de una asignacion (desactivar un local o una tarea, y el
// cierre de locales dados de baja del job reconciliar).
//
// Lo normal es cerrarla hacia adelante con UNTIL, sin borrar: el historial de
// lo ya marcado queda. Pero si la serie TODAVIA NO EMPEZO (su primera fecha es
// posterior al cierre), el UNTIL no alcanza: Google Calendar siempre conserva
// la primera ocurrencia (el DTSTART cuenta aunque quede despues del UNTIL), y
// queda una tarea fantasma en Mi agenda, en la TV y en los avisos.
//
// Paso real (2026-10-01): al desactivar Auditar de 3MONOS el 30/9 (arrancaba el
// 7/10) quedo el Auditar del 7/10; al desactivar y volver a sumar los P&L de
// TITA-CH y DARKI quedo un segundo P&L el 7/10 con el responsable viejo.
// Probado contra Calendar: una serie sin empezar cerrada con UNTIL deja viva su
// primera ocurrencia, tocada o no.
//
// Por eso una serie sin empezar, y sin nada hecho, se BORRA entera: no tiene
// historial que cuidar. Borrada sigue pudiendo leerse (regla, inicio,
// propiedades) y vuelve tal cual con status 'confirmed' (ver restaurarSerie y
// agenda.js#reabrirAsignacion).
import { estaHecha } from './vencimiento.js'

const sinReintento = (fn) => fn()

export function untilRule(untilDate) {
  return `UNTIL=${untilDate.replace(/-/g, '')}T000000Z`
}

export function conCierre(recurrence, untilDate) {
  const regla = untilRule(untilDate)
  return (recurrence || []).map((rule) => (/UNTIL=/.test(rule) ? rule.replace(/UNTIL=\d{8}T\d{6}Z/, regla) : `${rule};${regla}`))
}

// ¿Su primera fecha es posterior al cierre?
export function sinEmpezar(maestro, untilDate) {
  return String(maestro?.start?.date || maestro?.start?.dateTime || '').slice(0, 10) > untilDate
}

// `calendar`: cliente de googleapis; `reintentar`: el withBackoff del plugin
// (los jobs no tienen). Devuelve que hizo: 'borrada', 'cerrada' o 'nada'.
export async function cerrarSerie(calendar, { calendarId, eventId, untilDate, reintentar = sinReintento }) {
  const { data: maestro } = await reintentar(() => calendar.events.get({ calendarId, eventId }))
  if (maestro.status === 'cancelled') return 'nada'
  const recurrente = maestro.recurrence?.length > 0

  if (sinEmpezar(maestro, untilDate)) {
    // Si alguna ya se marco (alguien se adelanto), se cierra como siempre para
    // no perder esa marca.
    const ocurrencias = recurrente
      ? (await reintentar(() => calendar.events.instances({ calendarId, eventId, maxResults: 2500 }))).data.items || []
      : [maestro]
    if (!ocurrencias.some((e) => estaHecha(e.extendedProperties?.private))) {
      await reintentar(() => calendar.events.delete({ calendarId, eventId }))
      return 'borrada'
    }
  }

  if (!recurrente) return 'nada'
  await reintentar(() => calendar.events.patch({ calendarId, eventId, requestBody: { recurrence: conCierre(maestro.recurrence, untilDate) } }))
  return 'cerrada'
}

// Lo contrario de un cerrarSerie que la borro: vuelve tal cual, con sus
// ocurrencias movidas o editadas.
export async function restaurarSerie(calendar, { calendarId, eventId, reintentar = sinReintento }) {
  await reintentar(() => calendar.events.patch({ calendarId, eventId, requestBody: { status: 'confirmed' } }))
}
