import { useState } from 'react'
import { agruparPorDiaYLocal } from '../lib/agrupar.js'
import DetalleTarea from './DetalleTarea.jsx'
import EtiquetasDependencia from './EtiquetasDependencia.jsx'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// Vista "Agenda": un dia por columna (mismo agrupamiento y estilo visual
// que el kiosko -- ver kiosko/index.html:pintarSemana), cada dia agrupado
// por local y sus tareas como bullets. Tocar una tarea abre su detalle; marcar
// hecha se hace desde ahi, con confirmacion (es definitivo).
// `deptos` (Map id -> { nombre, abreviatura, color }) + `mostrarDepto`: cuando la
// vista mezcla varios departamentos, cada tarea lleva su etiqueta de color.
export default function AgendaAgrupada({ eventos, mapaLocales, onMarcar, onNoAplica, onReprogramar, onEditado, marcando, deptos, mostrarDepto = false }) {
  const [abierta, setAbierta] = useState(null)
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
                  // Quien la hizo (o quien la tiene a cargo) es la mitad del
                  // seguimiento entre equipos.
                  const pie = t.estado === 'no_aplica'
                    ? 'no aplica'
                    : t.estado === 'realizada'
                    ? (t.realizadaPor ? `✓ ${t.realizadaPor}` : null)
                    : (t.asignadoA ? `→ ${t.asignadoA}` : null)
                  const depto = mostrarDepto ? deptos?.get(t.idDepartamento) : null
                  return (
                    <li
                      key={`${t.idDepartamento}:${t.id}`}
                      className={t.estado + ' clickable'}
                      onClick={() => setAbierta({ ...t, departamento: deptos?.get(t.idDepartamento)?.nombre })}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAbierta({ ...t, departamento: deptos?.get(t.idDepartamento)?.nombre })}
                      role="button"
                      tabIndex={0}
                      title="Ver detalle"
                    >
                      <span className="tarea-texto">
                        <span>
                          {depto && (
                            <span className="chip-depto" style={{ color: depto.color, background: `${depto.color}26` }} title={depto.nombre}>{depto.abreviatura}</span>
                          )}
                          {t.titulo}
                          {t.diasVencida > 0 && (
                            <span className="tarea-atraso">
                              hace {t.diasVencida} {t.diasVencida === 1 ? 'día' : 'días'}
                            </span>
                          )}
                        </span>
                        {marcando === t.id && ' (marcando…)'}
                        {pie && <span className="tarea-persona">{pie}</span>}
                        <EtiquetasDependencia tarea={t} compacta />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {abierta && (
        <DetalleTarea tarea={abierta} onCerrar={() => setAbierta(null)} onMarcar={onMarcar} onNoAplica={onNoAplica} onReprogramar={onReprogramar} onEditado={onEditado} />
      )}
    </div>
  )
}
