import { useEffect, useState } from 'react'
import { departamentosApi, tareasApi } from '../../api/recursos.js'

export default function AdminTareas() {
  const [departamentos, setDepartamentos] = useState([])
  const [tareas, setTareas] = useState([])
  const [nombre, setNombre] = useState('')
  const [idDepartamento, setIdDepartamento] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargarTareas() {
    setTareas(await tareasApi.listar())
  }

  useEffect(() => {
    departamentosApi.listar().then(setDepartamentos)
    cargarTareas()
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setGuardando(true)
    try {
      await tareasApi.crear({ nombre, id_departamento: idDepartamento })
      setNombre('')
      await cargarTareas()
    } finally {
      setGuardando(false)
    }
  }

  const nombreDepto = (id) => departamentos.find((d) => d.id === id)?.nombre || id

  return (
    <div>
      <h2>Catálogo de tareas</h2>
      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: '0.75rem', maxWidth: 520, marginBottom: '1.5rem' }}>
        <input placeholder="Nombre (ej. CMV)" value={nombre} onChange={(e) => setNombre(e.target.value)} required style={{ flex: 1, padding: '0.4rem' }} />
        <select value={idDepartamento} onChange={(e) => setIdDepartamento(e.target.value)} required style={{ padding: '0.4rem' }}>
          <option value="">Departamento...</option>
          {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <button className="btn" disabled={guardando}>Crear</button>
      </form>

      <table>
        <thead><tr><th>Nombre</th><th>Departamento</th></tr></thead>
        <tbody>
          {tareas.map((t) => (
            <tr key={t.id}><td>{t.nombre}</td><td>{nombreDepto(t.id_departamento)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
