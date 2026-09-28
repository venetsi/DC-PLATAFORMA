import { resumenDeNodos, todasLasEtiquetas, textoLista } from '../lib/dependencias.js'

// Las etiquetas de una tarea que depende de otra (o que otra espera), iguales
// en todas las vistas:
//   ⏳ Espera a Cierre de caja — Tesorería   (le falta un prerrequisito)
//   ✅ Lista: ya se hizo Cierre de caja       (ya no le falta nada)
//   🔗 La espera Reporte de ventas — Auditoría (esta tarea frena a otra)
// Avisan, no bloquean: por eso no cambian el color de la tarea.
// `compacta`: una línea chica debajo del nombre, para las listas (Agenda, Semana).
export default function EtiquetasDependencia({ tarea, compacta = false }) {
  const { esperaA, listaPor, laEspera, local } = tarea
  const espera = esperaA?.length > 0
  const lista = !espera && listaPor?.length > 0
  const frena = laEspera?.length > 0
  if (!espera && !lista && !frena) return null
  return (
    <span className={`dep-etiquetas${compacta ? ' compacta' : ''}`}>
      {espera && (
        <span className="dep-chip espera" title={`Espera a: ${todasLasEtiquetas(esperaA, local)}`}>
          ⏳ Espera a {resumenDeNodos(esperaA, local)}
        </span>
      )}
      {lista && <span className="dep-chip lista" title={textoLista(listaPor)}>✅ {textoLista(listaPor)}</span>}
      {frena && (
        <span className="dep-chip frena" title={`La esperan: ${todasLasEtiquetas(laEspera, local)}`}>
          🔗 La espera {resumenDeNodos(laEspera, local)}
        </span>
      )}
    </span>
  )
}
