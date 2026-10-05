// Reportes -> "Por responsable y departamento". El backend manda una fila por
// (responsable, departamento, tarea) con sus conteos; aca se arman los dos
// ordenes sin otra consulta:
//   - 'responsable': persona -> departamento -> tareas
//   - 'departamento': departamento -> persona -> tareas
// Cumplimiento = hechas / (hechas + atrasadas sin hacer); "no aplica" no suma
// ni resta (igual que el resto del tablero).

export const SIN_RESPONSABLE = 'Equipo (sin responsable fijo)'

const CERO = () => ({ total: 0, hechas: 0, a_tiempo: 0, tarde: 0, vencidas: 0, no_aplica: 0 })

function sumar(acc, fila) {
  for (const k of ['total', 'hechas', 'a_tiempo', 'tarde', 'vencidas', 'no_aplica']) acc[k] += fila[k] || 0
  return acc
}

function conCumplimiento(c) {
  const base = c.hechas + c.vencidas
  return { ...c, cumplimiento: base ? Math.round((c.hechas / base) * 100) : null }
}

// Peor cumplimiento primero (lo que hay que mirar); sin datos al final; el
// "equipo" siempre al final de su nivel.
function ordenar(a, b) {
  if (a.sinResponsable !== b.sinResponsable) return a.sinResponsable ? 1 : -1
  return (b.vencidas - a.vencidas) || ((a.cumplimiento ?? 101) - (b.cumplimiento ?? 101)) || a.nombre.localeCompare(b.nombre)
}

export function armarPorResponsable(filas, modo) {
  const nivel1 = new Map()
  for (const f of filas || []) {
    const persona = { clave: f.responsable || '', nombre: f.nombre || SIN_RESPONSABLE, sinResponsable: !f.responsable }
    const depto = { clave: f.id_departamento, nombre: f.departamento, sinResponsable: false }
    const [a, b] = modo === 'departamento' ? [depto, persona] : [persona, depto]
    if (!nivel1.has(a.clave)) nivel1.set(a.clave, { ...a, conteo: CERO(), hijos: new Map() })
    const n1 = nivel1.get(a.clave)
    sumar(n1.conteo, f)
    if (!n1.hijos.has(b.clave)) n1.hijos.set(b.clave, { ...b, conteo: CERO(), tareas: [] })
    const n2 = n1.hijos.get(b.clave)
    sumar(n2.conteo, f)
    n2.tareas.push({ nombre: f.tarea, locales: f.locales, ...conCumplimiento(sumar(CERO(), f)) })
  }
  return [...nivel1.values()]
    .map((n1) => {
      const hijos = [...n1.hijos.values()]
        .map((n2) => ({
          clave: n2.clave,
          nombre: n2.nombre,
          sinResponsable: n2.sinResponsable,
          ...conCumplimiento(n2.conteo),
          tareas: n2.tareas.sort((x, y) => y.vencidas - x.vencidas || x.nombre.localeCompare(y.nombre))
        }))
        .sort(ordenar)
      return { clave: n1.clave, nombre: n1.nombre, sinResponsable: n1.sinResponsable, ...conCumplimiento(n1.conteo), hijos }
    })
    .sort(ordenar)
}
