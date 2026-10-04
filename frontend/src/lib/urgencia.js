// Urgencia fija de una tarea: 🔴 urgente, 🟢 normal, nada si no esta marcada.
export const URGENCIAS = [
  { valor: 'ALTA', icono: '🔴', etiqueta: 'Urgente' },
  { valor: 'NORMAL', icono: '🟢', etiqueta: 'Normal' }
]

// Para ordenar: las urgentes (🔴) antes que el resto.
export const pesoUrgencia = (prioridad) => (prioridad === 'ALTA' ? 0 : 1)

export function iconoUrgencia(prioridad) {
  return URGENCIAS.find((u) => u.valor === prioridad)?.icono || ''
}

export function etiquetaUrgencia(prioridad) {
  return URGENCIAS.find((u) => u.valor === prioridad)?.etiqueta || 'Sin marcar'
}
