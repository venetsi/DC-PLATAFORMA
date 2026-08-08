import { useEffect, useState } from 'react'
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
  const [idLocal, setIdLocal] = useState('')
  const [asignaciones, setAsignaciones] = useState([])

  useEffect(() => {
    tareasApi.listar().then(setTareas)
    localesApi.listar().then(setLocales)
  }, [])

  async function cargarAsignaciones() {
    if (!idTarea) return setAsignaciones([])
    setAsignaciones(await asignacionesApi.listar({ id_tarea: idTarea }))
  }

  useEffect(() => { cargarAsignaciones() }, [idTarea])

  async function agregarAsignacion(e) {
    e.preventDefault()
    await asignacionesApi.crear({ id_tarea: idTarea, id_local_ext: idLocal || undefined })
    setIdLocal('')
    await cargarAsignaciones()
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
          <form onSubmit={agregarAsignacion} className="card" style={{ display: 'flex', gap: '0.5rem', maxWidth: 420, marginBottom: '1.5rem' }}>
            <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)} style={{ flex: 1 }}>
              <option value="">Sin local (alcance empresa)</option>
              {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
            <button className="btn">Agregar</button>
          </form>

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
