import { iconoUrgencia, etiquetaUrgencia } from '../lib/urgencia.js'

// El circulo de color delante del titulo de una tarea.
export default function Urgencia({ prioridad }) {
  const icono = iconoUrgencia(prioridad)
  if (!icono) return null
  return <span className="urgencia" role="img" aria-label={etiquetaUrgencia(prioridad)} title={etiquetaUrgencia(prioridad)}>{icono} </span>
}
