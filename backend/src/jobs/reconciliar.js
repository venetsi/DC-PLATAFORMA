// Job periodico (cada 6h vía Cloud Scheduler): cuando un ExtLocal se
// desactiva, cierra hacia adelante (UNTIL, nunca events.delete) la
// recurrencia de cualquier TareaAsignacion que apunte a ese local -- sin
// perder el historial ya generado. Ver docs/superpowers/plans.
import { prisma, getCalendar } from './lib.js'

function untilSuffix(fechaISO) {
  return `UNTIL=${fechaISO.replaceAll('-', '')}T000000Z`
}

async function cerrarRecurrencia(calendar, { calendarId, eventId, untilDate }) {
  const { data: current } = await calendar.events.get({ calendarId, eventId })
  if (!current.recurrence?.length) return // evento sin recurrencia, nada que cerrar
  const nuevaRegla = untilSuffix(untilDate)
  const recurrence = current.recurrence.map((rule) =>
    /UNTIL=/.test(rule) ? rule.replace(/UNTIL=\d{8}T\d{6}Z/, nuevaRegla) : `${rule};${nuevaRegla}`
  )
  await calendar.events.patch({ calendarId, eventId, requestBody: { recurrence } })
}

async function correr() {
  const calendar = await getCalendar()
  const hoy = new Date().toISOString().slice(0, 10)

  const localesInactivos = await prisma.extLocal.findMany({ where: { activo: false } })
  let cerradas = 0

  for (const local of localesInactivos) {
    const asignaciones = await prisma.tareaAsignacion.findMany({
      where: { id_local_ext: local.id, activa: true, id_calendar_event: { not: null } },
      include: { tarea: { include: { departamento: true } } }
    })

    for (const asignacion of asignaciones) {
      const calendarId = asignacion.tarea.departamento.id_calendar_google
      if (!calendarId) continue
      await cerrarRecurrencia(calendar, { calendarId, eventId: asignacion.id_calendar_event, untilDate: hoy })
      await prisma.tareaAsignacion.update({ where: { id: asignacion.id }, data: { activa: false } })
      cerradas++
    }
  }

  return { locales_inactivos: localesInactivos.length, asignaciones_cerradas: cerradas }
}

correr()
  .then((r) => console.log('Reconciliacion OK:', r))
  .catch((err) => {
    console.error('Reconciliacion fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
