// Reintenta ante cuota o error transitorio de Calendar (403 de cuota, 429,
// 5xx), con espera creciente de 1, 2 y 4 s. Lo usan los jobs: antes no
// reintentaban "porque un 429 se resuelve en la corrida siguiente", pero la
// corrida siguiente es MAÑANA, y un solo 429 le sacaba el recordatorio de todo
// el dia a un departamento. (El servidor tiene su propio withBackoff en
// plugins/gcal.js.)
const REINTENTABLES = new Set([403, 429, 500, 502, 503, 504])

// Un 403 solo es transitorio si es de cuota. Uno de permisos reales (un
// calendario no compartido con la cuenta de servicio) no se arregla esperando:
// reintentarlo gasta 7 s por llamada para nada. Sin "reason" se asume cuota.
function esDeCuota(err) {
  const razon = String(err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason || '')
  return !razon || /rate|quota/i.test(razon)
}

// `codigos`: estados que se reintentan. Para POSTEAR en Chat se pasan solo los
// que seguro no se procesaron (429, 503): un 500/502/504 es ambiguo, el mensaje
// pudo haberse creado, y reintentarlo lo duplicaria.
export async function conReintento(fn, { intentos = 4, esperaBaseMs = 1000, codigos = REINTENTABLES } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const status = err?.code || err?.response?.status
      if (i >= intentos - 1 || !codigos.has(status) || (status === 403 && !esDeCuota(err))) throw err
      await new Promise((resolve) => setTimeout(resolve, esperaBaseMs * 2 ** i))
    }
  }
}
