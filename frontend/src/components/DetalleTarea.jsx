import { useEffect, useState } from 'react'
import { usePermisos } from '../lib/permisos.js'
import { agendasApi, asignacionesApi, tareasApi, usuariosApi } from '../api/recursos.js'
import EditorFrecuencia from './EditorFrecuencia.jsx'
import { describirAgenda, valorDesdeAgenda, agendaDesdeValor, errorDeValor } from '../lib/agenda-texto.js'

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
//
// Cada accion aparece segun el rol en el grupo del departamento de la tarea
// (lib/permisos.js): marcar y "no aplica" desde MEMBER; cambiar fecha y
// editar desde MANAGER.
export default function DetalleTarea({ tarea, onCerrar, onMarcar, onNoAplica, onReprogramar, onEditado }) {
  const { puede } = usePermisos()
  // null | 'hecha' | 'no_aplica' | 'fecha' | 'editar'
  const [confirmando, setConfirmando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [marcando, setMarcando] = useState(false)
  const [error, setError] = useState('')
  const [edicion, setEdicion] = useState(null)

  useEffect(() => {
    const alTeclear = (e) => e.key === 'Escape' && !marcando && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [marcando, onCerrar])

  if (!tarea) return null
  const abierta = tarea.estado === 'pendiente' || tarea.estado === 'vencida'
  const puedeMarcar = abierta && !!onMarcar && puede('marcar', tarea.idDepartamento)
  const puedeNoAplica = abierta && !!onNoAplica && puede('marcar', tarea.idDepartamento)
  const puedeReprogramar = abierta && !!onReprogramar && puede('editar', tarea.idDepartamento)
  const puedeEditar = !!onEditado && !!tarea.idAsignacion && puede('editar', tarea.idDepartamento)

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

  async function abrirEdicion() {
    setError('')
    setConfirmando('editar')
    setEdicion({ cargando: true })
    try {
      const [{ agenda, asignacion }, usuarios] = await Promise.all([
        asignacionesApi.leerAsignacion(tarea.idAsignacion),
        usuariosApi.listar()
      ])
      setEdicion({
        cargando: false,
        agenda,
        asignacion,
        usuarios: usuarios.filter((u) => (u.departamentos || [u.id_departamento]).includes(asignacion.id_departamento)),
        nombre: asignacion.nombre_tarea,
        responsable: asignacion.asignado_a || '',
        cambiarCuando: false,
        frecuencia: valorDesdeAgenda(agenda)
      })
    } catch (err) {
      setEdicion(null)
      setConfirmando(null)
      setError(err.response?.data?.error || 'No se pudo leer la tarea')
    }
  }

  async function guardarEdicion() {
    const e = edicion
    const nombreNuevo = e.nombre.trim()
    const cambioNombre = nombreNuevo && nombreNuevo !== e.asignacion.nombre_tarea
    const cambioResponsable = (e.responsable || '') !== (e.asignacion.asignado_a || '')
    if (e.cambiarCuando) {
      const errorFrecuencia = errorDeValor(e.frecuencia)
      if (errorFrecuencia) return setError(errorFrecuencia)
    }
    if (!cambioNombre && !cambioResponsable && !e.cambiarCuando) return setError('No cambiaste nada.')
    setError('')
    setMarcando(true)
    try {
      if (cambioNombre) await tareasApi.editar(e.asignacion.id_tarea, { nombre: nombreNuevo })
      if (cambioResponsable || e.cambiarCuando) {
        await agendasApi.cambiarAgenda({
          ids: [e.asignacion.id],
          ...(e.cambiarCuando ? { agenda: agendaDesdeValor(e.frecuencia) } : {}),
          ...(cambioResponsable ? { asignado_a: e.responsable || null } : {})
        })
      }
      await onEditado?.()
      onCerrar()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar. Probá de nuevo.')
      setMarcando(false)
    }
  }

  const setEd = (campo, valor) => setEdicion((prev) => ({ ...prev, [campo]: valor }))
  const hayAcciones = puedeMarcar || puedeNoAplica || puedeReprogramar || puedeEditar

  return (
    <div className="detalle-fondo" onClick={() => !marcando && onCerrar()}>
      <div className="card detalle-tarea" role="dialog" aria-modal="true" aria-label={`Detalle: ${tarea.titulo}`} onClick={(e) => e.stopPropagation()}>
        <div className="detalle-encabezado">
          <h3 style={{ margin: 0 }}>{tarea.titulo}</h3>
          <button className="btn btn-secondary" onClick={onCerrar} disabled={marcando} aria-label="Cerrar">✕</button>
        </div>
        <p className="detalle-sub">
          {tarea.departamento && <>{tarea.departamento} · </>}{tarea.local} · {fechaLarga(tarea.fechaISO)}
        </p>

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

        {tarea.historial?.length > 0 && confirmando !== 'editar' && (
          <div>
            <div className="detalle-etiqueta">Historial</div>
            <ul className="detalle-historial">
              {tarea.historial.slice(-8).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}

        {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}

        {!confirmando && hayAcciones && (
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
            {puedeEditar && <button className="btn btn-secondary detalle-accion" onClick={abrirEdicion}>Editar</button>}
          </div>
        )}
        {!confirmando && !hayAcciones && abierta && (
          <p className="tenue" style={{ margin: 0 }}>Solo lectura: tu rol en este grupo no permite cambiar esta tarea.</p>
        )}

        {confirmando === 'editar' && edicion && (
          <div className="detalle-confirmar">
            {edicion.cargando ? (
              <p className="tenue" style={{ margin: 0 }}>Cargando…</p>
            ) : !puede('editar', edicion.asignacion.id_departamento) ? (
              <p style={{ margin: 0 }}>Esta tarea es de otro departamento: la edita un MANAGER u OWNER de ese grupo.</p>
            ) : (
              <>
                <label className="campo">
                  <span>Nombre de la tarea (cambia en todos sus locales)</span>
                  <input value={edicion.nombre} onChange={(e) => setEd('nombre', e.target.value)} />
                </label>
                <label className="campo">
                  <span>Responsable en este local</span>
                  <select value={edicion.responsable} onChange={(e) => setEd('responsable', e.target.value)}>
                    <option value="">Equipo (sin responsable fijo)</option>
                    {edicion.usuarios.map((u) => <option key={u.id} value={u.email}>{u.nombre || u.email}</option>)}
                    {edicion.responsable && !edicion.usuarios.some((u) => u.email === edicion.responsable) && (
                      <option value={edicion.responsable}>{edicion.responsable}</option>
                    )}
                  </select>
                </label>
                <div className="campo">
                  <span>Cuándo, en este local: {edicion.agenda ? describirAgenda(edicion.agenda) : 'sin agenda'}</span>
                  <label className="en-linea">
                    <input type="checkbox" checked={edicion.cambiarCuando} onChange={(e) => setEd('cambiarCuando', e.target.checked)} />
                    Cambiar la frecuencia (rige desde la fecha elegida, nunca antes de hoy)
                  </label>
                  {edicion.cambiarCuando && <EditorFrecuencia valor={edicion.frecuencia} onChange={(v) => setEd('frecuencia', v)} />}
                </div>
                <p className="tenue" style={{ margin: 0 }}>Para cambiar varios locales juntos, usá la pantalla Agendas.</p>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {!edicion.cargando && puede('editar', edicion.asignacion?.id_departamento) && (
                <button className="btn detalle-accion" onClick={guardarEdicion} disabled={marcando}>{marcando ? 'Guardando…' : 'Guardar'}</button>
              )}
              <button className="btn btn-secondary detalle-accion" onClick={() => { setConfirmando(null); setEdicion(null); setError('') }} disabled={marcando}>Volver</button>
            </div>
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
