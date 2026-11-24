import { clasificarInstancia, diasHabilesVencida } from './vencimiento.js'

// Pantalla Circuito: el orden real entre sectores (hoy Auditoria VTA/OP ->
// Costos CMV -> Reportes Informe) y en que paso esta cada local esta semana.
//
// El circuito NO se configura aparte: sale de las esperas ya cargadas entre
// asignaciones (TareaAsignacionDependencia). Dos tareas quedan en el mismo
// circuito si alguna asignacion de una espera a alguna de la otra; el orden de
// los pasos es el de las esperas. Asi no hay dos lugares donde definir lo mismo.

// aristas: [{ previa: {id, nombre, ...}, espera: {id, nombre, ...} }] (tarea -> tarea)
// Devuelve [{ pasos: [tarea, ...] }], cada circuito con sus tareas en orden.
export function armarCircuitos(aristas) {
  const tareas = new Map()
  const siguientes = new Map()
  const vecinos = new Map()
  const unir = (a, b) => {
    if (!vecinos.has(a)) vecinos.set(a, new Set())
    vecinos.get(a).add(b)
  }
  for (const { previa, espera } of aristas) {
    if (!previa || !espera || previa.id === espera.id) continue
    tareas.set(previa.id, previa)
    tareas.set(espera.id, espera)
    if (!siguientes.has(previa.id)) siguientes.set(previa.id, new Set())
    siguientes.get(previa.id).add(espera.id)
    unir(previa.id, espera.id)
    unir(espera.id, previa.id)
  }

  // Componentes conexas (sin importar el sentido de la espera).
  const vistos = new Set()
  const componentes = []
  for (const id of [...tareas.keys()].sort((a, b) => tareas.get(a).nombre.localeCompare(tareas.get(b).nombre))) {
    if (vistos.has(id)) continue
    const comp = []
    const pila = [id]
    while (pila.length) {
      const x = pila.pop()
      if (vistos.has(x)) continue
      vistos.add(x)
      comp.push(x)
      pila.push(...(vecinos.get(x) || []))
    }
    componentes.push(comp)
  }

  // Orden topologico dentro de cada una; si hubiera esperas cruzadas entre
  // tareas (un local A->B y otro B->A), lo que queda va al final por nombre.
  return componentes.map((comp) => {
    const enComp = new Set(comp)
    const entrantes = new Map(comp.map((id) => [id, 0]))
    for (const id of comp) for (const s of siguientes.get(id) || []) if (enComp.has(s)) entrantes.set(s, entrantes.get(s) + 1)
    const porNombre = (a, b) => tareas.get(a).nombre.localeCompare(tareas.get(b).nombre)
    const listos = comp.filter((id) => entrantes.get(id) === 0).sort(porNombre)
    const orden = []
    while (listos.length) {
      const id = listos.shift()
      orden.push(id)
      for (const s of siguientes.get(id) || []) {
        if (!enComp.has(s)) continue
        entrantes.set(s, entrantes.get(s) - 1)
        if (entrantes.get(s) === 0) { listos.push(s); listos.sort(porNombre) }
      }
    }
    const resto = comp.filter((id) => !orden.includes(id)).sort(porNombre)
    return { pasos: [...orden, ...resto].map((id) => tareas.get(id)) }
  }).sort((a, b) => b.pasos.length - a.pasos.length || a.pasos[0].nombre.localeCompare(b.pasos[0].nombre))
}

// Estado de un paso (una asignacion) en la semana, a partir de sus instancias
// de Calendar de las ultimas semanas hasta el viernes:
//   atrasada  -> la mas vieja sin hacer de antes de hoy (con dias habiles)
//   hoy       -> le toca hoy y no esta hecha
//   pendiente -> le toca mas adelante en la semana
//   hecha     -> todas las de la semana cerradas (no aplica cuenta como cerrada)
//   no_aplica -> todas las de la semana marcadas "no aplica"
//   sin_fecha -> no le toca esta semana
export function estadoDelPaso(instancias, { lunes, viernes, hoyISO }) {
  const clasificadas = instancias
    .map((ev) => ({ ev, c: clasificarInstancia(ev) }))
    .filter((x) => x.c.fechaISO && x.c.fechaISO <= viernes)
    .sort((a, b) => a.c.fechaISO.localeCompare(b.c.fechaISO))

  const atrasada = clasificadas.find((x) => x.c.estado === 'vencida')
  if (atrasada) return { estado: 'atrasada', fecha: atrasada.c.fechaISO, dias: diasHabilesVencida(atrasada.ev, { hoyISO }) }

  const semana = clasificadas.filter((x) => x.c.fechaISO >= lunes)
  if (!semana.length) return { estado: 'sin_fecha' }
  const abierta = semana.find((x) => x.c.estado === 'pendiente')
  if (abierta) return { estado: abierta.c.fechaISO === hoyISO ? 'hoy' : 'pendiente', fecha: abierta.c.fechaISO }
  if (semana.every((x) => x.c.estado === 'no_aplica')) return { estado: 'no_aplica', fecha: semana.at(-1).c.fechaISO }
  const ultima = [...semana].reverse().find((x) => x.c.estado === 'realizada')
  return { estado: 'hecha', fecha: ultima.c.fechaISO }
}

const ABIERTOS = new Set(['atrasada', 'hoy', 'pendiente'])

// Completa una fila (un local): marca "espera" en los pasos abiertos que tienen
// un paso anterior todavia abierto, y dice cual lo frena (el primero abierto).
// `pasos`: [estado | null] en el orden del circuito (null = el local no tiene ese paso).
export function completarFila(pasos) {
  let frena = null
  const conEspera = pasos.map((p, i) => {
    if (!p || !ABIERTOS.has(p.estado)) return p
    if (frena === null) {
      frena = i
      return p
    }
    return { ...p, espera: true }
  })
  return { pasos: conEspera, frena }
}

// Lo mas trabado primero: atrasados (mas dias arriba), despues lo de hoy, lo
// pendiente, y al final lo cerrado.
export function ordenDeFila(fila) {
  const p = fila.frena === null ? null : fila.pasos[fila.frena]
  if (!p) return [4, 0]
  if (p.estado === 'atrasada') return [0, -(p.dias || 0)]
  if (p.estado === 'hoy') return [1, 0]
  return [2, p.fecha ? Number(p.fecha.replaceAll('-', '')) : 0]
}

export function compararFilas(a, b) {
  const [x1, x2] = ordenDeFila(a)
  const [y1, y2] = ordenDeFila(b)
  return x1 - y1 || x2 - y2 || String(a.local).localeCompare(String(b.local))
}
