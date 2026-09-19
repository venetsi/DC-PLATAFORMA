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
const MODELO = process.env.GEMINI_MODELO_BUSCAR || 'gemini-flash-latest'

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
export async function responderPregunta(fastify, { pregunta, storeNames }) {
  const interaction = await fastify.gemini.interactions.create({
    model: MODELO,
    input: pregunta,
    tools: [{ type: 'file_search', file_search_store_names: storeNames }]
  })

  const { texto, citas } = extraerTextoYCitas(interaction)
  if (!texto) return 'No encontré nada en los documentos cargados para responder eso.'

  const fuentes = citas.length ? `\n\n_Fuentes: ${citas.join(', ')}_` : ''
  return `${texto}${fuentes}`
}
