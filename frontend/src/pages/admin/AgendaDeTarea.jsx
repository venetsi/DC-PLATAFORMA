import { useEffect, useState } from 'react'
import { asignacionesApi } from '../../api/recursos.js'
import AgendaForm from './AgendaForm.jsx'

// Panel de agenda de una tarea puntual -- se abre inline en el renglon de
// AdminTareas ("definir la tarea en el mismo renglon donde se crea"), asi
// que a diferencia de la vieja pantalla /admin/agenda no necesita su propio
// picker de tarea: la tarea ya viene fija desde la fila que lo abrio.
export default function AgendaDeTarea({ tarea, locales, grupos, departamentos, onCerrar, onCambio }) {
  const [alcance, setAlcance] = useState('empresa') // empresa | grupo | local
  const [idLocal, setIdLocal] = useState('')
  const [idGrupo, setIdGrupo] = useState('')
  // Compartir la misma asignacion con otros departamentos ademas del dueño
  // de la tarea -- "un solo evento visible para ambos deptos" (ver
  // asignaciones.js). Vale tambien para "por grupo": se aplica a cada local
  // del grupo (N locales x M departamentos compartidos).
  const [deptosCompartidos, setDeptosCompartidos] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  // Vuelve el formulario de "agregar asignacion" a su estado inicial, sin
  // guardar nada -- para cuando el usuario elige mal el alcance/grupo/local
  // y quiere empezar de nuevo en vez de corregir campo por campo.
  function cancelarSeleccion() {
    setAlcance('empresa')
    setIdLocal('')
    setIdGrupo('')
    setDeptosCompartidos([])
    setError('')
  }

  function toggleDeptoCompartido(id) {
    setDeptosCompartidos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function cargarAsignaciones() {
    setAsignaciones(await asignacionesApi.listar({ id_tarea: tarea.id }))
    onCambio?.()
  }

  useEffect(() => { cargarAsignaciones() }, [tarea.id])

  async function agregarAsignacion(e) {
    e.preventDefault()
    setError('')
    setMensaje('')
    try {
      if (alcance === 'grupo') {
        const { creadas, ya_existian } = await asignacionesApi.crear({
          id_tarea: tarea.id,
          id_grupo: idGrupo,
          departamentos_compartidos: deptosCompartidos.length ? deptosCompartidos : undefined
        })
        setMensaje(
          `Creadas ${creadas.length} asignaciones nuevas para el grupo "${idGrupo}"` +
          (ya_existian.length ? ` (ya existían para: ${ya_existian.join(', ')})` : '') +
          (deptosCompartidos.length ? ` -- compartidas con ${deptosCompartidos.length} departamento(s) más` : '')
        )
      } else {
        await asignacionesApi.crear({
          id_tarea: tarea.id,
          id_local_ext: alcance === 'local' ? idLocal : undefined,
          departamentos_compartidos: deptosCompartidos.length ? deptosCompartidos : undefined
        })
      }
      setIdLocal('')
      setIdGrupo('')
      setDeptosCompartidos([])
      await cargarAsignaciones()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la asignación')
    }
  }

  const nombreLocal = (id) => locales.find((l) => l.id === id)?.nombre
  const otrosDepartamentos = (departamentos || []).filter((d) => d.id !== tarea.id_departamento)

  return (
    <div style={{ padding: '0.75rem 0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <strong>Agenda de {tarea.nombre}</strong>
        <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cerrar</button>
      </div>

      <form onSubmit={agregarAsignacion} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={alcance} onChange={(e) => setAlcance(e.target.value)}>
            <option value="empresa">Toda la empresa</option>
            <option value="grupo">Por grupo</option>
            <option value="local">Local específico</option>
          </select>

          {alcance === 'grupo' && (
            <select value={idGrupo} onChange={(e) => setIdGrupo(e.target.value)} required style={{ flex: 1, minWidth: 160 }}>
              <option value="">Elegir grupo...</option>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {alcance === 'local' && (
            <select value={idLocal} onChange={(e) => setIdLocal(e.target.value)} required style={{ flex: 1, minWidth: 160 }}>
              <option value="">Elegir local...</option>
              {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          )}

          <button className="btn">Agregar</button>
          {alcance !== 'empresa' && (
            <button type="button" className="btn btn-secondary" onClick={cancelarSeleccion}>Cancelar</button>
          )}
        </div>

        {otrosDepartamentos.length > 0 && (
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--texto-tenue)', marginBottom: '0.3rem' }}>
              Compartir con otros departamentos (un solo evento, visible para todos los elegidos):
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {otrosDepartamentos.map((d) => (
                <label key={d.id} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.82rem' }}>
                  <input
                    type="checkbox"
                    checked={deptosCompartidos.includes(d.id)}
                    onChange={() => toggleDeptoCompartido(d.id)}
                  />
                  {d.nombre}
                </label>
              ))}
            </div>
          </div>
        )}
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
            {a.compartidas?.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--texto-tenue)', marginBottom: '0.5rem' }}>
                Compartida con: {a.compartidas.map((c) => c.departamento.nombre).join(', ')}
              </div>
            )}
            <AgendaForm asignacion={a} onGuardado={cargarAsignaciones} />
          </div>
        ))}
        {asignaciones.length === 0 && <p style={{ color: 'var(--texto-tenue)' }}>Sin asignaciones todavía para esta tarea.</p>}
      </div>

      {asignaciones.length > 2 && (
        <div style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      )}
    </div>
  )
}
