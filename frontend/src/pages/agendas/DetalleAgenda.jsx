import { useState } from 'react'
import { agendasApi } from '../../api/recursos.js'
import EditorFrecuencia from '../../components/EditorFrecuencia.jsx'
import SelectorAlcance, { ALCANCE_VACIO, alcanceCompleto } from './SelectorAlcance.jsx'
import AgendaDeTarea from '../admin/AgendaDeTarea.jsx'
import { describirAgenda, fechaHumana, valorDesdeAgenda, agendaDesdeValor, errorDeValor } from '../../lib/agenda-texto.js'
import { cuandoTexto } from './resumen.js'

// Lo que se abre debajo de una tarea: sus locales con checkbox y las acciones
// en lote (cambiar cuando, cambiar responsable, quitar), sumar locales, y el
// panel avanzado de siempre (compartir, dependencias, agenda por local).
// `soloLectura`: quien es MEMBER del grupo ve los locales y su estado, sin
// checkbox ni acciones (crear y editar pide MANAGER u OWNER).
export default function DetalleAgenda({ tarea, locales, grupos, departamentos, usuarios, nombrePorEmail, onCambio, avisar, soloLectura = false }) {
  const [seleccion, setSeleccion] = useState(() => new Set())
  // null | 'cuando' | 'responsable' | 'quitar' | 'agregar' | 'avanzado'
  const [accion, setAccion] = useState(null)
  const [frecuencia, setFrecuencia] = useState(null)
  const [responsable, setResponsable] = useState('')
  const [alcance, setAlcance] = useState(ALCANCE_VACIO)
  const [igualQueElResto, setIgualQueElResto] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const asignaciones = [...tarea.asignaciones].sort((a, b) => (a.local || '').localeCompare(b.local || ''))
  const elegidas = asignaciones.filter((a) => seleccion.has(a.id))
  const todas = elegidas.length === asignaciones.length && asignaciones.length > 0
  const uniforme = cuandoTexto(asignaciones).uniforme
  const agendaComun = uniforme ? asignaciones[0].agenda : null

  function alternar(id) {
    setSeleccion((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }
  function abrir(nueva) {
    setError('')
    setAccion(accion === nueva ? null : nueva)
    if (nueva === 'cuando') setFrecuencia(valorDesdeAgenda(elegidas.find((a) => a.agenda)?.agenda))
    if (nueva === 'responsable') setResponsable(elegidas.length && elegidas.every((a) => a.asignado_a === elegidas[0].asignado_a) ? elegidas[0].asignado_a || '' : '')
    if (nueva === 'agregar') { setAlcance(ALCANCE_VACIO); setIgualQueElResto(!!agendaComun); setFrecuencia(valorDesdeAgenda(agendaComun)) }
  }

  async function ejecutar(fn, mensajeOk) {
    setGuardando(true)
    setError('')
    try {
      const r = await fn()
      const errores = r?.errores || []
      avisar(errores.length ? `${mensajeOk(r)} Con errores: ${errores.join('; ')}` : mensajeOk(r), errores.length ? 'mal' : 'ok')
      setAccion(null)
      setSeleccion(new Set())
      await onCambio()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const ids = elegidas.map((a) => a.id)
  const n = `${ids.length} ${ids.length === 1 ? 'local' : 'locales'}`

  return (
    <div className="detalle-agenda">
      <table className="tabla-locales">
        <thead>
          <tr>
            {!soloLectura && (
              <th style={{ width: '2rem' }}>
                <input type="checkbox" checked={todas} onChange={() => setSeleccion(todas ? new Set() : new Set(asignaciones.map((a) => a.id)))} aria-label="Elegir todos" />
              </th>
            )}
            <th>Local</th><th>Cuándo</th><th>Responsable</th><th>Próxima</th><th>Estado</th>
            {!soloLectura && <th aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody>
          {asignaciones.map((a) => (
            <tr key={a.id} className={seleccion.has(a.id) ? 'elegida' : soloLectura ? 'solo-lectura' : undefined} onClick={() => !soloLectura && alternar(a.id)}>
              {!soloLectura && <td><input type="checkbox" checked={seleccion.has(a.id)} onChange={() => alternar(a.id)} onClick={(e) => e.stopPropagation()} aria-label={`Elegir ${a.local || 'toda la empresa'}`} /></td>}
              <td>{a.local || 'Toda la empresa'}{a.grupo && <span className="tenue"> · {a.grupo}</span>}
                {a.compartidas.length > 0 && <div className="tenue">compartida con {a.compartidas.map((c) => c.nombre).join(', ')}</div>}
              </td>
              <td>{a.agenda ? describirAgenda(a.agenda) : <span className="tono-medio">Sin agenda</span>}</td>
              <td>{a.asignado_a ? nombrePorEmail(a.asignado_a) : <span className="tenue">Equipo</span>}</td>
              <td>{a.proxima ? fechaHumana(a.proxima) : <span className="tenue">—</span>}</td>
              <td>{a.atrasadas ? <span className="pill-mal">{a.atrasadas} atrasada{a.atrasadas > 1 ? 's' : ''}</span> : a.agenda ? <span className="pill-ok">Al día</span> : null}</td>
              {/* Desactivar UN local sin tocar el resto de la tarea: antes solo
                  estaba "Quitar" en lote, y el "Desactivar" de la fila de la tarea
                  (que la apaga en TODOS sus locales) se usaba por error. */}
              {!soloLectura && (
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary btn-chico"
                    disabled={guardando}
                    title={`Desactivar ${tarea.nombre} solo en ${a.local || 'toda la empresa'}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!window.confirm(`¿Desactivar "${tarea.nombre}" en ${a.local || 'toda la empresa'}? Deja de agendarse ahí desde hoy; el resto de los locales sigue igual.`)) return
                      ejecutar(() => agendasApi.quitar([a.id]), () => `"${tarea.nombre}" desactivada en ${a.local || 'toda la empresa'}.`)
                    }}
                  >
                    Desactivar
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!asignaciones.length && <tr><td colSpan={7} className="tenue">Todavía no se agendó en ningún local.</td></tr>}
        </tbody>
      </table>

      {soloLectura ? (
        <p className="tenue" style={{ margin: 0 }}>Solo lectura: crear y editar tareas de este departamento lo hace un MANAGER u OWNER de su grupo.</p>
      ) : (
      <div className="barra-lote">
        {ids.length > 0 ? (
          <>
            <span className="tenue">{n}:</span>
            <button className={accion === 'cuando' ? 'btn' : 'btn btn-secondary'} onClick={() => abrir('cuando')}>Cambiar cuándo</button>
            <button className={accion === 'responsable' ? 'btn' : 'btn btn-secondary'} onClick={() => abrir('responsable')}>Cambiar responsable</button>
            <button className={accion === 'quitar' ? 'btn' : 'btn btn-secondary'} onClick={() => abrir('quitar')}>Desactivar en estos locales</button>
          </>
        ) : (
          <span className="tenue">Elegí locales para cambiarlos juntos.</span>
        )}
        <span style={{ flex: 1 }} />
        <button className={accion === 'agregar' ? 'btn' : 'btn btn-secondary'} onClick={() => abrir('agregar')}>+ Agregar locales</button>
        <button className={accion === 'avanzado' ? 'btn' : 'btn btn-secondary'} onClick={() => abrir('avanzado')}>Opciones avanzadas</button>
      </div>
      )}

      {accion === 'cuando' && frecuencia && (
        <div className="panel-accion">
          <EditorFrecuencia valor={frecuencia} onChange={setFrecuencia} />
          <p className="tenue">Rige desde la fecha elegida (nunca antes de hoy). Lo ya marcado queda como estaba.</p>
          {error && <p className="error-texto">{error}</p>}
          <div className="acciones">
            <button className="btn" disabled={guardando} onClick={() => {
              const e = errorDeValor(frecuencia)
              if (e) return setError(e)
              ejecutar(() => agendasApi.cambiarAgenda({ ids, agenda: agendaDesdeValor(frecuencia) }), (r) => `Agenda actualizada en ${r.actualizadas} ${r.actualizadas === 1 ? 'local' : 'locales'}.`)
            }}>{guardando ? 'Guardando…' : `Aplicar a ${n}`}</button>
            <button className="btn btn-secondary" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</button>
          </div>
        </div>
      )}

      {accion === 'responsable' && (
        <div className="panel-accion">
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label="Responsable">
            <option value="">Equipo (sin responsable fijo)</option>
            {usuarios.map((u) => <option key={u.id} value={u.email}>{u.nombre || u.email}</option>)}
          </select>
          {error && <p className="error-texto">{error}</p>}
          <div className="acciones">
            <button className="btn" disabled={guardando} onClick={() => ejecutar(
              () => agendasApi.cambiarAgenda({ ids, asignado_a: responsable || null }),
              (r) => `Responsable actualizado en ${r.actualizadas + r.sin_agenda} ${r.actualizadas + r.sin_agenda === 1 ? 'local' : 'locales'}.`
            )}>{guardando ? 'Guardando…' : `Aplicar a ${n}`}</button>
            <button className="btn btn-secondary" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</button>
          </div>
        </div>
      )}

      {accion === 'quitar' && (
        <div className="panel-accion panel-peligro">
          <p style={{ margin: 0 }}>¿Desactivar <strong>{tarea.nombre}</strong> en {n}? Dejan de agendarse desde hoy; lo ya marcado queda en el historial. {todas ? 'Elegiste todos: la tarea queda sin locales, pero no se desactiva.' : 'El resto de los locales sigue igual.'}</p>
          {error && <p className="error-texto">{error}</p>}
          <div className="acciones">
            <button className="btn btn-peligro" disabled={guardando} onClick={() => ejecutar(() => agendasApi.quitar(ids), (r) => `Desactivada en ${r.quitadas} ${r.quitadas === 1 ? 'local' : 'locales'}.`)}>
              {guardando ? 'Desactivando…' : `Sí, desactivar en ${n}`}
            </button>
            <button className="btn btn-secondary" onClick={() => setAccion(null)} disabled={guardando}>Volver</button>
          </div>
        </div>
      )}

      {accion === 'agregar' && (
        <div className="panel-accion">
          <SelectorAlcance valor={alcance} onChange={setAlcance} locales={locales} grupos={grupos} excluir={asignaciones.map((a) => a.id_local_ext).filter(Boolean)} />
          {agendaComun && (
            <label className="en-linea">
              <input type="checkbox" checked={igualQueElResto} onChange={(e) => setIgualQueElResto(e.target.checked)} />
              Misma agenda que el resto ({describirAgenda(agendaComun).toLowerCase()})
            </label>
          )}
          {(!agendaComun || !igualQueElResto) && frecuencia && <EditorFrecuencia valor={frecuencia} onChange={setFrecuencia} />}
          {error && <p className="error-texto">{error}</p>}
          <div className="acciones">
            <button className="btn" disabled={guardando} onClick={() => {
              if (!alcanceCompleto(alcance)) return setError('Elegí el grupo o los locales')
              const regla = agendaComun && igualQueElResto
                ? { ...agendaComun, vigencia_desde: agendaDesdeValor(frecuencia).vigencia_desde }
                : agendaDesdeValor(frecuencia)
              const e = !(agendaComun && igualQueElResto) && errorDeValor(frecuencia)
              if (e) return setError(e)
              const comun = asignaciones.length && asignaciones.every((a) => a.asignado_a === asignaciones[0].asignado_a) ? asignaciones[0].asignado_a : null
              ejecutar(
                () => agendasApi.agregarAlcance(tarea.id, { alcance, agenda: regla, asignado_a: comun }),
                (r) => `${r.asignaciones} ${r.asignaciones === 1 ? 'local agregado' : 'locales agregados'}${r.ya_existian ? ` (${r.ya_existian} ya estaban)` : ''}.`
              )
            }}>{guardando ? 'Agregando…' : 'Agregar'}</button>
            <button className="btn btn-secondary" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</button>
          </div>
        </div>
      )}

      {accion === 'avanzado' && (
        <AgendaDeTarea
          tarea={tarea}
          locales={locales}
          grupos={grupos}
          departamentos={departamentos}
          usuarios={usuarios}
          onCerrar={() => setAccion(null)}
          onCambio={onCambio}
        />
      )}
    </div>
  )
}
