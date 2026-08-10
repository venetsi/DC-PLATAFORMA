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
                  return (
                    <li
                      key={t.id}
                      className={t.estado + (accionable ? ' clickable' : '')}
                      onClick={accionable ? () => onMarcar(t.id) : undefined}
                      title={accionable ? 'Marcar realizada' : undefined}
                    >
                      {t.titulo}
                      {marcando === t.id && ' (marcando…)'}
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
