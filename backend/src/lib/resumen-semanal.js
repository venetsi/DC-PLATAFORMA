// Resumen semanal de los lunes 8:00 (pedido del usuario, 2026-09-29): "empujar
// a que realicen sus tareas y no se olviden".
//
//   - A cada departamento con Space: las atrasadas (con boton para marcarlas) y
//     las tareas de la semana, dia por dia. Ese dia REEMPLAZA al recordatorio
//     diario, para que no lleguen dos mensajes a las 8.
//   - A Direccion: totales por departamento, el cumplimiento de la semana
//     pasada y un ranking de atrasadas por responsable.
//
// Lo puro (semana, clasificacion, cumplimiento, ranking) no hace I/O y se prueba
// en resumen-semanal.test.js; datosSemanaDepartamento es lo unico que lee
// Calendar, y lo comparten el job y el receptor de clicks de Chat.
import { clasificarInstancia, diasHabilesVencida, estaHecha, fechaDeInstancia, hoyEnArgentina } from './vencimiento.js'
import { mapaDependencias } from './dependencias.js'
import { DIAS_MINIMOS, desdeHaceNDias, finDeHoyArgentina } from './ventana-avisos.js'

export function sumarDiasISO(fechaISO, n) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

// 1 = lunes ... 7 = domingo
export function diaDeLaSemana(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() || 7
}

// Los lunes va el resumen semanal EN LUGAR del recordatorio diario.
// AVISO_MODO=semanal|diario lo fuerza, para probar sin esperar al lunes.
export function modoDelAviso(hoyISO, pedido = process.env.AVISO_MODO) {
  const forzado = (pedido || '').trim().toLowerCase()
  if (forzado === 'semanal' || forzado === 'diario') return forzado
  return diaDeLaSemana(hoyISO) === 1 ? 'semanal' : 'diario'
}

