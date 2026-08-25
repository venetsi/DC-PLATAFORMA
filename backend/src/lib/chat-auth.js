// Credencial para POSTEAR en Chat como la app (app auth, scope chat.bot).
//
// A diferencia de Directory API (ver directory-auth.js), esto NO necesita
// domain-wide delegation ni una key descargada: la app de Chat actua como
// ella misma, no en nombre de un usuario. Se reusa el mismo patron que
// gcal-auth.js -- ADC en Cloud Run, impersonacion en local.
//
// Verificado con un spike antes de construir la fase: el token con scope
// chat.bot se obtiene sin problema por impersonacion. Lo unico que falta para
// que la API responda es tener la app configurada en la consola (sin eso,
// cualquier llamada devuelve 404 "Google Chat app not found").
import { GoogleAuth, Impersonated } from 'google-auth-library'
import { google } from 'googleapis'

const SCOPES = ['https://www.googleapis.com/auth/chat.bot']

async function crearAuthClient() {
  const targetPrincipal = process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT
  if (!targetPrincipal) return new GoogleAuth({ scopes: SCOPES })

  const sourceClient = await new GoogleAuth().getClient()
  return new Impersonated({ sourceClient, targetPrincipal, targetScopes: SCOPES, lifetime: 3600 })
}

let chatPromise
export function getChat() {
  chatPromise ??= crearAuthClient().then((auth) => google.chat({ version: 'v1', auth }))
  return chatPromise
}
