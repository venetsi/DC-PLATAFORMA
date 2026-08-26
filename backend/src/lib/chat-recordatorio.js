// Reconstruye la card del recordatorio de UN departamento a partir de Calendar
// en vivo. La usa el receptor de clicks (routes/chat.js#marcar) para
// re-renderizar la tarjeta despues de marcar una tarea -- en vez de dejar un
// mensaje nuevo con un boton que ya no aplica, actualiza la que se clickeo.
//
// Reusa la MISMA ventana y umbrales que el job del recordatorio diario
// (jobs/avisosChat.js), asi las dos vistas no se desincronizan -- aunque el
// job evalua los 11 departamentos en una corrida y esto reconstruye uno solo
// bajo demanda, la formula de la ventana es identica (ver ventana-avisos.js).
import { hoyEnArgentina } from './vencimiento.js'
import { clasificarParaAviso, resolverUmbrales } from './escalamiento.js'
import { cardDepartamento } from './chat-cards.js'
import { DIAS_MINIMOS, desdeHaceNDias, finDeHoyArgentina } from './ventana-avisos.js'

export async function construirTarjetaDepartamento({ db, gcal }, departamento) {
  const hoyISO = hoyEnArgentina()
  const umbrales = resolverUmbrales(departamento)
  const timeMin = desdeHaceNDias(Math.max(DIAS_MINIMOS, umbrales.direccion + 7))
  const timeMax = finDeHoyArgentina(hoyISO)

  const [items, locales] = await Promise.all([
    gcal.listarInstancias({ calendarId: departamento.id_calendar_google, timeMin, timeMax }),
    db.extLocal.findMany({ select: { id: true, nombre: true } })
  ])

  const baldes = clasificarParaAviso(items, { umbrales, hoyISO })
  const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
  return cardDepartamento(departamento, baldes, nombreLocal, { umbrales, urlApp: process.env.FRONTEND_URL })
}

// Agrega una linea arriba de la tarjeta, sin persistirla en ningun lado: la
// proxima vez que alguien la reconstruya (otro click, o la corrida del dia
// siguiente) desaparece sola, porque cada reconstruccion parte de cero.
export function conNotaSuperior(mensajeCard, texto) {
  const clon = JSON.parse(JSON.stringify(mensajeCard))
  const primera = clon.cardsV2?.[0]?.card
  if (!primera) return mensajeCard
  primera.sections = [
    { widgets: [{ decoratedText: { text: texto, wrapText: true } }] },
    ...(primera.sections || [])
  ]
  return clon
}