const NOMBRE_DIA =['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// "5 al 9 de octubre", o "29 de septiembre al 3 de octubre" si cruza de mes.
export function rangoTexto(desde, hasta) {
  const [, m1, d1] = desde.split('-').map(Number)
  const [, m2, d2] = hasta.split('-').map(Number)
  if (m1 === m2) return `${d1} al ${d2} de ${MESES[m2 - 1]}`
  return `${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]}`
}

// "Martes 6", "Lunes 5 (hoy)".
export function tituloDia(fechaISO, hoyISO) {
  const d = Number(fechaISO.slice(8, 10))
  return `${NOMBRE_DIA[diaDeLaSemana(fechaISO)]} ${d}${fechaISO === hoyISO ? ' (hoy)' : ''}`
}

export function localDe(props, nombreLocal) {
  if (!props.id_local_ext) return 'Toda la empresa'
  return nombreLocal.get(props.id_local_ext) || 'Local sin nombre'
}

function resumirNombres(lista) {
  const nombres = [...new Set(lista.map((n) => n.nombre_tarea))]
  return nombres.length > 1 ? `${nombres[0]} y ${nombres.length - 1} más` : nombres[0]
}

// La misma marca que la agenda y la TV: ⏳ lo que falta, 🔗 a quien frena.
export function marcaDependencia(evento, dependencias) {
  const props = evento.extendedProperties?.private || {}
  const d = dependencias?.get(`${props.id_asignacion}|${fechaDeInstancia(evento)}`)
  if (!d) return ''
  if (d.espera?.length) return `⏳ espera a ${resumirNombres(d.espera)}`
  if (d.la_espera?.length) return `🔗 sigue con ${resumirNombres(d.la_espera)}`
  return ''
}

// Las tareas de un dia, una linea por (tarea, grupo de locales), sin importar
// el responsable (pedido del usuario): "P&L" de TITA-CH y DARKI el mismo dia
// es "P&L › GRUPO TITA". Un local solo de su grupo, o sin grupo, se nombra por
// el local. Los responsables y las marcas de la linea son los de todos sus
// locales, sin repetir. `grupoLocal`: Map<id_local_ext, grupo>.
export function agruparDelDia(eventos, nombreLocal, dependencias, grupoLocal = new Map()) {
  const lineas = new Map()
  for (const evento of eventos) {
    const props = evento.extendedProperties?.private || {}
    const titulo = props.nombre_tarea || evento.summary || 'Tarea'
    const local = localDe(props, nombreLocal)
    const grupo = (props.id_local_ext && grupoLocal.get(props.id_local_ext)) || null
    const prioridad = props.prioridad === 'ALTA' ? 'ALTA' : props.prioridad === 'NORMAL' ? 'NORMAL' : null
    const clave = `${titulo}|${grupo ? `g:${grupo}` : `l:${local}`}|${prioridad || ''}`
    if (!lineas.has(clave)) lineas.set(clave, { titulo, prioridad, grupo, locales: new Set(), personas: new Set(), marcas: new Set() })
    const linea = lineas.get(clave)
    linea.locales.add(local)
    const persona = (props.asignado_a || '').trim().toLowerCase()
    if (persona) linea.personas.add(persona)
    const marca = marcaDependencia(evento, dependencias)
    if (marca) linea.marcas.add(marca)
  }
  const ordenar = (s) => [...s].sort((a, b) => a.localeCompare(b))
  return [...lineas.values()]
    .map(({ titulo, prioridad, grupo, locales, personas, marcas }) => ({
      titulo,
      prioridad,
      // Con un solo local, el nombre del local dice mas que el del grupo.
      donde: grupo && locales.size > 1 ? grupo : ordenar(locales).join(', '),
      locales: ordenar(locales),
      personas: ordenar(personas),
      marcas: ordenar(marcas)
    }))
    // Urgentes (rojo) primero dentro del dia.
    .sort((a, b) => (a.prioridad === 'ALTA' ? 0 : 1) - (b.prioridad === 'ALTA' ? 0 : 1) || a.titulo.localeCompare(b.titulo) || a.donde.localeCompare(b.donde))
}

// De lunes a domingo de la semana de `hoyISO`, y la anterior.
export function semanaDe(hoyISO) {
  const lunes = sumarDiasISO(hoyISO, 1 - diaDeLaSemana(hoyISO))
  return {
    desde: lunes,
    hasta: sumarDiasISO(lunes, 6),
    pasada: { desde: sumarDiasISO(lunes, -7), hasta: sumarDiasISO(lunes, -1) }
  }
}

// Las atrasadas (mas vieja primero, en dias habiles) y lo que queda por hacer
// en la semana, agrupado por dia. Lo hecho o "no aplica" no entra.
export function clasificarSemana(instancias, { hoyISO, semana, referencia = new Date() }) {
  const vencidas = []
  const porFecha = new Map()
  for (const evento of instancias) {
    const { hecha, vencida, fechaISO } = clasificarInstancia(evento, { referencia })
    if (hecha || !fechaISO) continue
    if (vencida) vencidas.push({ evento, dias: diasHabilesVencida(evento, { hoyISO }) })
    else if (fechaISO >= semana.desde && fechaISO <= semana.hasta) {
      if (!porFecha.has(fechaISO)) porFecha.set(fechaISO, [])
      porFecha.get(fechaISO).push(evento)
    }
  }
  vencidas.sort((a, b) => b.dias - a.dias)
  const porDia = [...porFecha.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, eventos]) => ({ fecha, eventos }))
  return { vencidas, porDia, total: porDia.reduce((n, d) => n + d.eventos.length, 0) }
}

// Cumplimiento de un tramo ya pasado: hechas sobre lo que vencio. "No aplica"
// no cuenta ni arriba ni abajo (mismo criterio que el tablero de Reportes).
export function cumplimientoDelTramo(instancias, { desde, hasta, referencia = new Date() }) {
  let hechas = 0
  let total = 0
  for (const evento of instancias) {
    const { hecha, vencida, noAplica, fechaISO } = clasificarInstancia(evento, { referencia })
    if (!fechaISO || fechaISO < desde || fechaISO > hasta || noAplica) continue
    if (hecha) { hechas++; total++ } else if (vencida) total++
  }
  return { hechas, total }
}

// Junta las instancias de varios calendarios sin contar dos veces una tarea
// compartida (cada departamento tiene su copia). Si las copias no coinciden,
// gana la hecha: la propagacion pudo no haber llegado todavia a las otras.
export function unirSinDuplicados(listas) {
  const porClave = new Map()
  for (const items of listas) {
    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const clave = `${props.id_asignacion || evento.id}|${fechaDeInstancia(evento)}`
      const actual = porClave.get(clave)
      if (!actual || (!estaHecha(actual.extendedProperties?.private) && estaHecha(props))) porClave.set(clave, evento)
    }
  }
  return [...porClave.values()]
}

