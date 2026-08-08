import { GoogleAuth, Impersonated } from 'google-auth-library'

// En Cloud Run: sin GOOGLE_IMPERSONATE_SERVICE_ACCOUNT, usa la identidad
// adjunta al servicio directamente (Workload Identity) -- sin impersonar nada.
// En local dev: seteando GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=dc-plataforma-api@...,
// impersona esa cuenta desde la identidad ya logueada con `gcloud auth login`
// (necesita rol roles/iam.serviceAccountTokenCreator sobre esa SA). Nunca
// requiere descargar una key JSON, ni tocar el ADC global de la maquina.
const SCOPES = [process.env.GOOGLE_CALENDAR_SCOPE || 'https://www.googleapis.com/auth/calendar']

export async function crearAuthClient() {
  const targetPrincipal = process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT
  if (!targetPrincipal) {
    return new GoogleAuth({ scopes: SCOPES })
  }
  const sourceAuth = new GoogleAuth()
  const sourceClient = await sourceAuth.getClient()
  return new Impersonated({
    sourceClient,
    targetPrincipal,
    targetScopes: SCOPES,
    lifetime: 3600
  })
}
