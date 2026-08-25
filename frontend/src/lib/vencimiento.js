// Gemelo de backend/src/lib/vencimiento.js.
//
// Es duplicacion deliberada: no hay paquete compartido entre backend/ y
// frontend/ en este proyecto (el frontend nunca importa del backend, misma
// convencion que dcsmart). Si cambia el criterio, hay que tocar los dos --
// por eso se mantiene chico y con los mismos nombres de funcion.

export const ZONA = 'America/Argentina/Buenos_Aires'

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

export function hoyEnArgentina(ahora = new Date()) {
  return FORMATO_DIA.format(ahora)
}

export function fechaDeInstancia(evento) {
  const inicio = evento?.start?.date || evento?.start?.dateTime
  return inicio ? String(inicio).slice(0, 10) : null
}

// El instante en que la instancia deja de estar a tiempo: medianoche
// argentina del dia siguiente. NO se usa end.date directo porque es
// exclusivo y esta en UTC -- con eso, una tarea de hoy figuraba vencida a
// las 21:00 hora local.
export function finDeInstancia(evento) {
  const fechaISO = fechaDeInstancia(evento)
  if (!fechaISO) return null
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1, 3, 0, 0))
}

export function estaHecha(props) {
  return props?.estado === 'REALIZADA' || props?.estado === 'APROBADA'
}

export function clasificarInstancia(evento, { referencia = new Date() } = {}) {
  const props = evento?.extendedProperties?.private || {}
  const hecha = estaHecha(props)
  const fin = finDeInstancia(evento)
  const vencida = !hecha && !!fin && referencia > fin
  return {
    hecha,
    vencida,
    estado: hecha ? 'realizada' : vencida ? 'vencida' : 'pendiente',
    fechaISO: fechaDeInstancia(evento)
  }
}

function aUTCMediodia(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return Date.UTC(a, m - 1, d, 12)
}

// Dias de calendario entre la fecha de la tarea y hoy (nunca negativo).
export function diasVencida(evento, { hoyISO = hoyEnArgentina() } = {}) {
  const fechaISO = fechaDeInstancia(evento)
  if (!fechaISO) return 0
  const dias = Math.round((aUTCMediodia(hoyISO) - aUTCMediodia(fechaISO)) / 86400000)
  return dias > 0 ? dias : 0
}
