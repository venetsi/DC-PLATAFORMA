import { agruparPorDiaYLocal } from '../lib/agrupar.js'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// Vista "Agenda": un dia por columna (mismo agrupamiento y estilo visual
// que el kiosko -- ver kiosko/index.html:pintarSemana), cada dia agrupado
// por local y sus tareas como bullets. A diferencia del kiosko (solo
// lectura), el bullet es clickeable para marcar realizada.
export default function AgendaAgrupada({ eventos, mapaLocales, onMarcar, marcando }) {
  const dias = agruparPorDiaYLocal(eventos, mapaLocales)

  if (dias.length === 0) {
    return <p style={{ color: 'var(--texto-tenue)' }}>No hay tareas en este rango.</p>
  }

  const hoyStr = new Date().toDateString()

  return (
    <div className="agenda-dias">
      {dias.map((dia) => (
        <div key={dia.fecha.toISOString()} className={'card dia-col' + (dia.fecha.toDateString() === hoyStr ? ' hoy' : '')}>
          <div className="dia-nombre">{DIAS[dia.fecha.getDay()]}</div>
          <div className="dia-fecha">{dia.fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
          {[...dia.grupos.entries()].map(([local, tareas]) => (
            <div key={local} className="local-grupo">
              <div className="local-nombre">{local}</div>
              <ul className="tarea-bullets">
                {tareas.map((t) => {
                  const accionable = t.estado !== 'realizada' && !!onMarcar
                  // Quien la hizo (o quien la tiene a cargo) es la mitad del
                  // seguimiento entre equipos -- el dato ya viajaba en el
                  // evento pero no se mostraba en ningun lado.
                  const pie = t.estado === 'realizada'
                    ? (t.realizadaPor ? `✓ ${t.realizadaPor}` : null)
                    : (t.asignadoA ? `→ ${t.asignadoA}` : null)
                  return (
                    <li
                      key={t.id}
                      className={t.estado + (accionable ? ' clickable' : '')}
                      // Se pasa el departamento del evento (no el del store):
                      // desde "Mis tareas" puede no ser el mismo.
                      onClick={accionable ? () => onMarcar(t.id, t.idDepartamento) : undefined}
                      title={accionable ? 'Marcar realizada' : undefined}
                    >
                      <span className="tarea-texto">
                        <span>
                          {t.titulo}
                          {t.diasVencida > 0 && (
                            <span className="tarea-atraso">
                              hace {t.diasVencida} {t.diasVencida === 1 ? 'día' : 'días'}
                            </span>
                          )}
                        </span>
                        {marcando === t.id && ' (marcando…)'}
                        {pie && <span className="tarea-persona">{pie}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
