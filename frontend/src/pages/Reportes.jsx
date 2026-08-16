import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { departamentosApi, reportesApi } from '../api/recursos.js'
import SinAsignacion from './SinAsignacion.jsx'

function TablaSnapshots({ snapshots }) {
  return (
    <table>
      <thead>
        <tr><th>Fecha</th><th>Total</th><th>Realizadas</th><th>Vencidas sin hacer</th></tr>
      </thead>
      <tbody>
        {snapshots.map((s) => (
          <tr key={s.id}>
            <td>{s.fecha.slice(0, 10)}</td>
            <td>{s.total_tareas}</td>
            <td>{s.realizadas}</td>
            <td>{s.vencidas_sin_hacer}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Reportes() {
  const { departamento, esAdminGlobal } = useAuthStore()
  const [departamentos, setDepartamentos] = useState([])
  const [porDepto, setPorDepto] = useState({})
  const [idExpandido, setIdExpandido] = useState('')
  const [idDepartamento, setIdDepartamento] = useState(departamento?.id || '')
  const [data, setData] = useState(null)

  // Admin ve el cumplimiento de TODOS los departamentos activos de una --
  // antes había que elegir uno a ciegas de un desplegable antes de ver nada.
  useEffect(() => {
    if (!esAdminGlobal) return
    departamentosApi.listar().then(async (deps) => {
      setDepartamentos(deps)
      const resultados = await Promise.all(
        deps.map((d) => reportesApi.cumplimiento({ departamento: d.id }).then((r) => [d.id, r]))
      )
      setPorDepto(Object.fromEntries(resultados))
    })
  }, [esAdminGlobal])

  useEffect(() => {
    if (!esAdminGlobal && idDepartamento) reportesApi.cumplimiento({ departamento: idDepartamento }).then(setData)
  }, [esAdminGlobal, idDepartamento])

  if (!departamento && !esAdminGlobal) return <SinAsignacion />

  if (esAdminGlobal) {
    const depExpandido = departamentos.find((d) => d.id === idExpandido)
    return (
      <div>
        <h2>Reportes de cumplimiento — todos los departamentos</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {departamentos.map((d) => {
            const r = porDepto[d.id]
            const activo = idExpandido === d.id
            return (
              <div
                key={d.id}
                className="card"
                style={{ cursor: 'pointer', borderColor: activo ? 'var(--teal)' : undefined }}
                onClick={() => setIdExpandido(activo ? '' : d.id)}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{d.nombre}</div>
                <div style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--teal)' }}>
                  {r?.porcentajeCumplimiento ?? '—'}%
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--texto-tenue)' }}>cumplimiento en el período</div>
              </div>
            )
          })}
        </div>

        {depExpandido && porDepto[idExpandido] && (
          <>
            <h3 style={{ marginBottom: '0.5rem' }}>{depExpandido.nombre} — detalle diario</h3>
            <TablaSnapshots snapshots={porDepto[idExpandido].snapshots} />
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <h2>Reportes de cumplimiento</h2>
      {data && (
        <>
          <div className="card" style={{ marginBottom: '1rem', display: 'inline-block' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--teal)' }}>
              {data.porcentajeCumplimiento ?? '—'}%
            </div>
            <div style={{ color: 'var(--texto-tenue)' }}>cumplimiento en el período</div>
          </div>
          <TablaSnapshots snapshots={data.snapshots} />
        </>
      )}
    </div>
  )
}
