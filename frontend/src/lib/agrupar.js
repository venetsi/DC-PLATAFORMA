import { clasificarInstancia, diasVencida, hoyEnArgentina } from './vencimiento.js'

// Agrupa eventos crudos de Calendar por dia y, dentro de cada dia, por
// nombre de local -- mismo agrupamiento que usa el kiosko (ver
// kiosko/index.html:pintarSemana), para que la vista "Agenda" de gestion
// se sienta la misma pantalla. Los eventos "sin local" (alcance empresa)
// quedan en su propio grupo "Toda la empresa".
// Un evento crudo de Calendar -> la tarea tal como la muestran la agenda y el
// detalle. Exportado para que la vista Semana/Mes abra el mismo detalle.
export function aTarea(ev, mapaLocales, hoyISO = hoyEnArgentina()) {
  const props = ev.extendedProperties?.private || {}
  const idLocal = props.id_local_ext || null
  const { estado, fechaISO } = clasificarInstancia(ev)
  return {
    id: ev.id,
    fechaISO,
    idLocal,
    local: idLocal ? mapaLocales.get(idLocal) || 'Local sin nombre' : 'Toda la empresa',
    // El summary lleva el local/grupo (ver backend lib/titulo.js) para que
    // se entienda en Google Calendar; acá se usa el nombre limpio porque
    // esta vista ya agrupa por local. Fallback para eventos previos.
    titulo: props.nombre_tarea || ev.summary,
    estado,
    asignadoA: props.asignado_a || null,
    // Urgencia fija: 'ALTA' (🔴) | 'NORMAL' (🟢) | null.
    prioridad: props.prioridad || null,
    realizadaPor: props.realizada_por || null,
    realizadaEn: props.realizada_en || null,
    noAplicaMotivo: props.no_aplica_motivo || null,
    noAplicaPor: props.no_aplica_por || null,
    // El departamento del evento, para poder marcar desde una vista que no
    // sea la del departamento propio.
    idDepartamento: props.id_departamento || null,
    // La asignacion (tarea x local) de la que sale esta instancia: la usa el
    // panel Editar del detalle.
    idAsignacion: props.id_asignacion || null,
    diasVencida: estado === 'vencida' ? diasVencida(ev, { hoyISO }) : 0,
    // Dependencias, resueltas en el backend: evaluarlas acá exigiría leer
    // calendarios de otros departamentos (ver backend lib/dependencias.js).
    // esperaA: lo que falta. listaPor: ya no falta nada. laEspera: lo que frena.
    esperaA: ev.espera_a || null,
    listaPor: ev.lista_por || null,
    laEspera: ev.la_espera || null,
    // Historial append-only del evento (marcas, notas, reasignaciones).
    historial: String(ev.description || '').split('\n').map((l) => l.trim()).filter(Boolean)
  }
}

// ── Agrupado por grupo de locales (pedido del usuario, 2026-09-30) ──────────
// La misma tarea el mismo dia en varios locales del mismo grupo se muestra
// UNA vez: "P&L › GRUPO TITA ×3", sin importar el responsable. Un local solo
// de su grupo, o sin grupo, queda como estaba. Igual que el resumen semanal de
// Chat (backend lib/resumen-semanal.js) y la TV.

// Del peor al mejor: el grupo toma el estado del primero que tenga.
const PRIORIDAD = ['vencida', 'pendiente', 'realizada', 'no_aplica']

function nombreCorto(email) {
  return String(email || '').split('@')[0]
}

// Las dependencias de todas las del grupo, sin repetir y sin el local (cada
// local espera a SU Auditar: en la linea del grupo alcanza con "Auditar").
function unirNodos(listas) {
  const vistos = new Map()
  for (const nodo of listas.flat()) {
    const clave = `${nodo.nombre_tarea}|${nodo.departamento || ''}`
    if (!vistos.has(clave)) vistos.set(clave, { ...nodo, local: null })
  }
  return vistos.size ? [...vistos.values()] : null
}

