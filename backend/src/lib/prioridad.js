// Urgencia fija de una asignacion (definida por grupo, editable desde Agendas).
// Viaja en extendedProperties.private.prioridad de cada evento para que Mi
// agenda, la TV y el Chat la lean sin consultar la base.
export const ICONO_PRIORIDAD = { ALTA: '🔴', NORMAL: '🟢' }

export function iconoDe(props) {
  return ICONO_PRIORIDAD[props?.prioridad] || ''
}

// Prefijo para una linea de texto: '🔴 ' o '' (nunca deja un espacio suelto).
export function prefijoDe(props) {
  const icono = iconoDe(props)
  return icono ? `${icono} ` : ''
}

// Orden: urgentes primero, despues el resto (estable).
export function pesoDe(props) {
  return props?.prioridad === 'ALTA' ? 0 : 1
}
