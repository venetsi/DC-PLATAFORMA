// Formato de los mensajes de Chat. Separado del job para que la Chat App
// interactiva (Fase C) pueda reusar el mismo texto dentro de sus cards en vez
// de reescribirlo.
import { agruparDelDia, marcaDependencia, rangoTexto, sumarDiasISO, tituloDia } from './resumen-semanal.js'

function nombreDeLocal(props, nombreLocal) {
  if (!props.id_local_ext) return 'Toda la empresa'
  return nombreLocal.get(props.id_local_ext) || 'Local sin nombre'
}

function antiguedad(dias) {
  if (!dias || dias <= 0) return ''
  return dias === 1 ? ' _(hace 1 día hábil)_' : ` _(hace ${dias} días hábiles)_`
}

// Una linea por tarea.
//
// Usa `nombre_tarea` y NO `summary`: desde que el titulo del evento lleva el
// local y el grupo (ver lib/titulo.js, para que se entienda dentro del propio
// Google Calendar), armar la linea con el summary producia
// "• CMV — MAFIA (GRUPO MAFIA) (MAFIA)". El fallback al summary cubre los
// eventos creados antes de que existiera esa property.
// `conDepartamento` es para el "modo todo" de Dirección (ver chat-comandos.js):
// cuando una lista mezcla varios departamentos, cada línea tiene que decir de
// cuál es, porque el local ya no alcanza para ubicarla. Los items siguen
// siendo los mismos en todos lados; el departamento es un campo mas que se
// ignora si no se pide.
export function lineaDeTarea({ evento, dias, departamento }, nombreLocal, { conAntiguedad = false, conDepartamento = false } = {}) {
  const props = evento.extendedProperties?.private || {}
  const titulo = props.nombre_tarea || evento.summary
  const responsable = props.asignado_a ? ` — ${props.asignado_a}` : ''
  const depto = conDepartamento && departamento ? ` [${departamento.nombre}]` : ''
  return `• ${titulo} (${nombreDeLocal(props, nombreLocal)})${depto}${responsable}${conAntiguedad ? antiguedad(dias) : ''}`
}

// Recordatorio diario de un departamento. Se sigue mandando todos los dias
// mientras la tarea siga sin hacerse -- es un reporte de aging, no una alerta
// de una sola vez (marcar "ya avise" exigiria escribir una excepcion por
// instancia por dia en Calendar, con su costo de cuota).
export function mensajeDepartamento(departamento, baldes, nombreLocal, { umbrales } = {}) {
  const { pendientes_hoy: pendientesHoy, vencidas, escala_departamento: escaladas } = baldes
  const idsEscaladas = new Set(escaladas.map((e) => e.evento.id))
  const resto = vencidas.filter((v) => !idsEscaladas.has(v.evento.id))

  const bloques = [`📋 *Recordatorio diario — ${departamento.nombre}*`]

  if (escaladas.length) {
    const umbral = umbrales?.departamento
    const encabezado = umbral
      ? `\n🚨 *Atrasadas ${umbral}+ días hábiles:*`
      : '\n🚨 *Atrasadas:*'
    bloques.push(`${encabezado}\n${escaladas.map((v) => lineaDeTarea(v, nombreLocal, { conAntiguedad: true })).join('\n')}`)
  }
  if (resto.length) {
    bloques.push(`\n⚠️ *Vencidas:*\n${resto.map((v) => lineaDeTarea(v, nombreLocal, { conAntiguedad: true })).join('\n')}`)
  }
  if (pendientesHoy.length) {
    bloques.push(`\n🕒 *Pendientes de hoy:*\n${pendientesHoy.map((v) => lineaDeTarea(v, nombreLocal)).join('\n')}`)
  }

  return bloques.join('\n')
}

