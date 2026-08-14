import { useEffect, useState } from 'react'
import { departamentosApi, tareasApi } from '../../api/recursos.js'
import { useAuthStore } from '../../store/authStore.js'

export default function AdminTareas() {
  const esAdminGlobal = useAuthStore((s) => s.esAdminGlobal)
  const departamentoPropio = useAuthStore((s) => s.departamento)

  const [departamentos, setDepartamentos] = useState([])
  const [tareas, setTareas] = useState([])
  const [nombre, setNombre] = useState('')
  // Un usuario de departamento crea solo para el suyo -- ni siquiera se le
  // ofrece elegir otro (el backend lo rechazaria igual, ver tareas.js).
  const [idDepartamento, setIdDepartamento] = useState(esAdminGlobal ? '' : departamentoPropio?.id || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const [editandoId, setEditandoId] = useState(null)
  const [edicion, setEdicion] = useState({ nombre: '', descripcion: '' })

  const [nombreDepartamentoNuevo, setNombreDepartamentoNuevo] = useState('')
  const [creandoDepartamento, setCreandoDepartamento] = useState(false)
  const [errorDepartamento, setErrorDepartamento] = useState('')

  async function cargarTareas() {
    setTareas(await tareasApi.listar())
  }
  async function cargarDepartamentos() {
    setDepartamentos(await departamentosApi.listar())
  }

  useEffect(() => {
    cargarDepartamentos()
    cargarTareas()
  }, [])

  function puedeGestionar(idDepartamentoTarea) {
    return esAdminGlobal || departamentoPropio?.id === idDepartamentoTarea
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await tareasApi.crear({ nombre, id_departamento: idDepartamento })
      setNombre('')
      await cargarTareas()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la tarea')
    } finally {
      setGuardando(false)
    }
  }

  function empezarEdicion(t) {
    setEditandoId(t.id)
    setEdicion({ nombre: t.nombre, descripcion: t.descripcion || '' })
  }

  async function guardarEdicion(id) {
    await tareasApi.editar(id, edicion)
    setEditandoId(null)
    await cargarTareas()
  }

  async function desactivar(id) {
    if (!confirm('¿Desactivar esta tarea? Deja de aparecer en el catálogo.')) return
    await tareasApi.editar(id, { activa: false })
    await cargarTareas()
  }

  async function crearDepartamento(e) {
    e.preventDefault()
    setErrorDepartamento('')
    setCreandoDepartamento(true)
    try {
      await departamentosApi.crear(nombreDepartamentoNuevo)
      setNombreDepartamentoNuevo('')
      await cargarDepartamentos()
    } catch (err) {
      setErrorDepartamento(err.response?.data?.error || 'No se pudo crear el departamento')
    } finally {
      setCreandoDepartamento(false)
    }
  }

  const nombreDepto = (id) => departamentos.find((d) => d.id === id)?.nombre || id

  return (
    <div>
      {esAdminGlobal && (
        <div className="card" style={{ maxWidth: 420, marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Crear departamento</h3>
          <form onSubmit={crearDepartamento} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              placeholder="Nombre (ej. Marketing)"
              value={nombreDepartamentoNuevo}
              onChange={(e) => setNombreDepartamentoNuevo(e.target.value)}
              required
              style={{ flex: 1, padding: '0.4rem' }}
            />
            <button className="btn" disabled={creandoDepartamento}>Crear</button>
          </form>
          {errorDepartamento && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{errorDepartamento}</p>}
        </div>
      )}

      <h2>Catálogo de tareas</h2>
      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: '0.75rem', maxWidth: 520, marginBottom: '1.5rem' }}>
        <input placeholder="Nombre (ej. CMV)" value={nombre} onChange={(e) => setNombre(e.target.value)} required style={{ flex: 1, padding: '0.4rem' }} />
        {esAdminGlobal ? (
          <select value={idDepartamento} onChange={(e) => setIdDepartamento(e.target.value)} required style={{ padding: '0.4rem' }}>
            <option value="">Departamento...</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        ) : (
          <span style={{ padding: '0.4rem', color: 'var(--texto-tenue)' }}>{departamentoPropio?.nombre}</span>
        )}
        <button className="btn" disabled={guardando}>Crear</button>
      </form>
      {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{error}</p>}

      <table>
        <thead><tr><th>Nombre</th><th>Departamento</th><th></th></tr></thead>
        <tbody>
          {tareas.map((t) => (
            <tr key={t.id}>
              {editandoId === t.id ? (
                <>
                  <td>
                    <input
                      value={edicion.nombre}
                      onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                      style={{ padding: '0.3rem' }}
                    />
                  </td>
                  <td>{nombreDepto(t.id_departamento)}</td>
                  <td style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="btn" onClick={() => guardarEdicion(t.id)}>Guardar</button>
                    <button className="btn btn-secondary" onClick={() => setEditandoId(null)}>Cancelar</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{t.nombre}</td>
                  <td>{nombreDepto(t.id_departamento)}</td>
                  <td style={{ display: 'flex', gap: '0.4rem' }}>
                    {puedeGestionar(t.id_departamento) && (
                      <button className="btn btn-secondary" onClick={() => empezarEdicion(t)}>Editar</button>
                    )}
                    {esAdminGlobal && (
                      <button className="btn btn-secondary" onClick={() => desactivar(t.id)}>Desactivar</button>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
