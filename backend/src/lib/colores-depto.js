// Color y abreviatura por departamento para la TV cuando muestra varios.
// COPIA de frontend/src/lib/colores-depto.js (misma paleta, mismo orden
// alfabetico de TODOS los departamentos activos): asi cada departamento tiene
// el mismo color en la TV que en Mi agenda. Si se cambia uno, cambiar el otro.
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