// UN solo mensaje consolidado a Direccion, agrupado por departamento y
// ordenado por antiguedad -- no un mensaje por departamento, que convertiria
// el Space de Direccion en una lista de 11 avisos sueltos cada mañana.
export function mensajeDireccion(porDepartamento, nombreLocal, { umbral } = {}) {
  const total = porDepartamento.reduce((n, d) => n + d.items.length, 0)
  const encabezado = umbral
    ? `🚨 *Escalamiento — tareas con ${umbral}+ días hábiles de atraso*`
    : '🚨 *Escalamiento — tareas atrasadas*'

  const bloques = [`${encabezado}\n${total} ${total === 1 ? 'tarea' : 'tareas'} sin resolver.`]

  // El departamento con la tarea mas vieja va primero.
  const ordenados = [...porDepartamento].sort(
    (a, b) => Math.max(...b.items.map((i) => i.dias)) - Math.max(...a.items.map((i) => i.dias))
  )
  for (const { departamento, items } of ordenados) {
    bloques.push(
      `\n*${departamento.nombre}*\n${items.map((v) => lineaDeTarea(v, nombreLocal, { conAntiguedad: true })).join('\n')}`
    )
  }

  return bloques.join('\n')
}

// ── Resumen semanal de los lunes, en texto (para los que siguen con webhook) ─
// Mismo contenido que cardSemanal / cardResumenDireccion, sin botones.

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`
}

function rangoLaV(semana) {
  return rangoTexto(semana.desde, sumarDiasISO(semana.desde, 4))
}

export function mensajeSemanal(departamento, datos, nombreLocal, { hoyISO } = {}) {
  const { semana, vencidas, porDia, dependencias } = datos
  const bloques = [`📅 *Tu semana — ${departamento.nombre}* (${rangoLaV(semana)})`]
  if (vencidas.length) {
    const lineas = vencidas.map((v) => {
      const marca = marcaDependencia(v.evento, dependencias)
      return lineaDeTarea(v, nombreLocal, { conAntiguedad: true }) + (marca ? ` · ${marca}` : '')
    })
    bloques.push(`\n🚨 *Atrasadas (${vencidas.length}):*\n${lineas.join('\n')}`)
  }
  for (const { fecha, eventos } of porDia) {
    const lineas = agruparDelDia(eventos, nombreLocal, dependencias).map(({ titulo, persona, marca, locales }) =>
      [`• ${titulo} › ${locales.join(', ')}`, persona.split('@')[0], marca].filter(Boolean).join(' · ')
    )
    bloques.push(`\n*${tituloDia(fecha, hoyISO)}* — ${plural(eventos.length, 'tarea', 'tareas')}\n${lineas.join('\n')}`)
  }
  if (bloques.length === 1) bloques.push('No hay tareas esta semana ni atrasadas.')
  return bloques.join('\n')
}

export function mensajeResumenDireccion({ semana, filas, sinNada = [], ranking = [], pasadaTotal }) {
  const pct = (p) => (p?.total ? Math.round((p.hechas / p.total) * 100) : null)
  const global = pct(pasadaTotal)
  const bloques = [
    `📊 *Resumen semanal por departamento* (${rangoLaV(semana)})` +
      (global !== null ? `\nSemana pasada: ${global}% cumplido (${pasadaTotal.hechas} de ${pasadaTotal.total})` : '')
  ]
  bloques.push(
    '\n' +
      filas
        .map(({ departamento, total, atrasadas, pasada }) => {
          const p = pct(pasada)
          return `• *${departamento.nombre}* — ${plural(total, 'tarea esta semana', 'tareas esta semana')} · ${plural(atrasadas, 'atrasada', 'atrasadas')}` +
            (p !== null ? ` · semana pasada: ${p}%` : '')
        })
        .join('\n')
  )
  if (sinNada.length) bloques.push(`_Sin tareas esta semana ni atrasadas: ${sinNada.join(', ')}_`)
  if (ranking.length) {
    bloques.push(
      '\n*Atrasadas por responsable:*\n' +
        ranking
          .map((r) => `• ${r.quien.includes('@') ? r.quien.split('@')[0] : r.quien} — ${plural(r.atrasadas, 'atrasada', 'atrasadas')}`)
          .join('\n')
    )
  }
  return bloques.join('\n')
}
