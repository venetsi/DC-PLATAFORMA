// Color y abreviatura por departamento, para distinguirlos cuando una vista
// mezcla varios (Mi agenda con "Todos", Mis tareas de quien esta en varios
// grupos). El color sale del orden alfabetico de TODOS los departamentos
// activos, asi cada uno tiene el mismo color en todas las vistas y para todos.
const PALETA = ['#3fb6bd', '#c9b086', '#9d8df1', '#e0789b', '#5fa8e8', '#7cc47f', '#f0a45d', '#8fb3bd', '#d4a5e8', '#e88f7a']

export function abreviar(nombre) {
  const limpio = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return limpio.length <= 4 ? limpio : limpio.slice(0, 3)
}

// Map id -> { nombre, abreviatura, color }
export function infoDepartamentos(departamentos) {
  const orden = [...departamentos].sort((a, b) => a.nombre.localeCompare(b.nombre))
  return new Map(orden.map((d, i) => [d.id, { nombre: d.nombre, abreviatura: abreviar(d.nombre), color: PALETA[i % PALETA.length] }]))
}
