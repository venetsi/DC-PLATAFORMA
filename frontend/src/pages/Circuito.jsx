import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { circuitoApi } from '../api/recursos.js'

// Circuito: en que paso esta cada local esta semana (Auditoria VTA/OP ->
// Costos CMV -> Reportes Informe). Diseño elegido el 24/11/2026 (opcion C):
// una fila por local con una barra de tres tramos, de lo mas trabado a lo
// cerrado, y una frase de quien lo frena. El circuito sale de las esperas
// cargadas en Agendas (ver backend/src/lib/circuito.js).

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
function numeroDeDia(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}
const diaCorto = (iso) => (iso ? DIAS[numeroDeDia(iso)] : '')
const diaLargo = (iso) => (iso ? DIAS_LARGOS[numeroDeDia(iso)] : '')
function fechaLarga(iso) {
  const [, m, d] = iso.split('-').map(Number)
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${MESES[m - 1]}`
}
function correr(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// Texto y tono del tramo de un paso.
function tramo(paso, nombre) {
  if (!paso) return { tono: 'no', texto: `— ${nombre}`, titulo: 'Este local no tiene este paso' }
  if (paso.espera) return { tono: 'esp', texto: `${nombre} ⏳`, titulo: 'Espera al paso anterior' }
  switch (paso.estado) {
    case 'hecha': return { tono: 'ok', texto: `${nombre} ✓`, titulo: `Hecha (${diaCorto(paso.fecha)})` }
    case 'no_aplica': return { tono: 'ok', texto: `${nombre} ⊘`, titulo: 'No aplica esta semana' }
    case 'atrasada': return { tono: 'mal', texto: `${nombre} · ${paso.dias || 0} d`, titulo: `Atrasada desde el ${diaCorto(paso.fecha)} ${paso.fecha.slice(8)}/${paso.fecha.slice(5, 7)}` }
    case 'hoy': return { tono: 'pen', texto: `${nombre} · hoy`, titulo: 'Le toca hoy' }
    case 'pendiente': return { tono: 'pen', texto: `${nombre} · ${diaCorto(paso.fecha)}`, titulo: 'Le toca más adelante en la semana' }
    default: return { tono: 'no', texto: `${nombre} · sin fecha`, titulo: 'No le toca esta semana' }
  }
}

function nota(fila, pasos) {
  if (fila.frena === null) {
    const hechos = fila.pasos.filter((p) => p && (p.estado === 'hecha' || p.estado === 'no_aplica'))
    if (!hechos.length) return <>Sin tareas esta semana</>
    const ultima = hechos.map((p) => p.fecha).sort().at(-1)
    return <>Cerrado el {diaLargo(ultima)}</>
  }
  const p = fila.pasos[fila.frena]
  const paso = pasos[fila.frena]
  if (p.estado === 'atrasada') return <>Lo frena <b>{paso.departamento}</b> ({paso.nombre})</>
  if (p.estado === 'hoy') return <>Le toca a <b>{paso.departamento}</b> hoy</>
  return <>Le toca a <b>{paso.departamento}</b> el {diaLargo(p.fecha)}</>
}

export default function Circuito() {
  const [semana, setSemana] = useState(null) // un dia de la semana pedida; null = la actual
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [grupo, setGrupo] = useState('')

  useEffect(() => {
    let vigente = true
    setCargando(true)
    circuitoApi.ver(semana)
      .then((r) => { if (vigente) { setData(r); setError('') } })
      .catch((err) => { if (vigente) setError(err.response?.data?.error || 'No se pudo cargar el circuito') })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [semana])

  const circuito = data?.circuitos?.[0]
  const grupos = useMemo(() => [...new Set((circuito?.filas || []).map((f) => f.grupo).filter(Boolean))].sort(), [circuito])
  const filas = (circuito?.filas || []).filter((f) => !grupo || f.grupo === grupo)

  return (
    <div className="circuito">
      <div className="agenda-cab">
        <div>
          <h2 className="titulo-pagina"><span>Circuito</span>{cargando && <span className="cargando-chip" role="status">Actualizando…</span>}</h2>
          {circuito && data && (
            <div className="tenue circuito-sub">
              {circuito.pasos.map((p) => `${p.departamento} (${p.nombre})`).join(' → ')} · semana del {fechaLarga(data.semana.lunes)} al {fechaLarga(data.semana.viernes)}
            </div>
          )}
        </div>
        <Link className="btn btn-secondary" to="/agendas" title="El circuito sale de las esperas que tiene cada tarea en Agendas">Configurar circuito</Link>
      </div>

      <div className="circuito-barra">
        <div className="segmentado" role="group" aria-label="Semana">
          <button type="button" onClick={() => setSemana(correr(data?.semana.lunes || data?.hoy, -7))} disabled={!data}>‹ Semana anterior</button>
          <button type="button" className={semana ? '' : 'on'} onClick={() => setSemana(null)}>Esta semana</button>
          <button type="button" onClick={() => setSemana(correr(data?.semana.lunes || data?.hoy, 7))} disabled={!data}>Siguiente ›</button>
        </div>
        {grupos.length > 1 && (
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
            <option value="">Todos los grupos</option>
            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <div className="circuito-leyenda" aria-hidden="true">
          <span className="st ok">✓ Hecha</span><span className="st esp">⏳ Espera</span><span className="st pen">Pendiente</span><span className="st mal">Atrasada</span><span className="st no">— No está</span>
        </div>
      </div>

      {error && <p className="error-texto">{error}</p>}
      {data?.sin_leer?.length > 0 && <p className="aviso aviso-mal">No se pudo leer la agenda de {data.sin_leer.join(', ')}: sus pasos pueden verse incompletos.</p>}
      {data && !circuito && !cargando && (
        <p className="tenue">Todavía no hay un circuito: se arma solo cuando una tarea espera a otra (en Agendas → Opciones avanzadas → Depende de otra tarea).</p>
      )}

      {circuito && (
        <div className="circuito-lista card" role="list">
          {filas.map((f) => (
            <div key={f.id_local || 'empresa'} className="circuito-fila" role="listitem">
              <div className="circuito-local"><b>{f.local}</b>{f.grupo && <span>{f.grupo}</span>}</div>
              <div className="circuito-pasos" style={{ gridTemplateColumns: `repeat(${circuito.pasos.length}, minmax(0, 1fr))` }}>
                {f.pasos.map((p, i) => {
                  const t = tramo(p, circuito.pasos[i].nombre)
                  return <div key={i} className={`st ${t.tono}`} title={t.titulo}>{t.texto}</div>
                })}
              </div>
              <div className="circuito-nota">{nota(f, circuito.pasos)}</div>
            </div>
          ))}
          {!filas.length && <p className="tenue" style={{ padding: '1rem' }}>Ningún local de ese grupo está en el circuito.</p>}
        </div>
      )}
    </div>
  )
}