// `tareas`: salidas de aTarea (con lo que cada vista les agregue).
// `grupoDeLocal`: Map id_local_ext -> grupo. Devuelve la misma lista con las
// tareas de un mismo (tarea, dia, grupo) reemplazadas por un grupo, en el
// lugar de la primera.
export function agruparPorGrupo(tareas, grupoDeLocal) {
  if (!grupoDeLocal?.size) return tareas
  const porClave = new Map()
  for (const t of tareas) {
    const grupo = t.idLocal ? grupoDeLocal.get(t.idLocal) : null
    if (!grupo) continue
    const clave = `${t.titulo}|${t.fechaISO}|${grupo}`
    if (!porClave.has(clave)) porClave.set(clave, [])
    porClave.get(clave).push(t)
  }
  const grupos = new Map()
  for (const [clave, lista] of porClave) {
    if (new Set(lista.map((t) => t.idLocal)).size < 2) continue
    grupos.set(clave, crearGrupo(clave, grupoDeLocal.get(lista[0].idLocal), lista))
  }
  if (!grupos.size) return tareas
  const salida = []
  const puestos = new Set()
  for (const t of tareas) {
    const clave = t.idLocal && grupoDeLocal.get(t.idLocal) ? `${t.titulo}|${t.fechaISO}|${grupoDeLocal.get(t.idLocal)}` : null
    const grupo = clave && grupos.get(clave)
    if (!grupo) salida.push(t)
    else if (!puestos.has(clave)) { puestos.add(clave); salida.push(grupo) }
  }
  return salida
}

function crearGrupo(clave, grupo, lista) {
  const tareas = [...lista].sort((a, b) => a.local.localeCompare(b.local))
  const abiertas = tareas.filter((t) => t.estado === 'pendiente' || t.estado === 'vencida')
  const noEsperan = tareas.every((t) => !t.esperaA?.length)
  return {
    esGrupo: true,
    clave: `grupo::${clave}`,
    titulo: tareas[0].titulo,
    fechaISO: tareas[0].fechaISO,
    grupo,
    local: grupo,
    tareas,
    estado: PRIORIDAD.find((p) => tareas.some((t) => t.estado === p)) || tareas[0].estado,
    diasVencida: Math.max(0, ...tareas.map((t) => t.diasVencida || 0)),
    hechas: tareas.filter((t) => t.estado === 'realizada').length,
    abiertas,
    idDepartamento: tareas[0].idDepartamento,
    departamento: tareas[0].departamento,
    prioridad: tareas.some((t) => t.prioridad === 'ALTA') ? 'ALTA' : tareas.find((t) => t.prioridad)?.prioridad || null,
    personas: [...new Set(tareas.map((t) => t.asignadoA).filter(Boolean).map(nombreCorto))].sort(),
    esperaA: unirNodos(tareas.map((t) => t.esperaA || [])),
    // "Lista" solo si ninguna espera y todas las abiertas estan listas.
    listaPor: noEsperan && abiertas.length && abiertas.every((t) => t.listaPor?.length) ? unirNodos(abiertas.map((t) => t.listaPor)) : null,
    laEspera: unirNodos(tareas.map((t) => t.laEspera || [])),
    movible: tareas.some((t) => t.movible)
  }
}

// Segunda linea de un grupo: responsables y cuantas van hechas.
export function pieDeGrupo(g) {
  const partes = []
  if (g.hechas) partes.push(`${g.hechas} de ${g.tareas.length} hechas`)
  partes.push(`→ ${g.personas.length ? g.personas.join(', ') : 'equipo'}`)
  return partes.join(' · ')
}

export function agruparPorDiaYLocal(eventos, mapaLocales) {
  const hoyISO = hoyEnArgentina()
  const dias = new Map() // fechaISO -> { fecha: Date, grupos: Map(local -> tareas[]) }

  for (const ev of eventos) {
    const tarea = aTarea(ev, mapaLocales, hoyISO)
    if (!tarea.fechaISO) continue

    if (!dias.has(tarea.fechaISO)) dias.set(tarea.fechaISO, { fecha: new Date(`${tarea.fechaISO}T00:00:00`), grupos: new Map() })
    const dia = dias.get(tarea.fechaISO)
    if (!dia.grupos.has(tarea.local)) dia.grupos.set(tarea.local, [])
    dia.grupos.get(tarea.local).push(tarea)
  }
  // Dentro de un local, las urgentes (🔴) primero (el orden es estable).
  for (const dia of dias.values()) for (const lista of dia.grupos.values()) lista.sort((a, b) => (a.prioridad === 'ALTA' ? 0 : 1) - (b.prioridad === 'ALTA' ? 0 : 1))

  return [...dias.values()].sort((a, b) => a.fecha - b.fecha)
}
