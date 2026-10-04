// Pregunta a Gemini, con la respuesta ANCLADA solo en los stores de File
// Search indicados (general + los departamentos que cubra el Space, ver
// ambitoDelSpace en chat-comandos.js). Usa la API de "interactions" del SDK
// (@google/genai@2.23.0) -- es la forma documentada para File Search
// (ai.google.dev/gemini-api/docs/file-search), no la clásica
// models.generateContent.
//
// Forma REAL verificada contra una respuesta real (2026-09-19, prueba
// end-to-end con un documento de una sola linea): interaction.output_text ya
// trae el texto completo armado -- no hace falta concatenar los content
// blocks a mano. La cita es un objeto PLANO en annotations (no anidada bajo
// .file_citation como sugeria la doc): { type: "file_citation", file_name,
// document_uri, start_index, end_index, source }.
import { buildBuscarSystemPrompt } from './prompts.js'

const MODELO = process.env.GEMINI_MODELO_BUSCAR || 'gemini-flash-latest'

// Centinela que el system prompt le pide a Gemini responder CUANDO NO
// encuentra la respuesta en los documentos -- igual que NO_INFO_REPLY en el
// bot hermano de WhatsApp (AUDITOR WSP): el texto que ve la persona en ESE
// caso puntual es fijo en el codigo, nunca lo redacta el modelo, para que
// nunca varie ni se le cuele una alucinacion justo donde mas importa ser
// preciso. Se detecta por inclusion (no igualdad exacta) porque el modelo
// puede rodearlo de espacios o puntuacion pese a la instruccion de "nada
// mas antes ni despues".
const SENTINEL_SIN_INFO = 'SIN_INFORMACION'
const NO_INFO_REPLY = 'No encontré esa información en los documentos cargados. Probá reformular la pregunta, o pedile a un administrador que cargue el documento correspondiente.'

function extraerTextoYCitas(interaction) {
  const citas = new Set()

  for (const step of interaction?.steps ?? []) {
    if (step?.type !== 'model_output') continue
    for (const bloque of step?.content ?? []) {
      if (bloque?.type !== 'text') continue
      for (const anotacion of bloque.annotations ?? []) {
        if (anotacion?.type === 'file_citation' && anotacion.file_name) citas.add(anotacion.file_name)
      }
    }
  }

  return { texto: (interaction?.output_text || '').trim(), citas: [...citas] }
}

// storeNames: array de resource names de File Search stores (general +
// departamentos en ámbito). Nunca vacío -- el caller corta antes con "no hay
// documentos cargados" si no hay ningún store con contenido.
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

// `plazoMs`: presupuesto TOTAL de la consulta (buscar-chat.js: Chat da ~30 s y Cloud
// Run solo tiene CPU mientras dura el pedido). El corte es el `timeout` del propio
// SDK, NO un AbortSignal: con el SDK 2.23.0 el abort de un request ya en vuelo no
// es fiable (pasada cierta espera, o tras un GC, la conexion queda abierta y el
// SDK nunca rechaza), y ademas con `signal` el SDK ignora su `timeout`. Se verifico
// con el SDK real contra un servidor colgado: con `timeout` corta siempre.
//
// Reintentos: `maxRetries: 0` en el SDK (sus reintentos son por intento y se
// pasarian del plazo) y UN reintento manual solo ante 429/503 (los picos de
// demanda de Gemini), solo si quedan >= 4 s del presupuesto. `signal` solo sirve
// para no reintentar si quien llama ya se rindio.
export async function responderPregunta(fastify, { pregunta, storeNames, signal, plazoMs = 22_000 }) {
  const params = {
    model: MODELO,
    input: pregunta,
    system_instruction: buildBuscarSystemPrompt(),
    tools: [{ type: 'file_search', file_search_store_names: storeNames }]
  }
  const limite = Date.now() + plazoMs
  let interaction
  for (let intento = 1; ; intento++) {
    try {
      interaction = await fastify.gemini.interactions.create(params, { maxRetries: 0, timeout: Math.max(1_000, limite - Date.now()) })
      break
    } catch (err) {
      const transitorio = err?.status === 429 || err?.status === 503
      if (intento >= 2 || !transitorio || signal?.aborted || limite - Date.now() < 4_000) throw err
      await esperar(500)
    }
  }

  const { texto, citas } = extraerTextoYCitas(interaction)
  if (!texto || texto.includes(SENTINEL_SIN_INFO)) return NO_INFO_REPLY

  const fuentes = citas.length ? `\n\n_Fuentes: ${citas.join(', ')}_` : ''
  return `${texto}${fuentes}`
}
