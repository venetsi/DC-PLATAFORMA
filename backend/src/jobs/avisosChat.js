// Job diario (8am via Cloud Scheduler): por cada Departamento con
// chat_webhook_url configurado, arma UN mensaje con sus tareas vencidas y
// las pendientes de hoy, agrupadas por local, y lo postea por Chat. Una
// via -- no procesa respuestas (ver docs/superpowers). No marca nada en el
// evento: es un recordatorio que se repite todos los dias mientras la
// tarea siga sin hacerse, no una alerta de "una sola vez".
import { prisma, listarInstancias } from './lib.js'

const DIAS_HACIA_ATRAS = 14 // suficiente para no perder de vista una vencida vieja

function haceNDias(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

function finDeHoy() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString()
}

async function postearWebhook(url, texto) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text: texto })
  })
  if (!res.ok) throw new Error(`Webhook respondio ${res.status}`)
}

function armarMensaje(departamento, vencidas, pendientesHoy, nombreLocal) {
  const linea = (ev) => {
    const props = ev.extendedProperties?.private || {}
    const local = props.id_local_ext ? nombreLocal.get(props.id_local_ext) || 'Local sin nombre' : 'Toda la empresa'
    return `• ${ev.summary} (${local})`
  }

  const bloques = [`📋 *Recordatorio diario — ${departamento.nombre}*`]
  if (vencidas.length) bloques.push(`\n⚠️ *Vencidas:*\n${vencidas.map(linea).join('\n')}`)
  if (pendientesHoy.length) bloques.push(`\n🕒 *Pendientes de hoy:*\n${pendientesHoy.map(linea).join('\n')}`)
  return bloques.join('\n')
}

async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function correr() {
  const [departamentos, locales] = await Promise.all([
    prisma.departamento.findMany({
      where: { activo: true, id_calendar_google: { not: null }, chat_webhook_url: { not: null } }
    }),
    prisma.extLocal.findMany()
  ])
  const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))

  const ahora = new Date()
  const hoyISO = ahora.toISOString().slice(0, 10)
  let avisosEnviados = 0

  for (const depto of departamentos) {
    const items = await listarInstancias({
      calendarId: depto.id_calendar_google,
      timeMin: haceNDias(DIAS_HACIA_ATRAS),
      timeMax: finDeHoy(),
      estado: 'PENDIENTE'
    })

    const vencidas = []
    const pendientesHoy = []
    for (const ev of items) {
      const fin = new Date(ev.end?.date || ev.end?.dateTime)
      const fechaEvento = (ev.start?.date || ev.start?.dateTime || '').slice(0, 10)
      if (ahora > fin) vencidas.push(ev)
      else if (fechaEvento === hoyISO) pendientesHoy.push(ev)
    }

    if (!vencidas.length && !pendientesHoy.length) continue

    await postearWebhook(depto.chat_webhook_url, armarMensaje(depto, vencidas, pendientesHoy, nombreLocal))
    avisosEnviados++
    await esperar(1100) // limite de la API de Chat: 1 req/seg por Space
  }

  return { departamentos_con_webhook: departamentos.length, avisos_enviados: avisosEnviados }
}

correr()
  .then((r) => console.log('Avisos de Chat OK:', r))
  .catch((err) => {
    console.error('Avisos de Chat fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
