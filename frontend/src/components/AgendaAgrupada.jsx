import { agruparPorLocal } from '../lib/agrupar.js'

function estadoBadge(estado) {
  if (estado === 'REALIZADA' || estado === 'APROBADA') return <span className="badge badge-verde">Realizada</span>
  return <span className="badge badge-amarillo">Pendiente</span>
}

// Vista "Agenda": agrupa las tareas del rango visible por nombre de local,
// cada tarea como un bullet -- pensado para escanear rapido que falta por
// local, no para navegar dia por dia como un calendario en grilla.
export default function AgendaAgrupada({ eventos, mapaLocales, onMarcar, marcando }) {
  const grupos = agruparPorLocal(eventos, mapaLocales)

  if (grupos.size === 0) {
    return <p style={{ color: 'var(--texto-tenue)' }}>No hay tareas en este rango.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {[...grupos.entries()].map(([local, tareas]) => (
        <div key={local} className="card">
          <h3 style={{ margin: '0 0 0.75rem', color: 'var(--gold)' }}>{local}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {tareas.map((t) => {
              const hecha = t.estado === 'REALIZADA' || t.estado === 'APROBADA'
              return (
                <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <span>
                    {t.titulo} <span style={{ color: 'var(--texto-tenue)', fontSize: '0.8rem' }}>{t.inicio?.slice(0, 10)}</span>{' '}
                    {estadoBadge(t.estado)}
                  </span>
                  {!hecha && onMarcar && (
                    <button className="btn btn-secondary" disabled={marcando === t.id} onClick={() => onMarcar(t.id)}>
                      {marcando === t.id ? '...' : 'Marcar realizada'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
