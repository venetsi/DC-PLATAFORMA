// Cliente de la API de Gemini (File Search) para el comando /buscar del Chat
// App -- ver lib/repositorios.js y lib/gemini-buscar.js. A diferencia de TODO
// el resto de las integraciones de Google de este proyecto (Calendar, Groups,
// Chat, BigQuery -- todas por cuenta de servicio/ADC, sin secretos guardados),
// File Search de la Generative Language API se autentica con una API key: no
// hay variante por cuenta de servicio para este producto puntual (confirmado
// contra la doc oficial, 2026-09). La key vive en Secret Manager de Cloud Run
// (`GEMINI_API_KEY`), nunca en el repo -- ver "Pasos manuales pendientes" en
// el plan de esta feature.
import fp from 'fastify-plugin'
import { GoogleGenAI } from '@google/genai'

async function geminiPlugin(fastify) {
  if (!process.env.GEMINI_API_KEY) {
    fastify.log.warn('gemini: falta GEMINI_API_KEY -- /buscar y la carga de repositorios van a fallar')
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  fastify.decorate('gemini', ai)
}

export default fp(geminiPlugin)
