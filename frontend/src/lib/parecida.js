// "CMV PIPISTRELLO" cuando ya existe "CMV": casi seguro es la misma tarea en
// otro local. En noviembre de 2026 habia varias asi ("CMV ALDO", "PDP Perros")
// que quedaban fuera del circuito; el formulario de Nueva tarea ofrece sumarle
// el local a la que ya existe.

export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&/]+/g, ' ')
    .trim()
}

// La tarea activa del departamento cuyo nombre es el comienzo de lo que se
// escribio (palabra completa), o igual. Si hay varias, la de nombre mas largo.
export function tareaParecida(nombre, tareas, idDepartamento) {
  const q = normalizar(nombre)
  if (!q) return null
  let mejor = null
  for (const t of tareas || []) {
    if (!t.activa || t.id_departamento !== idDepartamento) continue
    const n = normalizar(t.nombre)
    if (n.length < 2) continue
    const coincide = q === n || q.startsWith(`${n} `)
    if (coincide && (!mejor || n.length > normalizar(mejor.nombre).length)) mejor = t
  }
  return mejor
}
