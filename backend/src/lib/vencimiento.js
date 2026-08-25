// Criterio UNICO de "hecha" / "vencida" / "cuantos dias lleva vencida".
//
// Antes esto estaba escrito tres veces con reglas que no coincidian:
//   - jobs/avisosChat.js filtraba server-side por estado=PENDIENTE, asi que un
//     evento SIN la property `estado` quedaba fuera del query y no se avisaba nunca.
//   - routes/tv.js clasificaba en memoria, y ese mismo evento SI contaba vencido.
//   - jobs/snapshotCumplimiento.js igual que tv.js pero contra el fin del dia
//     snapshoteado en vez de contra `now`.
// Ahora los tres importan de aca. La regla que gana es la de tv.js (la mas
// permisiva): sin `estado` explicito, la tarea NO esta hecha.
//
// Modulo puro y sin I/O a proposito: lo importan tanto las rutas de Fastify
// como los jobs standalone (que no levantan el server, ver jobs/lib.js).

// La operacion es en Argentina, no en UTC. Antes todo el codigo usaba Date.UTC
// y toISOString(), y como `end.date` de un evento all-day es EXCLUSIVO
// (asignaciones.js crea endDate = startDate + 1 dia), una tarea del lunes
// pasaba a "vencida" el lunes 21:00 hora local -- tres horas antes de que
// terminara el dia. Con el corte en hora argentina vence a la medianoche.
export const ZONA = 'America/Argentina/Buenos_Aires'

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

// 'YYYY-MM-DD' del dia en curso en Argentina. 'en-CA' ya formatea asi, sin
// tener que reordenar partes a mano ni sumar una libreria de fechas.
export function hoyEnArgentina(ahora = new Date()) {
  return FORMATO_DIA.format(ahora)
}

// 'YYYY-MM-DD' de la fecha de la instancia. Los eventos de esta app son
// all-day (start.date), pero se contempla dateTime por si algun evento se
// creo a mano desde Google Calendar.
export function fechaDeInstancia(evento) {
  const inicio = evento?.start?.date || evento?.start?.dateTime
  return inicio ? String(inicio).slice(0, 10) : null
}

// El instante en que la instancia deja de estar "a tiempo": la medianoche
// argentina del dia siguiente al de la tarea. NO se usa evento.end.date
// directamente porque es exclusivo y esta en UTC -- ver el comentario de ZONA.
export function finDeInstancia(evento) {
  const fechaISO = fechaDeInstancia(evento)
  if (!fechaISO) return null
  const [a, m, d] = fechaISO.split('-').map(Number)
  // Argentina es UTC-3 todo el año (sin horario de verano desde 2009), asi que
  // la medianoche del dia siguiente en Argentina son las 03:00 UTC.
  return new Date(Date.UTC(a, m - 1, d + 1, 3, 0, 0))
}

export const ESTADOS_HECHA = ['REALIZADA', 'APROBADA']

// APROBADA es del diseño de la Fase 9 (aprobacion real): todavia no se escribe
// en ningun lado, pero se lee como sinonimo de hecha desde el dia uno.
export function estaHecha(props) {
  return ESTADOS_HECHA.includes(props?.estado)
}

// Un solo lugar donde se decide el estado de una instancia.
// `referencia` es el instante contra el que se compara: `new Date()` en vivo,
// o el fin del dia snapshoteado en el job de cumplimiento.
export function clasificarInstancia(evento, { referencia = new Date() } = {}) {
  const props = evento?.extendedProperties?.private || {}
  const hecha = estaHecha(props)
  const fin = finDeInstancia(evento)
  const vencida = !hecha && !!fin && referencia > fin
  return {
    hecha,
    vencida,
    estado: hecha ? 'realizada' : vencida ? 'vencida' : 'pendiente',
    fechaISO: fechaDeInstancia(evento),
    fin
  }
}

function aUTCMediodia(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  // Mediodia y no medianoche para que restar dos fechas nunca se vea afectado
  // por un salto de hora: la diferencia siempre cae en un multiplo exacto de 24h.
  return Date.UTC(a, m - 1, d, 12)
}

const UN_DIA_MS = 24 * 60 * 60 * 1000

// Dias de CALENDARIO entre la fecha de la tarea y hoy. A proposito NO es
// (ahora - fin)/86400000: con eso, una tarea de hoy que ya "vencio" daria
// fracciones raras. Una tarea del lunes mirada el jueves da 3, que es lo que
// diria una persona.
export function diasVencida(evento, { hoyISO = hoyEnArgentina() } = {}) {
  const fechaISO = fechaDeInstancia(evento)
  if (!fechaISO) return 0
  const dias = Math.round((aUTCMediodia(hoyISO) - aUTCMediodia(fechaISO)) / UN_DIA_MS)
  return dias > 0 ? dias : 0
}

// Dias HABILES (lunes a viernes) de atraso -- es lo que usan los umbrales de
// escalamiento. Las tareas de DCSMART van de lunes a viernes: con dias de
// calendario, una tarea del viernes escalaria sola el lunes solo por haber
// pasado el fin de semana.
export function diasHabilesVencida(evento, { hoyISO = hoyEnArgentina() } = {}) {
  const fechaISO = fechaDeInstancia(evento)
  if (!fechaISO) return 0

  let habiles = 0
  const cursor = new Date(aUTCMediodia(fechaISO))
  const fin = aUTCMediodia(hoyISO)
  while (cursor.getTime() < fin) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const dia = cursor.getUTCDay()
    if (dia !== 0 && dia !== 6) habiles++
  }
  return habiles
}
