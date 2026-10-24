// Series recurrentes que estan por terminar. Una serie acotada (UNTIL, la que
// crea la app por 3 meses) o de fechas exactas (RDATE) deja de aparecer en
// Calendar, en Mi agenda, en la TV y en los avisos SIN ningun error cuando
// llega a su fin. Este aviso le dice a Direccion con tiempo que hay que
// reagendar la secuencia (Agendas -> la tarea -> Cambiar cuando).
//
// Reemplaza a la renovacion automatica del job reconciliar, que se pauso: ya
// no se renueva nada solo, se avisa.
import { esSerieDeFechas, ultimaFechaDeSerie } from './recurrencia.js'
import { sumarDiasISO } from './resumen-semanal.js'

export const DIAS_POR_TERMINAR = 30
// Una serie que termino hace mas que esto y sigue "activa" es un resto viejo:
// no se avisa para no repetirlo eternamente.
export const DIAS_DE_GRACIA = 7

// Ultima fecha en la que la serie todavia ocurre, o null si es infinita o
// de una sola vez.
export function finDeSerie(recurrence, startDate) {
  if (!recurrence?.length) return null
  if (esSerieDeFechas(recurrence)) return ultimaFechaDeSerie(recurrence, startDate)
  for (const regla of recurrence) {
    const m = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(regla)
    // El UNTIL de la plataforma es 00:00Z del dia siguiente al ultimo.
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

function diasEntre(desdeISO, hastaISO) {
  return Math.round((Date.parse(`${hastaISO}T00:00:00Z`) - Date.parse(`${desdeISO}T00:00:00Z`)) / 86400000)
}

// `filas`: [{ idTarea, tarea, departamento, local, fin }]. Devuelve un grupo por
// tarea (y departamento) con lo que vence dentro de la ventana, el mas urgente primero.
export function agruparPorTerminar(filas, { hoyISO, dias = DIAS_POR_TERMINAR }) {
  const limite = sumarDiasISO(hoyISO, dias)
  const piso = sumarDiasISO(hoyISO, -DIAS_DE_GRACIA)
  const grupos = new Map()
  for (const f of filas) {
    if (!f.fin || f.fin > limite || f.fin < piso) continue
    const k = `${f.departamento}|${f.tarea}`
    if (!grupos.has(k)) grupos.set(k, { tarea: f.tarea, departamento: f.departamento, locales: [], finMin: f.fin, finMax: f.fin })
    const g = grupos.get(k)
    g.locales.push(f.local)
    if (f.fin < g.finMin) g.finMin = f.fin
    if (f.fin > g.finMax) g.finMax = f.fin
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, diasMin: diasEntre(hoyISO, g.finMin) }))
    .sort((a, b) => a.diasMin - b.diasMin || a.tarea.localeCompare(b.tarea))
}

function fecha(iso) {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function cuando(dias) {
  if (dias < 0) return `terminó hace ${-dias} ${dias === -1 ? 'día' : 'días'}`
  if (dias === 0) return 'termina hoy'
  return `termina en ${dias} ${dias === 1 ? 'día' : 'días'}`
}

export function mensajePorTerminar(grupos, { dias = DIAS_POR_TERMINAR, urlApp } = {}) {
  const lineas = grupos.map((g) => {
    const locales = g.locales.length === 1 ? '1 local' : `${g.locales.length} locales`
    const rango = g.finMin === g.finMax ? fecha(g.finMin) : `${fecha(g.finMin)} al ${fecha(g.finMax)}`
    return `• *${g.tarea}* (${g.departamento}) — ${locales}: ${cuando(g.diasMin)} (${rango})`
  })
  const donde = urlApp ? `\n${urlApp}/agendas` : ''
  return [
    `⏳ *Tareas recurrentes por terminar (próximos ${dias} días)*`,
    '',
    ...lineas,
    '',
    'Cuando una serie termina, la tarea deja de aparecer en agendas, TV y avisos sin ningún error. ' +
      `Recomendación: reagendar la secuencia desde Agendas (elegí la tarea → Cambiar cuándo).${donde}`
  ].join('\n')
}
