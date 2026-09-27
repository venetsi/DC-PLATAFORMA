import { useEffect, useState } from 'react'

function fechaLarga(iso) {
  if (!iso) return ''
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function textoEstado(t) {
  if (t.estado === 'no_aplica') return `No aplica${t.noAplicaMotivo ? `: ${t.noAplicaMotivo}` : ''}${t.noAplicaPor ? ` (${t.noAplicaPor})` : ''}`
  if (t.estado === 'realizada') return `Hecha${t.realizadaPor ? ` por ${t.realizadaPor}` : ''}`
  if (t.estado === 'vencida') return `Atrasada, hace ${t.diasVencida} ${t.diasVencida === 1 ? 'día' : 'días'}`
  return 'Pendiente'
}

// Detalle de una tarea. Marcar hecha es definitivo (decision del usuario), asi
// que pasa por un paso de confirmacion explicito: antes un toque sobre la tarea
// -- incluso en Semana/Mes, donde uno toca para "ver" -- la cerraba en el acto.
export default function DetalleTarea({ tarea, onCerrar, onMarcar, onNoAplica, onReprogramar }) {
  // null | 'hecha' | 'no_aplica' | 'fecha'
  const [confirmando, setConfirmando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [marcando, setMarcando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const alTeclear = (e) => e.key === 'Escape' && !marcando && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [marcando, onCerrar])

  if (!tarea) return null
  const abierta = tarea.estado === 'pendiente' || tarea.estado === 'vencida'
  const puedeMarcar = abierta && !!onMarcar
  const puedeNoAplica = abierta && !!onNoAplica
  const puedeReprogramar = abierta && !!onReprogramar

  async function confirmar() {
    setError('')
    setMarcando(true)
    try {
      if (confirmando === 'no_aplica') await onNoAplica(tarea.id, tarea.idDepartamento, motivo.trim())
      else if (confirmando === 'fecha') await onReprogramar(tarea.id, tarea.idDepartamento, nuevaFecha, motivo.trim())
      else await onMarcar(tarea.id, tarea.idDepartamento)
      onCerrar()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar. Probá de nuevo.')
      setMarcando(false)
    }
  }

  return (
    <div className="detalle-fondo" onClick={() => !marcando && onCerrar()}>
      <div className="card detalle-tarea" role="dialog" aria-modal="true" aria-label={`Detalle: ${tarea.titulo}`} onClick={(e) => e.stopPropagation()}>
        <div className="detalle-encabezado">
          <h3 style={{ margin: 0 }}>{tarea.titulo}</h3>
          <button className="btn btn-secondary" onClick={onCerrar} disabled={marcando} aria-label="Cerrar">✕</button>
        </div>
        <p className="detalle-sub">{tarea.local} · {fechaLarga(tarea.fechaISO)}</p>

        <dl className="detalle-datos">
          <dt>Estado</dt>
          <dd className={`estado-${tarea.estado}`}>{textoEstado(tarea)}</dd>
          <dt>Responsable</dt>
          <dd>{tarea.asignadoA || 'Equipo (sin responsable fijo)'}</dd>
          {tarea.esperaA?.length > 0 && (
            <>
              <dt>Espera a</dt>
              <dd>{tarea.esperaA.map((p) => `${p.nombre_tarea} — ${p.departamento}`).join('; ')}</dd>
            </>
          )}
        </dl>

        {tarea.historial?.length > 0 && (
          <div>
            <div className="detalle-etiqueta">Historial</div>
            <ul className="detalle-historial">
              {tarea.historial.slice(-8).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}

        {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}

        {!confirmando && (puedeMarcar || puedeNoAplica || puedeReprogramar) && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {puedeMarcar && <button className="btn detalle-accion" onClick={() => setConfirmando('hecha')}>Marcar hecha</button>}
            {puedeReprogramar && (
              <button
                className="btn btn-secondary detalle-accion"
                onClick={() => { setMotivo(''); setNuevaFecha(tarea.fechaISO); setConfirmando('fecha') }}
              >
                Cambiar fecha
              </button>
            )}
            {puedeNoAplica && <button className="btn btn-secondary detalle-accion" onClick={() => setConfirmando('no_aplica')}>No aplica</button>}
          </div>
        )}
        {confirmando === 'fecha' && (
          <div className="detalle-confirmar">
            <label htmlFor="nueva-fecha" style={{ margin: 0 }}>
              Nueva fecha para esta tarea puntual. No cambia el resto de la agenda ni a los demás locales.
            </label>
            <input
              id="nueva-fecha"
              type="date"
              className="detalle-fecha"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn detalle-accion"
                onClick={confirmar}
                disabled={marcando || !nuevaFecha || nuevaFecha === tarea.fechaISO}
              >
                {marcando ? 'Guardando…' : 'Confirmar nueva fecha'}
              </button>
              <button className="btn btn-secondary detalle-accion" onClick={() => setConfirmando(null)} disabled={marcando}>Volver</button>
            </div>
          </div>
        )}
        {confirmando === 'no_aplica' && (
          <div className="detalle-confirmar">
            <label htmlFor="motivo-no-aplica" style={{ margin: 0 }}>¿Por qué no aplica esta vez? (local cerrado, feriado, sin movimiento…) No cuenta como hecha ni como atrasada, y no se puede deshacer.</label>
            <textarea id="motivo-no-aplica" className="detalle-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} autoFocus />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn detalle-accion" onClick={confirmar} disabled={marcando || !motivo.trim()}>{marcando ? 'Guardando…' : 'Confirmar: no aplica'}</button>
              <button className="btn btn-secondary detalle-accion" onClick={() => setConfirmando(null)} disabled={marcando}>Volver</button>
            </div>
          </div>
        )}
        {confirmando === 'hecha' && (
          <div className="detalle-confirmar">
            <p style={{ margin: 0 }}>¿Confirmás que <strong>{tarea.titulo}</strong> ({tarea.local}) está hecha? Queda registrada a tu nombre y no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn detalle-accion" onClick={confirmar} disabled={marcando}>{marcando ? 'Marcando…' : 'Sí, marcar hecha'}</button>
              <button className="btn btn-secondary detalle-accion" onClick={() => setConfirmando(null)} disabled={marcando}>Volver</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