// Los Spaces combinados: los que tienen departamentos compartidos (ver
// vincularDepartamentos), con o sin dueño. `departamentos`: los que se evaluan
// (activos con calendario); `compartidos`: filas de DepartamentoCompartidoEnSpace.
// Devuelve [{ space, dueño, departamentos }], el dueño primero y el resto por
// nombre. Esos Spaces reciben UNA tarjeta semanal con todos juntos, y el dueño
// no recibe ademas la suya ahi.
export function espaciosCombinados(departamentos, compartidos) {
  const porId = new Map(departamentos.map((d) => [d.id, d]))
  const porSpace = new Map()
  for (const { chat_space_name: space, id_departamento: id } of compartidos) {
    if (!space || !porId.has(id)) continue
    if (!porSpace.has(space)) porSpace.set(space, new Set())
    porSpace.get(space).add(id)
  }
  return [...porSpace.entries()].map(([space, ids]) => {
    const dueño = departamentos.find((d) => d.chat_space_name === space) || null
    const resto = [...ids].filter((id) => id !== dueño?.id).map((id) => porId.get(id)).sort((a, b) => a.nombre.localeCompare(b.nombre))
    return { space, dueño, departamentos: dueño ? [dueño, ...resto] : resto }
  })
}

// Ranking de atrasadas por responsable, entre todos los departamentos. Una
// tarea compartida aparece en el calendario de cada departamento: se cuenta
// una sola vez. Sin responsable fijo, se cuenta como "Equipo — <departamento>".
export function rankingPorResponsable(porDepartamento, { maximo = 10 } = {}) {
  const vistas = new Set()
  const porPersona = new Map()
  for (const { departamento, vencidas } of porDepartamento) {
    for (const { evento, dias } of vencidas) {
      const props = evento.extendedProperties?.private || {}
      const clave = `${props.id_asignacion || evento.id}|${fechaDeInstancia(evento)}`
      if (vistas.has(clave)) continue
      vistas.add(clave)
      const quien = (props.asignado_a || '').toLowerCase().trim() || `Equipo — ${departamento.nombre}`
      const actual = porPersona.get(quien) || { quien, atrasadas: 0, masVieja: 0 }
      actual.atrasadas++
      actual.masVieja = Math.max(actual.masVieja, dias)
      porPersona.set(quien, actual)
    }
  }
  return [...porPersona.values()]
    .sort((a, b) => b.atrasadas - a.atrasadas || b.masVieja - a.masVieja || a.quien.localeCompare(b.quien))
    .slice(0, maximo)
}

// Todo lo de UN departamento para el resumen, con una sola lectura de su
// calendario (60 dias atras, para las atrasadas y la semana pasada, hasta el
// domingo). `gcal` es el plugin del servidor o el listarInstancias del job:
// los dos tienen la misma firma.
export async function datosSemanaDepartamento({ db, gcal, log = console }, departamento, { hoyISO = hoyEnArgentina(), referencia = new Date() } = {}) {
  const semana = semanaDe(hoyISO)
  const items = await gcal.listarInstancias({
    calendarId: departamento.id_calendar_google,
    timeMin: desdeHaceNDias(DIAS_MINIMOS),
    timeMax: finDeHoyArgentina(semana.hasta),
    maxPaginas: 40
  })
  // Una lectura truncada trae lo mas viejo y deja afuera la semana: mejor
  // decirlo (el departamento queda "sin leer") que mandar un resumen a medias.
  if (items.truncado) throw new Error('lectura truncada: hay mas eventos de los que se pudieron traer')
  const { vencidas, porDia, total } = clasificarSemana(items, { hoyISO, semana, referencia })
  // Las etiquetas de dependencias ("espera a...") de lo que queda por hacer,
  // atrasadas incluidas: explican por que una sigue sin hacerse.
  const dependencias = db
    ? await mapaDependencias({ db, gcal, log }, { instancias: [...vencidas.map((v) => v.evento), ...porDia.flatMap((d) => d.eventos)] })
    : new Map()
  const pasada = cumplimientoDelTramo(items, { ...semana.pasada, referencia })
  return { departamento, semana, vencidas, porDia, total, dependencias, pasada, items }
}
