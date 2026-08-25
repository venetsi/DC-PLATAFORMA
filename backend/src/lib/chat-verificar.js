// Verificacion del token que Google Chat manda en CADA request al endpoint.
//
// El endpoint /api/chat/eventos es publico (Chat no puede mandar nuestro JWT),
// asi que esto es lo unico que separa "un evento real de Google" de "cualquiera
// que descubra la URL y postee un JSON". Sin esto, un POST anonimo podria
// marcar tareas como hechas.
//
// FAIL-CLOSED a proposito: si CHAT_AUDIENCE no esta configurada, se rechaza con
// 503 en vez de dejar pasar sin verificar. Un endpoint de escritura que se abre
// solo cuando falta una variable de entorno es la clase de agujero que nadie
// nota hasta que lo usan.
import { OAuth2Client } from 'google-auth-library'

// Google firma estos tokens con una de dos identidades, segun como quedo
// publicada la app: las apps de Chat "clasicas" firman con la cuenta de
// sistema generica de Chat; las publicadas via Google Workspace Marketplace
// SDK / Add-ons (el camino que este proyecto tuvo que usar para que la app
// apareciera al buscarla) firman con un service agent PROPIO del proyecto
// (numero 288069746644 = dc-smart-mvp). Confirmado con un ADDED_TO_SPACE real
// en produccion -- verifyIdToken ya habia validado firma y audiencia antes de
// llegar a este chequeo, asi que el email es autentico.
const EMISORES_CHAT_VALIDOS = [
  'chat@system.gserviceaccount.com',
  'service-288069746644@gcp-sa-gsuiteaddons.iam.gserviceaccount.com'
]

const cliente = new OAuth2Client()

export class ChatNoConfigurado extends Error {}
export class ChatTokenInvalido extends Error {}

// Devuelve el payload verificado, o tira. Nunca devuelve "no pude verificar
// pero segui".
export async function verificarPeticionDeChat(request) {
  const audiencia = process.env.CHAT_AUDIENCE
  if (!audiencia) {
    throw new ChatNoConfigurado('CHAT_AUDIENCE no está configurada')
  }

  const header = request.headers.authorization || ''
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!idToken) throw new ChatTokenInvalido('Falta el bearer token')

  let ticket
  try {
    ticket = await cliente.verifyIdToken({ idToken, audience: audiencia })
  } catch (err) {
    throw new ChatTokenInvalido(`Token inválido: ${err.message}`)
  }

  const payload = ticket.getPayload()
  // verifyIdToken ya valida firma, expiracion y audiencia. Falta el emisor:
  // sin este chequeo, un token de CUALQUIER service account de Google emitido
  // para esta misma audiencia pasaria.
  if (!EMISORES_CHAT_VALIDOS.includes(payload?.email)) {
    throw new ChatTokenInvalido(`Emisor inesperado: ${payload?.email || '(ninguno)'}`)
  }

  return payload
}
