import { aTarea } from '../lib/agrupar.js'
import { clasificarInstancia } from '../lib/vencimiento.js'
import EtiquetasDependencia from './EtiquetasDependencia.jsx'

// Vista "Tablero" de Mi agenda, al estilo Trello: una lista por departamento y
// una tarjeta por tarea abierta (atrasadas + pendientes de los proximos 30
// dias), ordenadas por vencimiento. Decision del usuario: tocar la tarjeta
// abre el detalle, la casilla la marca hecha (quien puede marcar), y NO se
// arrastra entre listas -- moverla de lista seria cambiarle el departamento.

function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

function nombreCorto(email) {
  return String(email || '').split('@')[0]
}

// Etiqueta de vencimiento, como la fecha de una tarjeta de Trello.
function vencimiento(t, hoyISO) {
  if (t.estado === 'vencida') return { clase: 'vencida', texto: `${fechaCorta(t.fechaISO)} · hace ${t.diasVencida} d` }
  if (t.fechaISO === hoyISO) return { clase: 'hoy', texto: 'Hoy' }
  return { clase: 'futura', texto: fechaCorta(t.fechaISO) }
}

export default function TableroKanban({ eventos, idsVisibles, deptos, mapaLocales, hoyISO, puedeMarcar, onAbrir, onMarcar, marcando }) {
  const porDepto = new Map(idsVisibles.map((id) => [id, []]))
  for (const ev of eventos) {
    const { estado } = clasificarInstancia(ev)
    if (estado !== 'pendiente' && estado !== 'vencida') continue
    const lista = porDepto.get(ev.__depto)
    if (!lista) continue
    const t = aTarea(ev, mapaLocales, hoyISO)
    lista.push({ ...t, clave: `${ev.__depto}::${ev.id}`, idDepartamento: ev.__depto, departamento: deptos.get(ev.__depto)?.nombre })
  }
  const listas = [...porDepto.entries()]
    .map(([id, tareas]) => ({
      id,
      info: deptos.get(id) || { nombre: '…', color: '#8fb3bd', abreviatura: '' },
      tareas: tareas.sort((a, b) => a.fechaISO.localeCompare(b.fechaISO) || a.titulo.localeCompare(b.titulo) || a.local.localeCompare(b.local))
    }))
    // Las colapsadas (sin tareas abiertas) van al final; dentro de cada grupo, por nombre.
    .sort((a, b) => (!a.tareas.length - !b.tareas.length) || a.info.nombre.localeCompare(b.info.nombre))

  return (
    <div className="kanban" role="list" aria-label="Tablero por departamento">
      {listas.map((l) => !l.tareas.length ? (
        // Sin tareas abiertas: colapsada, como una lista plegada de Trello
        // (una franja angosta con el nombre), para que no ocupe una columna entera.
        <section key={l.id} className="kanban-lista colapsada" role="listitem" aria-label={`${l.info.nombre}: sin tareas abiertas`} title={`${l.info.nombre}: sin tareas abiertas`}>
          <span className="kanban-color" style={{ background: l.info.color }} aria-hidden="true" />
          <span className="kanban-vertical">{l.info.nombre}</span>
          <span className="kanban-cuenta">0</span>
        </section>
      ) : (
        <section key={l.id} className="kanban-lista" role="listitem" aria-label={l.info.nombre}>
          <header className="kanban-cab">
            <span className="kanban-color" style={{ background: l.info.color }} aria-hidden="true" />
            <strong>{l.info.nombre}</strong>
            <span className="kanban-cuenta">{l.tareas.length}</span>
          </header>
          <ul className="kanban-tarjetas">
            {l.tareas.map((t) => {
              const v = vencimiento(t, hoyISO)
              const puede = puedeMarcar(t.idDepartamento)
              const persona = t.asignadoA ? nombreCorto(t.asignadoA) : 'equipo'
              return (
                <li
                  key={t.clave}
                  className="kanban-tarjeta"
                  role="button"
                  tabIndex={0}
                  onClick={() => onAbrir(t)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAbrir(t))}
                  title="Ver el detalle"
                >
                  <div className="kanban-titulo">{t.titulo}</div>
                  <div className="kanban-meta">{t.local} · {persona}</div>
                  <EtiquetasDependencia tarea={t} />
                  <div className="kanban-pie">
                    {puede && (
                      <button
                        type="button"
                        className="kanban-check"
                        disabled={marcando === t.id}
                        aria-label={`Marcar hecha: ${t.titulo} — ${t.local}`}
                        title="Marcar hecha"
                        onClick={(e) => { e.stopPropagation(); onMarcar(t) }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className={`kanban-vence ${v.clase}`}>{v.texto}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
