// Corrida UNICA: crea el store "general" de Gemini File Search (documentos
// visibles desde cualquier Space, sin depender de un departamento). No hay
// donde persistir su id (no pertenece a ninguna fila), asi que se crea una
// vez, se loguea el resource name, y se pega a mano como env var
// GEMINI_STORE_GENERAL_ID en Cloud Run -- mismo patron ya usado para
// CHAT_AUDIENCE (ver docs/CONFIGURAR-CHAT-APP.md).
//
// Requiere GEMINI_API_KEY ya seteada en el entorno donde se corre esto.
import 'dotenv/config'
import { GoogleGenAI } from '@google/genai'

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY en el entorno.')
  process.exit(1)
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const store = await ai.fileSearchStores.create({ config: { displayName: 'DC-PLATAFORMA — General' } })

console.log('Store general creado:', store.name)
console.log('Pegalo como GEMINI_STORE_GENERAL_ID en el entorno de Cloud Run (y en tu .env local si vas a probar seguido).')
