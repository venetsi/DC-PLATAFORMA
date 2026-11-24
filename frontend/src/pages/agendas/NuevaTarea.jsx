import { useEffect, useState } from 'react'
import { URGENCIAS } from '../../lib/urgencia.js'
import Urgencia from '../../components/Urgencia.jsx'
import { agendasApi, tareasApi } from '../../api/recursos.js'
import { tareaParecida } from '../../lib/parecida.js'
import EditorFrecuencia from '../../components/EditorFrecuencia.jsx'
import SelectorAlcance, { ALCANCE_VACIO, alcanceCompleto, describirAlcance } from './SelectorAlcance.jsx'
import { valorInicial, agendaDesdeValor, errorDeValor, describirAgenda, fechaCorta } from '../../lib/agenda-texto.js'

// Lo que se le dice a la persona despues de crear (o de sumar locales a una
// tarea que ya existia).
export function mensajeDeCreacion(r) {
  const partes = []
  if (r.sumada) {
    const ya = r.ya_existian ? ` (${r.ya_existian} ya ${r.ya_existian === 1 ? 'estaba' : 'estaban'})` : ''
    partes.push(`Se ${r.asignaciones === 1 ? 'sumó 1 local' : `sumaron ${r.asignaciones} locales`} a "${r.tarea.nombre}"${ya}.`)
  } else {
    partes.push(`"${r.tarea.nombre}" creada: ${r.agendadas} de ${r.asignaciones} agendadas.`)
  }
  if (r.completadas) partes.push(`${r.completadas === 1 ? 'Se completó 1 local que había' : `Se completaron ${r.completadas} locales que habían`} quedado sin agendar.`)
  if (r.esperas) partes.push(`${r.esperas === 1 ? 'Se copió 1 espera' : `Se copiaron ${r.esperas} esperas`} de los otros locales.`)
  if (r.errores?.length) partes.push(`No se pudieron agendar: ${r.errores.join('; ')}. Volvé a cargarla con el mismo nombre y tocá «Sumar»: se completan.`)
  return partes.join(' ')
}

// Nueva tarea en un paso: que + donde + cuando + quien, y la frase de abajo
// dice exactamente que se va a crear antes de tocar "Crear y agendar".
// `fechaInicial` (YYYY-MM-DD): al tocar un dia vacio en el calendario, la tarea
// arranca como "una sola vez, ese dia" (se puede cambiar a una frecuencia).
//
// El nombre de una tarea es unico dentro del departamento: una tarea se hace
// en muchos locales. Si ya existe (o lo escrito empieza con el nombre de una
// que existe, como "CMV PIPISTRELLO"), se ofrece sumarle estos locales.
export default function NuevaTarea({ departamentos, idDepartamentoInicial, locales, grupos, usuariosDe, onCreada, onCerrar, fechaInicial }) {
  const [nombre, setNombre] = useState('')
  const [idDepto, setIdDepto] = useState(departamentos.some((d) => d.id === idDepartamentoInicial) ? idDepartamentoInicial : departamentos[0]?.id || '')
  const [alcance, setAlcance] = useState(ALCANCE_VACIO)
  const [frecuencia, setFrecuencia] = useState(() => (fechaInicial ? { ...valorInicial(), tipo: 'UNICA', fecha: fechaInicial, desde: fechaInicial } : valorInicial()))
  const [responsable, setResponsable] = useState('')
  const [urgencia, setUrgencia] = useState('')
  const [masOpciones, setMasOpciones] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [compartir, setCompartir] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [existente, setExistente] = useState(null) // la tarea con ese nombre, si ya habia una
  const [catalogo, setCatalogo] = useState([])

  useEffect(() => {
    let vigente = true
    tareasApi.listar().then((t) => { if (vigente) setCatalogo(t) }).catch(() => {})
    return () => { vigente = false }
  }, [])

  const usuarios = usuariosDe(idDepto)
  const depto = departamentos.find((d) => d.id === idDepto)
  const agenda = agendaDesdeValor(frecuencia)
  const errorFrecuencia = errorDeValor(frecuencia)
  const listo = nombre.trim() && idDepto && alcanceCompleto(alcance) && !errorFrecuencia
  const quien = responsable ? usuarios.find((u) => u.email === responsable)?.nombre || responsable : 'sin responsable fijo (la hace el equipo)'
  const parecida = existente ? null : tareaParecida(nombre, catalogo, idDepto)

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
        prioridad: urgencia || undefined,
        compartir_con: compartir
      })
      onCreada(r)
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.existente) {
        setExistente(err.response.data.existente)
        setError('')
      } else {
        setError(err.response?.data?.error || 'No se pudo crear la tarea')
      }
      setGuardando(false)
    }
  }

  // Sumar estos locales (con esta agenda y este responsable) a la que ya existe.
  async function sumarA(tarea) {
    if (!alcanceCompleto(alcance) || errorFrecuencia) return setError(errorFrecuencia || 'Elegí dónde (los locales) antes de sumar')
    setError('')
    setGuardando(true)
    try {
      const r = await agendasApi.agregarAlcance(tarea.id, { alcance, agenda, asignado_a: responsable || null, prioridad: urgencia || undefined, compartir_con: compartir })
      onCreada({ ...r, sumada: true, tarea: { id: tarea.id, nombre: tarea.nombre, id_departamento: tarea.id_departamento } })
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudieron sumar los locales')
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
          <input value={nombre} onChange={(e) => { setNombre(e.target.value); setExistente(null) }} placeholder="Control de caja" autoFocus required />
        </label>
        {departamentos.length > 1 && (
          <label className="campo">
            <span>Departamento</span>
            <select value={idDepto} onChange={(e) => { setIdDepto(e.target.value); setResponsable(''); setCompartir([]); setExistente(null) }}>
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
        <label className="campo">
          <span>Urgencia</span>
          <select value={urgencia} onChange={(e) => setUrgencia(e.target.value)}>
            <option value="">Sin marcar</option>
            {URGENCIAS.map((u) => <option key={u.valor} value={u.valor}>{u.icono} {u.etiqueta}</option>)}
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
      {parecida && (
        <div className="aviso-existente" role="status">
          <p>
            Ya hay <strong>{parecida.nombre}</strong> en {depto?.nombre}. Si es la misma tarea en otro local, sumale el local
            en vez de crear otra: así entra en sus esperas y en sus reportes.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => sumarA(parecida)} disabled={guardando}>
            Sumar a «{parecida.nombre}»
          </button>
        </div>
      )}
      {existente && (
        <div className="aviso-existente" role="status">
          {!existente.activa ? (
            <p>Hay una tarea desactivada llamada <strong>{existente.nombre}</strong> en {existente.departamento}. Para reusar el nombre, eliminala definitivamente desde Agendas (tildá «Desactivadas»), o elegí otro nombre.</p>
          ) : (
            <p>
              Ya existe <strong>{existente.nombre}</strong> en {existente.departamento}. Una tarea se hace en muchos locales:
              ¿le sumo estos, con esta agenda y este responsable?
            </p>
          )}
        </div>
      )}
      {error && <p className="error-texto">{error}</p>}
      <div className="acciones">
        {existente?.activa ? (
          <button type="button" className="btn" onClick={() => sumarA(existente)} disabled={guardando}>
            {guardando ? 'Sumando…' : `Sumar a «${existente.nombre}»`}
          </button>
        ) : (
          <button className="btn" disabled={guardando}>{guardando ? 'Creando…' : 'Crear y agendar'}</button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </form>
  )
}
