import { useEffect, useState } from 'react'

function fechaLarga(iso) {
  if (!iso) return ''
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function textoEstado(t) {
  if (t.estado === 'realizada') return `Hecha${t.realizadaPor ? ` por ${t.realizadaPor}` : ''}`
  if (t.estado === 'vencida') return `Atrasada, hace ${t.diasVencida} ${t.diasVencida === 1 ? 'día' : 'días'}`
  return 'Pendiente'
}

// Detalle de una tarea. Marcar hecha es definitivo (decision del usuario), asi
// que pasa por un paso de confirmacion explicito: antes un toque sobre la tarea
// -- incluso en Semana/Mes, donde uno toca para "ver" -- la cerraba en el acto.
export default function DetalleTarea({ tarea, onCerrar, onMarcar }) {
  const [confirmando, setConfirmando] = useState(false)
  const [marcando, setMarcando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const alTeclear = (e) => e.key === 'Escape' && !marcando && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [marcando, onCerrar])

  if (!tarea) return null
  const puedeMarcar = tarea.estado !== 'realizada' && !!onMarcar

  async function confirmar() {
    setError('')
    setMarcando(true)
    try {
      await onMarcar(tarea.id, tarea.idDepartamento)
      onCerrar()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo marcar. Probá de nuevo.')
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

        {puedeMarcar && !confirmando && (
          <button className="btn detalle-accion" onClick={() => setConfirmando(true)}>Marcar hecha</button>
        )}
        {puedeMarcar && confirmando && (
          <div className="detalle-confirmar">
            <p style={{ margin: 0 }}>¿Confirmás que <strong>{tarea.titulo}</strong> ({tarea.local}) está hecha? Queda registrada a tu nombre y no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn detalle-accion" onClick={confirmar} disabled={marcando}>{marcando ? 'Marcando…' : 'Sí, marcar hecha'}</button>
              <button className="btn btn-secondary detalle-accion" onClick={() => setConfirmando(false)} disabled={marcando}>Volver</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
