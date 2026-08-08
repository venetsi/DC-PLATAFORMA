import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { departamentosApi, reportesApi } from '../api/recursos.js'
import SinAsignacion from './SinAsignacion.jsx'

export default function Reportes() {
  const { departamento, esAdminGlobal } = useAuthStore()
  const [departamentos, setDepartamentos] = useState([])
  const [idDepartamento, setIdDepartamento] = useState(departamento?.id || '')
  const [data, setData] = useState(null)

  useEffect(() => {
    if (esAdminGlobal) departamentosApi.listar().then(setDepartamentos)
  }, [esAdminGlobal])

  useEffect(() => {
    if (idDepartamento) reportesApi.cumplimiento({ departamento: idDepartamento }).then(setData)
  }, [idDepartamento])

  if (!departamento && !esAdminGlobal) return <SinAsignacion />

  return (
    <div>
      <h2>Reportes de cumplimiento</h2>
      {esAdminGlobal && (
        <select value={idDepartamento} onChange={(e) => setIdDepartamento(e.target.value)} style={{ marginBottom: '1rem', padding: '0.4rem' }}>
          <option value="">Elegir departamento...</option>
          {departamentos.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre}</option>
          ))}
        </select>
      )}
      {data && (
        <>
          <div className="card" style={{ marginBottom: '1rem', display: 'inline-block' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--teal)' }}>
              {data.porcentajeCumplimiento ?? '—'}%
            </div>
            <div style={{ color: 'var(--texto-tenue)' }}>cumplimiento en el período</div>
          </div>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Total</th><th>Realizadas</th><th>Vencidas sin hacer</th></tr>
            </thead>
            <tbody>
              {data.snapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.fecha.slice(0, 10)}</td>
                  <td>{s.total_tareas}</td>
                  <td>{s.realizadas}</td>
                  <td>{s.vencidas_sin_hacer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
