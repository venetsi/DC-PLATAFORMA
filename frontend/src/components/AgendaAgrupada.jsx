import { useState } from 'react'
import { agruparPorDiaYLocal, agruparPorGrupo, pieDeGrupo } from '../lib/agrupar.js'
import DetalleTarea from './DetalleTarea.jsx'
import EtiquetasDependencia from './EtiquetasDependencia.jsx'
import Urgencia from './Urgencia.jsx'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// Vista "Agenda": un dia por columna (mismo agrupamiento y estilo visual
// que el kiosko -- ver kiosko/index.html:pintarSemana), cada dia agrupado
// por local y sus tareas como bullets. Tocar una tarea abre su detalle; marcar
// hecha se hace desde ahi, con confirmacion (es definitivo).
// `deptos` (Map id -> { nombre, abreviatura, color }) + `mostrarDepto`: cuando la
// vista mezcla varios departamentos, cada tarea lleva su etiqueta de color.
// Con `grupoDeLocal` (Mi agenda), la misma tarea el mismo dia en varios locales
// del mismo grupo va una sola vez, bajo el nombre del grupo ("GRUPO TITA" →
// "P&L ×3"), y tocarla abre el grupo (`onAbrirGrupo`). Sin eso (Mis tareas),
// un local por encabezado, como siempre.
function conGrupos(dias, grupoDeLocal) {
  return dias.map((dia) => {
    const encabezados = new Map()
    for (const item of agruparPorGrupo([...dia.grupos.values()].flat(), grupoDeLocal)) {
      if (!encabezados.has(item.local)) encabezados.set(item.local, [])
      encabezados.get(item.local).push(item)
    }
    return { ...dia, grupos: encabezados }
  })
}

export default function AgendaAgrupada({ eventos, mapaLocales, grupoDeLocal, onAbrirGrupo, onMarcar, onNoAplica, onReprogramar, onEditado, marcando, deptos, mostrarDepto = false }) {
  const [abierta, setAbierta] = useState(null)
  const porLocal = agruparPorDiaYLocal(eventos, mapaLocales)
  const dias = grupoDeLocal?.size ? conGrupos(porLocal, grupoDeLocal) : porLocal

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
                  if (t.esGrupo) {
                    const depto = mostrarDepto ? deptos?.get(t.idDepartamento) : null
                    return (
                      <li
                        key={t.clave}
                        className={t.estado + ' clickable'}
                        onClick={() => onAbrirGrupo(t)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onAbrirGrupo(t)}
                        role="button"
                        tabIndex={0}
                        title={`${t.tareas.map((x) => x.local).join(', ')}. Tocá para ver los locales`}
                      >
                        <span className="tarea-texto">
                          <span>
                            {depto && <span className="chip-depto" style={{ color: depto.color, background: `${depto.color}26` }} title={depto.nombre}>{depto.abreviatura}</span>}
                            <Urgencia prioridad={t.prioridad} />{t.titulo}<span className="grupo-cuenta">×{t.tareas.length}</span>
                            {t.diasVencida > 0 && <span className="tarea-atraso">hace {t.diasVencida} {t.diasVencida === 1 ? 'día' : 'días'}</span>}
                          </span>
                          <span className="tarea-persona">{pieDeGrupo(t)}</span>
                          <EtiquetasDependencia tarea={t} compacta />
                        </span>
                      </li>
                    )
                  }
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
                          <Urgencia prioridad={t.prioridad} />{t.titulo}
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
