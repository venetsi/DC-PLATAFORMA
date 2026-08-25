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

// Google firma estos tokens con la cuenta de sistema de Chat.
const EMISOR_CHAT = 'chat@system.gserviceaccount.com'

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
  if (payload?.email !== EMISOR_CHAT) {
    throw new ChatTokenInvalido(`Emisor inesperado: ${payload?.email || '(ninguno)'}`)
  }

  return payload
}
