import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { instanciasApi } from '../api/recursos.js'
import SinAsignacion from './SinAsignacion.jsx'

function estadoBadge(estado) {
  if (estado === 'REALIZADA' || estado === 'APROBADA') return <span className="badge badge-verde">Realizada</span>
  return <span className="badge badge-amarillo">Pendiente</span>
}

export default function MiChecklist() {
  const departamento = useAuthStore((s) => s.departamento)
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [marcando, setMarcando] = useState(null)

  async function cargar() {
    setCargando(true)
    const { items } = await instanciasApi.hoy()
    setItems(items)
    setCargando(false)
  }

  useEffect(() => {
    if (departamento) cargar()
    else setCargando(false)
  }, [departamento])

  if (!departamento) return <SinAsignacion />
  if (cargando) return <p>Cargando...</p>

  async function marcar(instanceId) {
    setMarcando(instanceId)
    try {
      await instanciasApi.marcar(instanceId, departamento.id)
      await cargar()
    } finally {
      setMarcando(null)
    }
  }

  return (
    <div>
      <h2>Mi checklist de hoy — {departamento.nombre}</h2>
      {items.length === 0 && <p style={{ color: 'var(--texto-tenue)' }}>No hay tareas agendadas para hoy.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((evento) => {
          const props = evento.extendedProperties?.private || {}
          const hecha = props.estado === 'REALIZADA' || props.estado === 'APROBADA'
          return (
            <div key={evento.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{evento.summary}</strong> {estadoBadge(props.estado)}
                {hecha && <div style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)' }}>por {props.realizada_por}</div>}
              </div>
              {!hecha && (
                <button className="btn" disabled={marcando === evento.id} onClick={() => marcar(evento.id)}>
                  {marcando === evento.id ? 'Marcando...' : 'Marcar realizada'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
