import { useEffect, useMemo, useState } from 'react'
import { tareasApi, localesApi, asignacionesApi } from '../../api/recursos.js'
import AgendaForm from './AgendaForm.jsx'

// Vista de administracion de agenda por tarea. Con locales reales (una vez
// sincronizados desde dcsmart en Fase 7-8) esto se ve como la matriz
// local x tarea del ejemplo original; en dev, sin locales sembrados, alcanza
// para asignaciones de alcance EMPRESA (sin local especifico).
export default function AdminAgenda() {
  const [tareas, setTareas] = useState([])
  const [locales, setLocales] = useState([])
  const [idTarea, setIdTarea] = useState('')
  const [alcance, setAlcance] = useState('empresa') // empresa | grupo | local
  const [idLocal, setIdLocal] = useState('')
  const [idGrupo, setIdGrupo] = useState('')
  const [asignaciones, setAsignaciones] = useState([])
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    tareasApi.listar().then(setTareas)
    localesApi.listar().then(setLocales)
  }, [])

  // Grupos reales (ExtLocal.grupo, cacheado de dcsmart) -- no hay tabla de
  // grupos propia, se derivan de los locales que ya llegaron.
  const grupos = useMemo(
    () => [...new Set(locales.map((l) => l.grupo).filter(Boolean))].sort(),
    [locales]
  )

  async function cargarAsignaciones() {
    if (!idTarea) return setAsignaciones([])
    setAsignaciones(await asignacionesApi.listar({ id_tarea: idTarea }))
  }

  useEffect(() => { cargarAsignaciones() }, [idTarea])

  async function agregarAsignacion(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    try {
      if (alcance === 'grupo') {
        const { creadas, ya_existian } = await asignacionesApi.crear({ id_tarea: idTarea, id_grupo: idGrupo })
        setMensaje(
          `Creadas ${creadas.length} asignaciones nuevas para el grupo "${idGrupo}"` +
          (ya_existian.length ? ` (ya existían para: ${ya_existian.join(', ')})` : '')
        )
      } else {
        await asignacionesApi.crear({ id_tarea: idTarea, id_local_ext: alcance === 'local' ? idLocal : undefined })
      }
      setIdLocal('')
      setIdGrupo('')
      await cargarAsignaciones()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la asignación')
    }
  }

  const nombreLocal = (id) => locales.find((l) => l.id === id)?.nombre

  return (
    <div>
      <h2>Agenda por tarea</h2>
      <select value={idTarea} onChange={(e) => setIdTarea(e.target.value)} style={{ padding: '0.4rem', marginBottom: '1rem' }}>
        <option value="">Elegir tarea...</option>
        {tareas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select>

      {idTarea && (
        <>
          <form onSubmit={agregarAsignacion} className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', maxWidth: 520, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <select value={alcance} onChange={(e) => setAlcance(e.target.value)}>
              <option value="empresa">Toda la empresa</option>
              <option value="grupo">Por grupo</option>
              <option value="local">Local específico</option>
            </select>

            {alcance === 'grupo' && (
              <select value={idGrupo} onChange={(e) => setIdGrupo(e.target.value)} required style={{ flex: 1 }}>
                <option value="">Elegir grupo...</option>
                {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {alcance === 'local' && (
              <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)} required style={{ flex: 1 }}>
                <option value="">Elegir local...</option>
                {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            )}

            <button className="btn">Agregar</button>
          </form>
          {mensaje && <p style={{ color: 'var(--verde)', fontSize: '0.85rem' }}>{mensaje}</p>}
          {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {asignaciones.map((a) => (
              <div key={a.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong>{a.id_local_ext ? nombreLocal(a.id_local_ext) : 'Toda la empresa'}</strong>
                  <span className={`badge ${a.id_calendar_event ? 'badge-verde' : 'badge-amarillo'}`}>
                    {a.id_calendar_event ? 'Agendada' : 'Sin agenda definida'}
                  </span>
                </div>
                <AgendaForm asignacion={a} onGuardado={cargarAsignaciones} />
              </div>
            ))}
            {asignaciones.length === 0 && <p style={{ color: 'var(--texto-tenue)' }}>Sin asignaciones todavía para esta tarea.</p>}
          </div>
        </>
      )}
    </div>
  )
}
