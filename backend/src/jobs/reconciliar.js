// Job periodico (cada 6h via Cloud Scheduler). Hace dos cosas:
//
// 1. CIERRE: cuando un ExtLocal se desactiva, cierra hacia adelante (UNTIL,
//    nunca events.delete) la recurrencia de cualquier TareaAsignacion que
//    apunte a ese local -- sin perder el historial ya generado.
// 2. RENOVACION: extiende el horizonte de las series que estan por agotarse.
//    Desde que las recurrencias se crean acotadas a 12 meses (ver
//    lib/recurrencia.js), sin esto una tarea activa se apagaria sola al año y
//    desapareceria del kiosko y del checklist SIN ningun error a la vista.
//
// Ver docs/superpowers/plans.
import { prisma, getCalendar } from './lib.js'
import { horizontePorDefecto, MESES_DE_HORIZONTE } from '../lib/recurrencia.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'

// Cuando al UNTIL le quedan menos de estos dias, se renueva. Con el job
// corriendo cada 6h hay muchisimo margen: no hace falta apurar el limite.
const DIAS_ANTES_DE_RENOVAR = 60

function untilSuffix(fechaISO) {
  return `UNTIL=${fechaISO.replaceAll('-', '')}T000000Z`
}

function reemplazarUntil(recurrence, fechaISO) {
  const nuevaRegla = untilSuffix(fechaISO)
  return recurrence.map((rule) =>
    /UNTIL=/.test(rule) ? rule.replace(/UNTIL=\d{8}T\d{6}Z/, nuevaRegla) : `${rule};${nuevaRegla}`
  )
}

// Lee el UNTIL de una RRULE y lo devuelve como 'YYYY-MM-DD', o null si la
// serie es infinita (las creadas antes del horizonte de 12 meses).
function untilDeRecurrence(recurrence) {
  for (const rule of recurrence || []) {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(rule)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

function diasEntre(desdeISO, hastaISO) {
  const aMs = (iso) => {
    const [a, m, d] = iso.split('-').map(Number)
    return Date.UTC(a, m - 1, d)
  }
  return Math.round((aMs(hastaISO) - aMs(desdeISO)) / (24 * 60 * 60 * 1000))
}

async function cerrarRecurrencia(calendar, { calendarId, eventId, untilDate }) {
  const { data: current } = await calendar.events.get({ calendarId, eventId })
  if (!current.recurrence?.length) return // evento sin recurrencia, nada que cerrar
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { recurrence: reemplazarUntil(current.recurrence, untilDate) }
  })
}

// Devuelve true si renovo. Idempotente: si al UNTIL todavia le sobra tiempo,
// o la serie es infinita (una vieja), no toca nada.
async function renovarSiHaceFalta(calendar, { calendarId, eventId, hoy }) {
  const { data: current } = await calendar.events.get({ calendarId, eventId })
  if (!current.recurrence?.length) return false // evento UNICO, no hay nada que renovar

  const until = untilDeRecurrence(current.recurrence)
  if (!until) return false // serie infinita (pre-horizonte): se deja como esta
  if (diasEntre(hoy, until) > DIAS_ANTES_DE_RENOVAR) return false

  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { recurrence: reemplazarUntil(current.recurrence, horizontePorDefecto(hoy)) }
  })
  return true
}

async function correr() {
  const calendar = await getCalendar()
  const hoy = hoyEnArgentina()

  // --- 1. Cierre por local desactivado ---
  const localesInactivos = await prisma.extLocal.findMany({ where: { activo: false } })
  let cerradas = 0

  for (const local of localesInactivos) {
    const asignaciones = await prisma.tareaAsignacion.findMany({
      where: { id_local_ext: local.id, activa: true, id_calendar_event: { not: null } },
      include: { tarea: { include: { departamento: true } }, compartidas: { include: { departamento: true } } }
    })

    for (const asignacion of asignaciones) {
      const calendarId = asignacion.tarea.departamento.id_calendar_google
      if (calendarId) {
        await cerrarRecurrencia(calendar, { calendarId, eventId: asignacion.id_calendar_event, untilDate: hoy })
      }
      // Antes esto no propagaba: la copia de cada departamento compartido
      // seguia repitiendose aunque el local estuviera dado de baja.
      for (const compartida of asignacion.compartidas) {
        const calIdCompartida = compartida.departamento.id_calendar_google
        if (!calIdCompartida || !compartida.id_calendar_event) continue
        await cerrarRecurrencia(calendar, { calendarId: calIdCompartida, eventId: compartida.id_calendar_event, untilDate: hoy })
      }
      await prisma.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: false } })
      cerradas++
    }
  }

  // --- 2. Renovacion del horizonte de las series activas ---
  const activas = await prisma.tareaAsignacion.findMany({
    where: { activa: true, id_calendar_event: { not: null }, tarea: { activa: true } },
    include: { tarea: { include: { departamento: true } }, compartidas: { include: { departamento: true } } }
  })

  let renovadas = 0
  let fallidas = 0
  for (const asignacion of activas) {
    // Una falla puntual de Calendar no puede cortar la renovacion de las
    // demas: son cientos de series y el job corre desatendido.
    try {
      const calendarId = asignacion.tarea.departamento.id_calendar_google
      if (calendarId && (await renovarSiHaceFalta(calendar, { calendarId, eventId: asignacion.id_calendar_event, hoy }))) {
        renovadas++
      }
      for (const compartida of asignacion.compartidas) {
        const calIdCompartida = compartida.departamento.id_calendar_google
        if (!calIdCompartida || !compartida.id_calendar_event) continue
        if (await renovarSiHaceFalta(calendar, { calendarId: calIdCompartida, eventId: compartida.id_calendar_event, hoy })) {
          renovadas++
        }
      }
    } catch (err) {
      fallidas++
      console.error(`[reconciliar] no se pudo renovar la asignacion ${asignacion.id}:`, err.message)
    }
  }

  return {
    locales_inactivos: localesInactivos.length,
    asignaciones_cerradas: cerradas,
    series_evaluadas: activas.length,
    series_renovadas: renovadas,
    renovaciones_fallidas: fallidas,
    horizonte_meses: MESES_DE_HORIZONTE
  }
}

correr()
  .then((r) => console.log('Reconciliacion OK:', r))
  .catch((err) => {
    console.error('Reconciliacion fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
