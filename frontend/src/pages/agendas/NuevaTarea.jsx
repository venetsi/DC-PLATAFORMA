import { useState } from 'react'
import { agendasApi } from '../../api/recursos.js'
import EditorFrecuencia from '../../components/EditorFrecuencia.jsx'
import SelectorAlcance, { ALCANCE_VACIO, alcanceCompleto, describirAlcance } from './SelectorAlcance.jsx'
import { valorInicial, agendaDesdeValor, errorDeValor, describirAgenda, fechaCorta } from '../../lib/agenda-texto.js'

// Nueva tarea en un paso: que + donde + cuando + quien, y la frase de abajo
// dice exactamente que se va a crear antes de tocar "Crear y agendar".
// `fechaInicial` (YYYY-MM-DD): al tocar un dia vacio en el calendario, la tarea
// arranca como "una sola vez, ese dia" (se puede cambiar a una frecuencia).
export default function NuevaTarea({ departamentos, idDepartamentoInicial, locales, grupos, usuariosDe, onCreada, onCerrar, fechaInicial }) {
  const [nombre, setNombre] = useState('')
  const [idDepto, setIdDepto] = useState(departamentos.some((d) => d.id === idDepartamentoInicial) ? idDepartamentoInicial : departamentos[0]?.id || '')
  const [alcance, setAlcance] = useState(ALCANCE_VACIO)
  const [frecuencia, setFrecuencia] = useState(() => (fechaInicial ? { ...valorInicial(), tipo: 'UNICA', fecha: fechaInicial, desde: fechaInicial } : valorInicial()))
  const [responsable, setResponsable] = useState('')
  const [masOpciones, setMasOpciones] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [compartir, setCompartir] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const usuarios = usuariosDe(idDepto)
  const depto = departamentos.find((d) => d.id === idDepto)
  const agenda = agendaDesdeValor(frecuencia)
  const errorFrecuencia = errorDeValor(frecuencia)
  const listo = nombre.trim() && idDepto && alcanceCompleto(alcance) && !errorFrecuencia
  const quien = responsable ? usuarios.find((u) => u.email === responsable)?.nombre || responsable : 'sin responsable fijo (la hace el equipo)'

  async function crear(e) {
    e.preventDefault()
    if (!listo) return setError(errorFrecuencia || 'Completá qué, dónde y el departamento')
    setError('')
    setGuardando(true)
    try {
      const r = await agendasApi.crearTarea({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        id_departamento: idDepto,
        alcance,
        agenda,
        asignado_a: responsable || null,
        compartir_con: compartir
      })
      onCreada(r)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la tarea')
      setGuardando(false)
    }
  }

  return (
    <form className="card panel-nueva" onSubmit={crear}>
      <div className="panel-nueva-cab">
        <h3>Nueva tarea</h3>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando} aria-label="Cerrar">✕</button>
      </div>
      <div className="campos-nueva">
        <label className="campo">
          <span>Qué</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Control de caja" autoFocus required />
        </label>
        {departamentos.length > 1 && (
          <label className="campo">
            <span>Departamento</span>
            <select value={idDepto} onChange={(e) => { setIdDepto(e.target.value); setResponsable(''); setCompartir([]) }}>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>
        )}
        <div className="campo">
          <span>Dónde</span>
          <SelectorAlcance valor={alcance} onChange={setAlcance} locales={locales} grupos={grupos} />
        </div>
        <div className="campo">
          <span>Cuándo</span>
          <EditorFrecuencia valor={frecuencia} onChange={setFrecuencia} />
        </div>
        <label className="campo">
          <span>Quién</span>
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">Equipo (sin responsable fijo)</option>
            {usuarios.map((u) => <option key={u.id} value={u.email}>{u.nombre || u.email}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="enlace" onClick={() => setMasOpciones((v) => !v)} aria-expanded={masOpciones}>
        {masOpciones ? '▾' : '▸'} Más opciones (descripción, compartir con otros departamentos)
      </button>
      {masOpciones && (
        <div className="campos-nueva">
          <label className="campo" style={{ gridColumn: '1 / -1' }}>
            <span>Descripción</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué hay que revisar y dónde se deja el resultado" />
          </label>
          <div className="campo" style={{ gridColumn: '1 / -1' }}>
            <span>Compartir con (cada uno la ve en su agenda; marcarla en uno la marca en todos)</span>
            <div className="chips">
              {departamentos.filter((d) => d.id !== idDepto).map((d) => (
                <label key={d.id} className="chip-check">
                  <input type="checkbox" checked={compartir.includes(d.id)} onChange={() => setCompartir((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))} />
                  {d.nombre}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="frase-resumen">
        Se crea <strong>{nombre.trim() || 'la tarea'}</strong> en {depto?.nombre || '…'} para {describirAlcance(alcance, locales)},{' '}
        {describirAgenda(agenda)?.toLowerCase()}
        {frecuencia.tipo !== 'UNICA' ? ` desde el ${fechaCorta(frecuencia.desde)}` : ''}, {quien}
        {compartir.length ? `, compartida con ${compartir.map((id) => departamentos.find((d) => d.id === id)?.nombre).join(', ')}` : ''}.
      </p>
      {error && <p className="error-texto">{error}</p>}
      <div className="acciones">
        <button className="btn" disabled={guardando}>{guardando ? 'Creando…' : 'Crear y agendar'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </form>
  )
}
