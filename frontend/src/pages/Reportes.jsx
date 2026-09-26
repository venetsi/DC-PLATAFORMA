import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { departamentosApi, localesApi, reportesApi } from '../api/recursos.js'
import SinAsignacion from './SinAsignacion.jsx'

// Filtro de local + rango de fechas -- la API ya los soporta
// (?local=&desde=&hasta=) pero hasta ahora no había ningún control para
// usarlos desde la pantalla, solo llamando la API directo (ver
// docs/MANUAL-ADMINISTRADOR.md). "Local" lista TODOS los locales activos
// (no hay forma de acotarlos por departamento en este cache) -- elegir uno
// que no tenga tareas en ese departamento simplemente da una tabla vacía.
function FiltrosReporte({ locales, filtro, onCambio }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', margin: '0.75rem 0 1rem' }}>
      <select
        value={filtro.local}
        onChange={(e) => onCambio({ ...filtro, local: e.target.value })}
        style={{ padding: '0.35rem' }}
      >
        <option value="">Todos los locales</option>
        {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
      </select>
      <label style={{ fontSize: '0.82rem', color: 'var(--texto-tenue)', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        Desde
        <input type="date" value={filtro.desde} onChange={(e) => onCambio({ ...filtro, desde: e.target.value })} style={{ padding: '0.3rem' }} />
      </label>
      <label style={{ fontSize: '0.82rem', color: 'var(--texto-tenue)', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        Hasta
        <input type="date" value={filtro.hasta} onChange={(e) => onCambio({ ...filtro, hasta: e.target.value })} style={{ padding: '0.3rem' }} />
      </label>
      {(filtro.local || filtro.desde || filtro.hasta) && (
        <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={() => onCambio({ local: '', desde: '', hasta: '' })}>
          Limpiar filtros
        </button>
      )}
    </div>
  )
}

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

const FILTRO_VACIO = { local: '', desde: '', hasta: '' }

export default function Reportes() {
  const { departamento, esAdminGlobal } = useAuthStore()
  const [departamentos, setDepartamentos] = useState([])
  const [locales, setLocales] = useState([])
  const [porDepto, setPorDepto] = useState({})
  const [idExpandido, setIdExpandido] = useState('')
  const [idDepartamento, setIdDepartamento] = useState(departamento?.id || '')
  const [data, setData] = useState(null)

  // Detalle del departamento expandido CON filtro -- separado de porDepto
  // (que siempre trae el período completo sin filtrar, para las tarjetas).
  const [detalle, setDetalle] = useState(null)
  const [filtroExpandido, setFiltroExpandido] = useState(FILTRO_VACIO)
  const [filtroPropio, setFiltroPropio] = useState(FILTRO_VACIO)

  useEffect(() => {
    localesApi.listar().then(setLocales)
  }, [])

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
    if (!esAdminGlobal || !idExpandido) return
    reportesApi
      .cumplimiento({
        departamento: idExpandido,
        local: filtroExpandido.local || undefined,
        desde: filtroExpandido.desde || undefined,
        hasta: filtroExpandido.hasta || undefined
      })
      .then(setDetalle)
  }, [esAdminGlobal, idExpandido, filtroExpandido])

  useEffect(() => {
    if (esAdminGlobal || !idDepartamento) return
    reportesApi
      .cumplimiento({
        departamento: idDepartamento,
        local: filtroPropio.local || undefined,
        desde: filtroPropio.desde || undefined,
        hasta: filtroPropio.hasta || undefined
      })
      .then(setData)
  }, [esAdminGlobal, idDepartamento, filtroPropio])

  if (!departamento && !esAdminGlobal) return <SinAsignacion />

  if (esAdminGlobal) {
    const depExpandido = departamentos.find((d) => d.id === idExpandido)

    function expandir(id) {
      const activo = idExpandido === id
      setIdExpandido(activo ? '' : id)
      setFiltroExpandido(FILTRO_VACIO)
      if (activo) setDetalle(null)
    }

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
                onClick={() => expandir(d.id)}
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

        {depExpandido && (
          <>
            <h3 style={{ marginBottom: '0.25rem' }}>{depExpandido.nombre} — detalle diario</h3>
            <FiltrosReporte locales={locales} filtro={filtroExpandido} onCambio={setFiltroExpandido} />
            {detalle && (
              <>
                <div className="card" style={{ marginBottom: '1rem', display: 'inline-block' }}>
                  <div style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--teal)' }}>
                    {detalle.porcentajeCumplimiento ?? '—'}%
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--texto-tenue)' }}>cumplimiento con este filtro</div>
                </div>
                <TablaSnapshots snapshots={detalle.snapshots} />
              </>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <h2>Reportes de cumplimiento</h2>
      <FiltrosReporte locales={locales} filtro={filtroPropio} onCambio={setFiltroPropio} />
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
