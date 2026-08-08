// Job cada 1h: por cada Departamento con chat_webhook_url configurado,
// escanea vencidas (de los ultimos dias, no solo hoy) y postea un aviso
// simple por Chat. Una via -- no procesa respuestas (ver docs/superpowers).
// Cada instancia avisada se marca (extendedProperties.aviso_chat_enviado)
// para no repetir el mismo aviso en cada corrida.
import { prisma, getCalendar, listarInstancias } from './lib.js'

const DIAS_HACIA_ATRAS = 3 // suficiente para no perder avisos de un fin de semana largo

function haceNDias(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

async function postearWebhook(url, texto) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text: texto })
  })
  if (!res.ok) throw new Error(`Webhook respondio ${res.status}`)
}

async function marcarAvisado(calendarId, eventId, extendedPropsActuales) {
  const calendar = await getCalendar()
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { extendedProperties: { private: { ...extendedPropsActuales, aviso_chat_enviado: 'true' } } }
  })
}

async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function correr() {
  const departamentos = await prisma.departamento.findMany({
    where: { activo: true, id_calendar_google: { not: null }, chat_webhook_url: { not: null } }
  })

  let avisosEnviados = 0
  for (const depto of departamentos) {
    const items = await listarInstancias({
      calendarId: depto.id_calendar_google,
      timeMin: haceNDias(DIAS_HACIA_ATRAS),
      timeMax: new Date().toISOString(),
      estado: 'PENDIENTE'
    })

    const aVencidas = items.filter((ev) => {
      const props = ev.extendedProperties?.private || {}
      if (props.aviso_chat_enviado === 'true') return false
      return new Date() > new Date(ev.end?.date || ev.end?.dateTime)
    })

    // En serie, no en paralelo -- limite de la API de Chat es 1 req/seg por Space.
    for (const evento of aVencidas) {
      const props = evento.extendedProperties?.private || {}
      const local = props.id_local_ext ? ` (${props.id_local_ext})` : ''
      await postearWebhook(depto.chat_webhook_url, `⚠️ *${evento.summary}*${local} venció sin hacerse.`)
      await marcarAvisado(depto.id_calendar_google, evento.id, props)
      avisosEnviados++
      await esperar(1100)
    }
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
