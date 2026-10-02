// Urgencia fija de una tarea: 🔴 urgente, 🟢 normal, nada si no esta marcada.
export const URGENCIAS = [
  { valor: 'ALTA', icono: '🔴', etiqueta: 'Urgente' },
  { valor: 'NORMAL', icono: '🟢', etiqueta: 'Normal' }
]

export function iconoUrgencia(prioridad) {
  return URGENCIAS.find((u) => u.valor === prioridad)?.icono || ''
}

export function etiquetaUrgencia(prioridad) {
  return URGENCIAS.find((u) => u.valor === prioridad)?.etiqueta || 'Sin marcar'
}
