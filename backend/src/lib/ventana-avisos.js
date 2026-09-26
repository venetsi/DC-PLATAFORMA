// Ventana de tiempo para leer instancias de Calendar al armar un aviso o
// recordatorio. Extraido de jobs/avisosChat.js (que lo uso primero) para que
// lib/chat-recordatorio.js -- que reconstruye la card de UN departamento
// despues de un click -- use el mismo criterio y no se desincronicen.
export const DIAS_MINIMOS = 60 // antes 14: a los ~10 dias habiles lo mas atrasado salia del aviso y del escalamiento sin avisar

export function desdeHaceNDias(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

// Fin del dia de hoy en Argentina = 03:00 UTC del dia siguiente (UTC-3 todo el
// año). Con el fin del dia UTC se perdian las tareas de hoy entre las 21:00 y
// la medianoche local.
export function finDeHoyArgentina(hoyISO) {
  const [a, m, d] = hoyISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1, 3, 0, 0)).toISOString()
}
