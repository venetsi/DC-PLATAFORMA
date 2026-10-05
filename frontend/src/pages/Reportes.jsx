import { Fragment, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { reportesApi } from '../api/recursos.js'
import SinAsignacion from './SinAsignacion.jsx'
import { armarPorResponsable } from '../lib/reportes-responsables.js'

// Tablero de cumplimiento: un mes a la vez (con los 5 anteriores para
// comparar), solo los dias que tuvieron tareas, y el desglose por grupo ->
// local -> tarea. Lee /reportes/tablero (dias ya cerrados, lo escribe el job
// diario); "no aplica" no suma ni resta al porcentaje.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function mesActual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function correrMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nombreMes = (mes) => { const [a, m] = mes.split('-').map(Number); return `${MESES[m - 1]} ${a}` }
const mesCorto = (mes) => MESES_CORTOS[Number(mes.slice(5, 7)) - 1]
function diaCorto(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return `${DIAS[new Date(a, m - 1, d).getDay()]} ${d}`
}
function tono(pct) {
  if (pct == null) return 'tono-nada'
  return pct >= 90 ? 'tono-ok' : pct >= 70 ? 'tono-medio' : 'tono-mal'
}
const pct = (v) => (v == null ? '—' : `${v}%`)

function Barra({ c }) {
  const base = c.hechas + c.vencidas
  if (!base) return <div className="barra" />
  return (
    <div className="barra" role="img" aria-label={`${c.hechas} hechas, ${c.vencidas} atrasadas`}>
      <div style={{ width: `${(c.hechas / base) * 100}%`, background: 'var(--verde)' }} />
      <div style={{ width: `${(c.vencidas / base) * 100}%`, background: 'var(--rojo)' }} />
    </div>
  )
}

export default function Reportes() {
  const { departamento, esAdminGlobal } = useAuthStore()
  const [mes, setMes] = useState(mesActual())
  const [idDepto, setIdDepto] = useState('')
  const [grupo, setGrupo] = useState('')
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abiertos, setAbiertos] = useState(() => new Set())
  // 'responsable' (persona -> departamento) o 'departamento' (departamento -> persona).
  const [ordenResp, setOrdenResp] = useState('responsable')
  const ultimoPedido = useRef(0)

  useEffect(() => {
    const pedido = ++ultimoPedido.current
    setCargando(true)
    setError('')
    reportesApi
      .tablero({ mes, departamento: idDepto || undefined, grupo: grupo || undefined })
      .then((r) => { if (pedido === ultimoPedido.current) setData(r) })
      .catch((err) => { if (pedido === ultimoPedido.current) setError(err.response?.data?.error || 'No se pudo cargar el tablero') })
      .finally(() => { if (pedido === ultimoPedido.current) setCargando(false) })
  }, [mes, idDepto, grupo])

  if (!departamento && !esAdminGlobal) return <SinAsignacion />

  function alternar(clave) {
    setAbiertos((prev) => {
      const s = new Set(prev)
      s.has(clave) ? s.delete(clave) : s.add(clave)
      return s
    })
  }

  const r = data?.resumen
  const antes = data?.resumen_mes_anterior
  const delta = r?.cumplimiento != null && antes?.cumplimiento != null ? r.cumplimiento - antes.cumplimiento : null
  const esMesActual = mes === mesActual()

  return (
    <div className="tablero">
      <div className="tablero-barra">
        <div className="mes-nav">
          <button className="btn btn-secondary" onClick={() => setMes(correrMes(mes, -1))} aria-label="Mes anterior">‹</button>
          <h2>{nombreMes(mes)}</h2>
          <button className="btn btn-secondary" onClick={() => setMes(correrMes(mes, 1))} disabled={esMesActual} aria-label="Mes siguiente">›</button>
          {cargando && <span className="cargando-chip" role="status">Actualizando…</span>}
        </div>
        <div className="tablero-filtros">
          {data?.departamentos.length > 1 && (
            <select value={idDepto} onChange={(e) => { setIdDepto(e.target.value); setGrupo('') }} aria-label="Departamento">
              <option value="">Todos los departamentos</option>
              {data.departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          )}
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
            <option value="">Todos los grupos</option>
            {(data?.grupos_disponibles || []).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {(idDepto || grupo) && <button className="btn btn-secondary" onClick={() => { setIdDepto(''); setGrupo('') }}>Limpiar</button>}
        </div>
      </div>

      {error && <p style={{ color: 'var(--rojo)' }}>{error}</p>}

      {r && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Cumplimiento</span>
              <b className={tono(r.cumplimiento)}>{pct(r.cumplimiento)}</b>
              {delta != null && (
                <small style={{ color: delta >= 0 ? 'var(--verde)' : 'var(--rojo)' }}>
                  {delta >= 0 ? '+' : ''}{delta} puntos vs {nombreMes(correrMes(mes, -1)).split(' ')[0].toLowerCase()}
                </small>
              )}
            </div>
            <div className="kpi"><span>Hechas a tiempo</span><b>{r.a_tiempo}</b></div>
            <div className="kpi"><span>Hechas tarde</span><b style={{ color: r.tarde ? 'var(--amarillo)' : undefined }}>{r.tarde}</b></div>
            <div className="kpi"><span>Atrasadas sin hacer</span><b style={{ color: r.vencidas ? 'var(--rojo)' : undefined }}>{r.vencidas}</b></div>
            <div className="kpi"><span>No aplica</span><b style={{ color: 'var(--texto-tenue)' }}>{r.no_aplica}</b></div>
          </div>
          <p className="tablero-nota">
            {data.datos_hasta ? `Datos de días cerrados, hasta el ${data.datos_hasta.split('-').reverse().join('/')}.` : 'Todavía no hay días cerrados registrados.'}
            {' '}Las atrasadas que se hacen después pasan a "hechas tarde".
          </p>

          {data.por_mes.departamentos.length > 0 && (
            <section className="card tablero-seccion">
              <h3>Por mes y departamento</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla-calor">
                  <thead>
                    <tr><th>Departamento</th>{data.por_mes.meses.map((mm) => <th key={mm}>{mesCorto(mm)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.por_mes.departamentos.map((d) => (
                      <tr key={d.id}>
                        <td>{d.nombre}</td>
                        {d.meses.map((x) => (
                          <td key={x.mes}>
                            <button
                              className={`celda ${tono(x.cumplimiento)}${x.mes === mes && idDepto === d.id ? ' activa' : ''}`}
                              onClick={() => { setMes(x.mes); setIdDepto(d.id) }}
                              disabled={!x.total}
                              title={x.total ? `${d.nombre}, ${nombreMes(x.mes)}: ${x.total} tareas` : 'Sin tareas'}
                            >
                              {x.total ? pct(x.cumplimiento) : '—'}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {r.total === 0 ? (
            <section className="card tablero-seccion">
              <p style={{ margin: 0, color: 'var(--texto-tenue)' }}>No hubo tareas en {nombreMes(mes).toLowerCase()} con estos filtros.</p>
            </section>
          ) : (
            <div className="tablero-dos">
              <section className="card tablero-seccion">
                <h3>Días con tareas</h3>
                <div className="tabla-scroll">
                <table className="tabla-dias">
                  <thead><tr><th>Día</th><th>Tareas</th><th>Hechas</th><th>Atrasadas</th><th aria-label="Proporción" /></tr></thead>
                  <tbody>
                    {data.dias.map((d) => (
                      <tr key={d.fecha}>
                        <td>{diaCorto(d.fecha)}</td>
                        <td>{d.total}</td>
                        <td>{d.hechas}{d.tarde > 0 && <span className="tarde"> ({d.tarde} tarde)</span>}</td>
                        <td style={{ color: d.vencidas ? 'var(--rojo)' : undefined }}>{d.vencidas}</td>
                        <td style={{ width: '35%' }}><Barra c={d} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>

              <section className="card tablero-seccion">
                <h3>Por grupo y local</h3>
                {/* En celular no entra: se desliza de costado dentro de la tarjeta,
                    en vez de correr la pagina entera. */}
                <div className="tabla-scroll">
                <table className="tabla-grupos">
                  <thead><tr><th>Grupo / local</th><th>Tareas</th><th>Hechas</th><th>Atrasadas</th><th>Cumpl.</th></tr></thead>
                  <tbody>
                    {data.grupos.map((g) => {
                      const abierto = abiertos.has(g.grupo)
                      return (
                        <Fragment key={g.grupo}>
                          <tr className="fila-grupo">
                            <td>
                              <button className="plegar" onClick={() => alternar(g.grupo)} aria-expanded={abierto}>
                                <span aria-hidden="true">{abierto ? '▾' : '▸'}</span> {g.grupo}
                              </button>
                            </td>
                            <td>{g.total}</td><td>{g.hechas}</td>
                            <td style={{ color: g.vencidas ? 'var(--rojo)' : undefined }}>{g.vencidas}</td>
                            <td><span className={`pildora ${tono(g.cumplimiento)}`}>{pct(g.cumplimiento)}</span></td>
                          </tr>
                          {abierto && g.locales.map((l) => (
                            <tr key={l.id_local_ext || 'empresa'} className="fila-local">
                              <td>
                                {l.nombre}
                                <div className="tareas-local">
                                  {l.tareas.map((t) => (
                                    <span key={t.nombre} className={t.vencidas ? 'chip-mal' : 'chip-ok'} title={`${t.hechas} hechas, ${t.vencidas} atrasadas`}>
                                      {t.nombre}{t.vencidas ? ` · ${t.vencidas} atr.` : ''}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>{l.total}</td><td>{l.hechas}</td>
                              <td style={{ color: l.vencidas ? 'var(--rojo)' : undefined }}>{l.vencidas}</td>
                              <td><span className={`pildora ${tono(l.cumplimiento)}`}>{pct(l.cumplimiento)}</span></td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </section>
            </div>
          )}

          {r.total > 0 && data.por_responsable?.length > 0 && (() => {
            const arbol = armarPorResponsable(data.por_responsable, ordenResp)
            const etiquetas = ordenResp === 'responsable' ? ['Responsable', 'Departamento'] : ['Departamento', 'Responsable']
            return (
              <section className="card tablero-seccion">
                <div className="tablero-cab-seccion">
                  <h3>Tareas por responsable y departamento</h3>
                  <div role="group" aria-label="Orden del listado" className="tablero-filtros">
                    <button className={ordenResp === 'responsable' ? 'btn btn-chico' : 'btn btn-secondary btn-chico'} aria-pressed={ordenResp === 'responsable'} onClick={() => setOrdenResp('responsable')}>Por responsable</button>
                    <button className={ordenResp === 'departamento' ? 'btn btn-chico' : 'btn btn-secondary btn-chico'} aria-pressed={ordenResp === 'departamento'} onClick={() => setOrdenResp('departamento')}>Por departamento</button>
                  </div>
                </div>
                <p className="tablero-nota" style={{ margin: '0 0 0.6rem' }}>
                  Lo que cada {etiquetas[0].toLowerCase()} tiene a cargo en {nombreMes(mes).toLowerCase()}, abierto por {etiquetas[1].toLowerCase()} y tarea. El responsable es el de cada tarea; las que no tienen uno fijo figuran como «Equipo». Primero lo que tiene más atrasadas.
                </p>
                <div className="tabla-scroll">
                  <table className="tabla-grupos">
                    <thead><tr><th>{etiquetas[0]} / {etiquetas[1].toLowerCase()}</th><th>Tareas</th><th>Hechas</th><th>Atrasadas</th><th>Cumpl.</th></tr></thead>
                    <tbody>
                      {arbol.map((n1) => {
                        const clave = `resp::${ordenResp}::${n1.clave}`
                        const abierto = abiertos.has(clave)
                        return (
                          <Fragment key={clave}>
                            <tr className="fila-grupo">
                              <td>
                                <button className="plegar" onClick={() => alternar(clave)} aria-expanded={abierto}>
                                  <span aria-hidden="true">{abierto ? '▾' : '▸'}</span> {n1.nombre}
                                </button>
                              </td>
                              <td>{n1.total}</td><td>{n1.hechas}</td>
                              <td style={{ color: n1.vencidas ? 'var(--rojo)' : undefined }}>{n1.vencidas}</td>
                              <td><span className={`pildora ${tono(n1.cumplimiento)}`}>{pct(n1.cumplimiento)}</span></td>
                            </tr>
                            {abierto && n1.hijos.map((n2) => (
                              <tr key={`${clave}::${n2.clave}`} className="fila-local">
                                <td>
                                  {n2.nombre}
                                  <div className="tareas-local">
                                    {n2.tareas.map((t) => (
                                      <span key={t.nombre} className={t.vencidas ? 'chip-mal' : 'chip-ok'} title={`${t.nombre}: ${t.hechas} hechas, ${t.vencidas} atrasadas, en ${t.locales} ${t.locales === 1 ? 'local' : 'locales'}`}>
                                        {t.nombre}{t.vencidas ? ` · ${t.vencidas} atr.` : ''}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td>{n2.total}</td><td>{n2.hechas}</td>
                                <td style={{ color: n2.vencidas ? 'var(--rojo)' : undefined }}>{n2.vencidas}</td>
                                <td><span className={`pildora ${tono(n2.cumplimiento)}`}>{pct(n2.cumplimiento)}</span></td>
                              </tr>
                            ))}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })()}
        </>
      )}
    </div>
  )
}
