// Adonde volver despues de entrar. En produccion se entra por dcsmart ->
// Tareas, que abre OTRA pestaña en /sso: el ?volver= de la pestaña original no
// llega hasta ahi. Por eso el destino pendiente tambien se guarda en
// localStorage (lo comparten las pestañas del mismo sitio; sessionStorage no),
// con vencimiento corto. Lo usa, por ejemplo, el QR de una TV (/tv?codigo=...).
const CLAVE = 'dc_plataforma_volver'
const VIDA_MS = 15 * 60 * 1000

// Solo destinos internos: evita que ?volver= mande a otro sitio ("//x.com" y
// "/\x.com" los navegadores los toman como otro dominio).
export function destinoSeguro(volver) {
  return typeof volver === 'string' && volver.startsWith('/') && !volver.startsWith('//') && !volver.includes('\\') ? volver : '/'
}

export function guardarDestino(volver) {
  const destino = destinoSeguro(volver)
  if (destino === '/') return
  try { localStorage.setItem(CLAVE, JSON.stringify({ destino, en: Date.now() })) } catch { /* sin almacenamiento: se vuelve al inicio */ }
}

// Lo devuelve (si sigue vigente) y lo borra: se usa una sola vez.
export function tomarDestino() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE))
    localStorage.removeItem(CLAVE)
    if (guardado && Date.now() - guardado.en < VIDA_MS) return destinoSeguro(guardado.destino)
  } catch { /* nada guardado */ }
  return null
}
