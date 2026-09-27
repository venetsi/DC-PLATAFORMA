import { useState } from 'react'
import { tareasApi } from '../../api/recursos.js'

// Panel inline de "Duplicar" -- mismo lugar que el de agenda (debajo del
// renglon). Copia nombre nuevo + departamento + (opcional) la agenda completa:
// una asignacion por local con la misma frecuencia y responsable, desde hoy.
export default function DuplicarTarea({ tarea, departamentos, cantidadAsignaciones, onCerrar, onDuplicada }) {
  const [nombre, setNombre] = useState(`${tarea.nombre} (copia)`)
  const [idDepartamento, setIdDepartamento] = useState(tarea.id_departamento)
  const [copiarAgenda, setCopiarAgenda] = useState(cantidadAsignaciones > 0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)

  async function duplicar(e) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await tareasApi.duplicar(tarea.id, { nombre: nombre.trim(), id_departamento: idDepartamento, copiar_agenda: copiarAgenda })
      setResultado(r)
      onDuplicada?.(r)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo duplicar la tarea')
    } finally {
      setGuardando(false)
    }
  }

  if (resultado) {
    return (
      <div className="panel-inline">
        <p style={{ margin: 0 }}>
          Listo: se creó <strong>{resultado.tarea.nombre}</strong>
          {copiarAgenda
            ? ` con ${resultado.agendadas} de ${resultado.asignaciones} asignaciones agendadas desde hoy.`
            : ' sin agenda (definila desde "Definir agenda").'}
          {resultado.sin_agenda > 0 && ` ${resultado.sin_agenda} quedaron sin agenda (el original no tenía una o era de fecha única ya pasada).`}
        </p>
        {resultado.errores.length > 0 && (
          <ul style={{ color: 'var(--rojo)', fontSize: '0.82rem', margin: '0.4rem 0 0' }}>
            {resultado.errores.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div style={{ marginTop: '0.6rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <form className="panel-inline" onSubmit={duplicar}>
      <strong>Duplicar {tarea.nombre}</strong>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="campo">
          <span>Nombre de la copia</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus style={{ minWidth: 240 }} />
        </label>
        {departamentos.length > 1 && (
          <label className="campo">
            <span>Departamento</span>
            <select value={idDepartamento} onChange={(e) => setIdDepartamento(e.target.value)}>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>
        )}
      </div>
      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={copiarAgenda} onChange={(e) => setCopiarAgenda(e.target.checked)} disabled={!cantidadAsignaciones} />
        {cantidadAsignaciones
          ? `Copiar también la agenda (${cantidadAsignaciones} ${cantidadAsignaciones === 1 ? 'asignación' : 'asignaciones'}: mismos locales, frecuencia y responsable, desde hoy)`
          : 'El original no tiene agenda para copiar'}
      </label>
      {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn" disabled={guardando || !nombre.trim()}>{guardando ? 'Duplicando…' : 'Duplicar'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </form>
  )
}
