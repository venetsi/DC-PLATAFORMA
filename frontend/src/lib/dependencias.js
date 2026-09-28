// Textos de las dependencias entre tareas (backend lib/dependencias.js). Un
// "nodo" es { nombre_tarea, departamento, local, fecha, estado, responsable,
// hecha_por, hecha_en }.

function nombreCorto(email) {
  return email ? String(email).split('@')[0] : ''
}

function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

// "Cierre de caja — Tesorería", más el local si no es el de la tarea que se mira.
export function etiquetaDeNodo(nodo, localPropio) {
  let texto = nodo.departamento ? `${nodo.nombre_tarea} — ${nodo.departamento}` : nodo.nombre_tarea
  if (nodo.local && localPropio && nodo.local !== localPropio) texto += ` · ${nodo.local}`
  return texto
}

// La primera y "y N más": en una tarjeta no entran todas.
export function resumenDeNodos(nodos, localPropio) {
  const primero = etiquetaDeNodo(nodos[0], localPropio)
  return nodos.length > 1 ? `${primero} y ${nodos.length - 1} más` : primero
}

export function todasLasEtiquetas(nodos, localPropio) {
  return nodos.map((n) => etiquetaDeNodo(n, localPropio)).join('; ')
}

// Cuándo se hizo: la hora si fue hoy, la fecha si no.
function cuandoSeHizo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoy = new Date()
  const mismoDia = d.toDateString() === hoy.toDateString()
  return mismoDia
    ? ` a las ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    : ` el ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`
}

// "Lista: ya se hizo Cierre de caja a las 11:42"
export function textoLista(listas) {
  if (listas.length === 1) {
    const n = listas[0]
    return n.estado === 'no_aplica'
      ? `Lista: ${n.nombre_tarea} no aplicaba`
      : `Lista: ya se hizo ${n.nombre_tarea}${cuandoSeHizo(n.hecha_en)}`
  }
  return `Lista: ya se hicieron ${listas.map((n) => n.nombre_tarea).join(' y ')}`
}

// La segunda línea de un paso de la cadena del detalle.
export function detalleDeNodo(nodo, hoyISO) {
  const quien = nodo.responsable ? ` · ${nombreCorto(nodo.responsable)}` : ''
  if (nodo.estado === 'realizada') {
    return `Hecha${cuandoSeHizo(nodo.hecha_en)}${nodo.hecha_por ? ` por ${nombreCorto(nodo.hecha_por)}` : ''}`
  }
  if (nodo.estado === 'no_aplica') return `No aplicaba${nodo.hecha_por ? ` (${nombreCorto(nodo.hecha_por)})` : ''}`
  if (nodo.estado === 'vencida') return `Atrasada desde el ${fechaCorta(nodo.fecha)}${quien}`
  if (nodo.fecha === hoyISO) return `Pendiente, vence hoy${quien}`
  return `Pendiente, vence el ${fechaCorta(nodo.fecha)}${quien}`
}

// Para la confirmación de marcar: qué falta todavía.
export function avisoAntesDeMarcar(tarea) {
  if (!tarea?.esperaA?.length) return ''
  const n = tarea.esperaA.length
  return `Ojo: todavía ${n === 1 ? 'falta' : 'faltan'} ${todasLasEtiquetas(tarea.esperaA, tarea.local)}. Se puede marcar igual.`
}
