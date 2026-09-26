import { Fragment, useEffect, useMemo, useState } from 'react'
import { departamentosApi, tareasApi, localesApi, asignacionesApi, usuariosApi } from '../../api/recursos.js'
import { useAuthStore } from '../../store/authStore.js'
import AgendaDeTarea from './AgendaDeTarea.jsx'

export default function AdminTareas() {
  const esAdminGlobal = useAuthStore((s) => s.esAdminGlobal)
  const departamentoPropio = useAuthStore((s) => s.departamento)

  const [departamentos, setDepartamentos] = useState([])
  const [tareas, setTareas] = useState([])
  const [locales, setLocales] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [nombre, setNombre] = useState('')
  // Un usuario de departamento crea solo para el suyo -- ni siquiera se le
  // ofrece elegir otro (el backend lo rechazaria igual, ver tareas.js).
  const [idDepartamento, setIdDepartamento] = useState(esAdminGlobal ? '' : departamentoPropio?.id || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const [editandoId, setEditandoId] = useState(null)
  const [edicion, setEdicion] = useState({ nombre: '', descripcion: '' })

  // Agenda de una sola tarea a la vez, abierta inline en su propio renglon
  // -- ver AgendaDeTarea.jsx. Reemplaza la vieja pantalla separada /admin/agenda.
  const [agendaAbiertaId, setAgendaAbiertaId] = useState(null)

  const [nombreDepartamentoNuevo, setNombreDepartamentoNuevo] = useState('')
  const [creandoDepartamento, setCreandoDepartamento] = useState(false)
  const [errorDepartamento, setErrorDepartamento] = useState('')

  // Webhook de Chat y umbrales de escalamiento por departamento -- hasta
  // ahora solo se podian cargar por PATCH /departamentos/:id/notificaciones
  // a mano (ver docs/MANUAL-ADMINISTRADOR.md). El webhook es write-only: el
  // backend nunca devuelve el valor crudo (solo "tiene_webhook"), asi que el
  // input arranca vacio y "dejarlo en blanco" significa "no tocarlo".
  const [avisos, setAvisos] = useState({})
  const [guardandoAviso, setGuardandoAviso] = useState(null)
  const [errorAviso, setErrorAviso] = useState('')

  // Solo admin puede pedir las desactivadas -- son las candidatas a
  // "Eliminar definitivamente" (ver DELETE /tareas/:id).
  const [mostrarInactivas, setMostrarInactivas] = useState(false)

  async function cargarTareas(incluirInactivas = mostrarInactivas) {
    setTareas(await tareasApi.listar(undefined, incluirInactivas))
  }
  async function cargarDepartamentos() {
    setDepartamentos(await departamentosApi.listar())
  }
  // Todas las asignaciones (no filtradas por tarea) -- solo para derivar a
  // que grupo(s) esta asignada cada una en el renglon del catalogo, ver
  // gruposPorTarea. Se refresca tambien cuando AgendaDeTarea crea/cierra
  // asignaciones (ver onCambio en el panel inline).
  async function cargarAsignaciones() {
    setAsignaciones(await asignacionesApi.listar())
  }

  useEffect(() => {
    cargarDepartamentos()
    cargarTareas()
    cargarAsignaciones()
    localesApi.listar().then(setLocales)
    usuariosApi.listar().then(setUsuarios)
  }, [])

  // Precarga los umbrales ya guardados; el webhook queda siempre vacio (es
  // write-only, ver arriba). No pisa lo que ya este editando el admin.
  useEffect(() => {
    setAvisos((prev) => {
      const siguiente = { ...prev }
      for (const d of departamentos) {
        if (d.id in siguiente) continue
        siguiente[d.id] = {
          webhook: '',
          diasDepartamento: d.dias_aviso_departamento ?? '',
          diasDireccion: d.dias_aviso_direccion ?? ''
        }
      }
      return siguiente
    })
  }, [departamentos])

  function toggleMostrarInactivas() {
    const nuevo = !mostrarInactivas
    setMostrarInactivas(nuevo)
    cargarTareas(nuevo)
  }

  // Grupos reales (ExtLocal.grupo, cacheado de dcsmart) -- no hay tabla de
  // grupos propia, se derivan de los locales que ya llegaron.
  const grupos = useMemo(
    () => [...new Set(locales.map((l) => l.grupo).filter(Boolean))].sort(),
    [locales]
  )

  function puedeGestionar(idDepartamentoTarea) {
    return esAdminGlobal || departamentoPropio?.id === idDepartamentoTarea
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      await tareasApi.crear({ nombre, id_departamento: idDepartamento })
      setNombre('')
      await cargarTareas()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la tarea')
    } finally {
      setGuardando(false)
    }
  }

  function empezarEdicion(t) {
    setEditandoId(t.id)
    setEdicion({ nombre: t.nombre, descripcion: t.descripcion || '' })
  }

  async function guardarEdicion(id) {
    await tareasApi.editar(id, edicion)
    setEditandoId(null)
    await cargarTareas()
  }

  async function desactivar(id) {
    if (!confirm('¿Desactivar esta tarea? Deja de aparecer en el catálogo y se cierra la agenda de todos sus locales (sin borrar el historial).')) return
    await tareasApi.editar(id, { activa: false })
    await cargarTareas()
  }

  async function eliminarDefinitivo(id, nombreTarea) {
    const confirmacion = prompt(
      `Esto borra "${nombreTarea}" Y sus eventos de Google Calendar de forma DEFINITIVA -- se pierde el historial, no se puede deshacer.\n\nEscribí ELIMINAR para confirmar:`
    )
    if (confirmacion !== 'ELIMINAR') return
    await tareasApi.eliminar(id)
    await cargarTareas()
  }

  async function crearDepartamento(e) {
    e.preventDefault()
    setErrorDepartamento('')
    setCreandoDepartamento(true)
    try {
      await departamentosApi.crear(nombreDepartamentoNuevo)
      setNombreDepartamentoNuevo('')
      await cargarDepartamentos()
    } catch (err) {
      setErrorDepartamento(err.response?.data?.error || 'No se pudo crear el departamento')
    } finally {
      setCreandoDepartamento(false)
    }
  }

  function actualizarAviso(id, campo, valor) {
    setAvisos((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }))
  }

  async function guardarAviso(id) {
    setErrorAviso('')
    setGuardandoAviso(id)
    const edicion = avisos[id] || { webhook: '', diasDepartamento: '', diasDireccion: '' }
    const body = {
      dias_aviso_departamento: edicion.diasDepartamento === '' ? null : Number(edicion.diasDepartamento),
      dias_aviso_direccion: edicion.diasDireccion === '' ? null : Number(edicion.diasDireccion)
    }
    // El webhook solo se manda si escribieron algo -- en blanco significa
    // "no lo toques", no "borralo" (para eso está el botón Quitar webhook).
    if (edicion.webhook.trim()) body.chat_webhook_url = edicion.webhook.trim()
    try {
      await departamentosApi.notificaciones(id, body)
      setAvisos((prev) => ({ ...prev, [id]: { ...prev[id], webhook: '' } }))
      await cargarDepartamentos()
    } catch (err) {
      setErrorAviso(err.response?.data?.error || 'No se pudo guardar')
    } finally {
      setGuardandoAviso(null)
    }
  }

  async function quitarWebhook(id) {
    if (!confirm('¿Quitar el webhook de Chat de este departamento? (si tiene un Space vinculado por /vincular, ese sigue funcionando igual)')) return
    setErrorAviso('')
    setGuardandoAviso(id)
    try {
      await departamentosApi.notificaciones(id, { chat_webhook_url: null })
      await cargarDepartamentos()
    } catch (err) {
      setErrorAviso(err.response?.data?.error || 'No se pudo quitar el webhook')
    } finally {
      setGuardandoAviso(null)
    }
  }

  const nombreDepto = (id) => departamentos.find((d) => d.id === id)?.nombre || id

  // A que grupo(s) esta asignada cada tarea, para mostrarlo de un vistazo en
  // el catalogo sin tener que abrir "Definir agenda" -- sobre todo util
  // despues de asignar "por grupo", donde no era obvio a simple vista si
  // ya estaba cubierta o no. "Toda la empresa" cuando la asignacion no
  // tiene local (alcance empresa); se omiten los locales sin grupo cargado.
  const gruposPorTarea = useMemo(() => {
    const mapa = new Map()
    for (const a of asignaciones) {
      const etiqueta = a.id_local_ext ? a.local?.grupo : 'Toda la empresa'
      if (!etiqueta) continue
      if (!mapa.has(a.id_tarea)) mapa.set(a.id_tarea, new Set())
      mapa.get(a.id_tarea).add(etiqueta)
    }
    return mapa
  }, [asignaciones])

  // Agrupado y ordenado por departamento -- antes quedaban todas mezcladas
  // en el orden que las devolvia el backend (solo por nombre de tarea), asi
  // que encontrar las de un departamento puntual era desplazarse a ojo.
  const gruposPorDepto = useMemo(() => {
    const grupos = new Map()
    for (const t of tareas) {
      const clave = t.id_departamento
      if (!grupos.has(clave)) grupos.set(clave, [])
      grupos.get(clave).push(t)
    }
    return [...grupos.entries()]
      .map(([idDepto, lista]) => ({ idDepto, nombre: nombreDepto(idDepto), lista }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [tareas, departamentos])

  function renderFila(t) {
    return (
      <Fragment key={t.id}>
        <tr style={t.activa ? undefined : { opacity: 0.55 }}>
          {editandoId === t.id ? (
            <>
              <td>
                <input
                  value={edicion.nombre}
                  onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                  style={{ padding: '0.3rem' }}
                />
              </td>
              <td style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="btn" onClick={() => guardarEdicion(t.id)}>Guardar</button>
                <button className="btn btn-secondary" onClick={() => setEditandoId(null)}>Cancelar</button>
              </td>
            </>
          ) : !t.activa ? (
            <>
              <td>{t.nombre} <span style={{ fontSize: '0.75rem' }}>(desactivada)</span></td>
              <td>
                {esAdminGlobal && (
                  <button className="btn btn-secondary" onClick={() => eliminarDefinitivo(t.id, t.nombre)}>
                    Eliminar definitivamente
                  </button>
                )}
              </td>
            </>
          ) : (
            <>
              <td>
                {t.nombre}
                {gruposPorTarea.get(t.id)?.size > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)', marginTop: '0.15rem' }}>
                    {[...gruposPorTarea.get(t.id)].sort().join(', ')}
                  </div>
                )}
              </td>
              <td style={{ display: 'flex', gap: '0.4rem' }}>
                {puedeGestionar(t.id_departamento) && (
                  <button className="btn btn-secondary" onClick={() => empezarEdicion(t)}>Editar</button>
                )}
                {puedeGestionar(t.id_departamento) && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAgendaAbiertaId(agendaAbiertaId === t.id ? null : t.id)}
                  >
                    {agendaAbiertaId === t.id ? 'Cerrar agenda' : 'Definir agenda'}
                  </button>
                )}
                {esAdminGlobal && (
                  <button className="btn btn-secondary" onClick={() => desactivar(t.id)}>Desactivar</button>
                )}
              </td>
            </>
          )}
        </tr>
        {agendaAbiertaId === t.id && (
          <tr>
            <td colSpan={2} style={{ background: 'var(--bg-1, rgba(255,255,255,0.02))', borderTop: 'none' }}>
              <AgendaDeTarea
                tarea={t}
                locales={locales}
                grupos={grupos}
                departamentos={departamentos}
                usuarios={usuarios.filter((u) => u.id_departamento === t.id_departamento)}
                onCerrar={() => setAgendaAbiertaId(null)}
                onCambio={cargarAsignaciones}
              />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div>
      {esAdminGlobal && (
        <div className="card" style={{ maxWidth: 420, marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Crear departamento</h3>
          <form onSubmit={crearDepartamento} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              placeholder="Nombre (ej. Marketing)"
              value={nombreDepartamentoNuevo}
              onChange={(e) => setNombreDepartamentoNuevo(e.target.value)}
              required
              style={{ flex: 1, padding: '0.4rem' }}
            />
            <button className="btn" disabled={creandoDepartamento}>Crear</button>
          </form>
          {errorDepartamento && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{errorDepartamento}</p>}
        </div>
      )}

      {esAdminGlobal && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Avisos por departamento</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
            Webhook de Chat y umbrales de escalamiento (días hábiles). Si el departamento ya tiene un Space
            vinculado con <code>/vincular</code>, ese gana y el webhook queda solo como respaldo.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Departamento</th><th>Webhook de Chat</th><th>Días → depto</th><th>Días → Dirección</th><th></th></tr>
              </thead>
              <tbody>
                {departamentos.map((d) => {
                  const edicion = avisos[d.id] || { webhook: '', diasDepartamento: '', diasDireccion: '' }
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.nombre}
                        {d.chat_space_name && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)' }}>vinculado por Space</div>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder={d.tiene_webhook ? 'Configurado — dejar en blanco para no tocarlo' : 'Sin configurar'}
                          value={edicion.webhook}
                          onChange={(e) => actualizarAviso(d.id, 'webhook', e.target.value)}
                          style={{ width: '100%', minWidth: 220, padding: '0.3rem' }}
                        />
                        {d.tiene_webhook && (
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.72rem', marginTop: '0.25rem', padding: '0.2rem 0.5rem' }}
                            disabled={guardandoAviso === d.id}
                            onClick={() => quitarWebhook(d.id)}
                          >
                            Quitar webhook
                          </button>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="365"
                          placeholder="default"
                          value={edicion.diasDepartamento}
                          onChange={(e) => actualizarAviso(d.id, 'diasDepartamento', e.target.value)}
                          style={{ width: '5rem', padding: '0.3rem' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="365"
                          placeholder="default"
                          value={edicion.diasDireccion}
                          onChange={(e) => actualizarAviso(d.id, 'diasDireccion', e.target.value)}
                          style={{ width: '5rem', padding: '0.3rem' }}
                        />
                      </td>
                      <td>
                        <button className="btn" disabled={guardandoAviso === d.id} onClick={() => guardarAviso(d.id)}>
                          Guardar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {errorAviso && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{errorAviso}</p>}
        </div>
      )}

      <h2>Catálogo de tareas</h2>
      {esAdminGlobal && (
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--texto-tenue)', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={mostrarInactivas} onChange={toggleMostrarInactivas} />
          Mostrar desactivadas (para eliminarlas definitivamente)
        </label>
      )}
      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: '0.75rem', maxWidth: 520, marginBottom: '1.5rem' }}>
        <input placeholder="Nombre (ej. CMV)" value={nombre} onChange={(e) => setNombre(e.target.value)} required style={{ flex: 1, padding: '0.4rem' }} />
        {esAdminGlobal ? (
          <select value={idDepartamento} onChange={(e) => setIdDepartamento(e.target.value)} required style={{ padding: '0.4rem' }}>
            <option value="">Departamento...</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        ) : (
          <span style={{ padding: '0.4rem', color: 'var(--texto-tenue)' }}>{departamentoPropio?.nombre}</span>
        )}
        <button className="btn" disabled={guardando}>Crear</button>
      </form>
      {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{error}</p>}

      <table>
        <thead><tr><th>Nombre</th><th></th></tr></thead>
        <tbody>
          {gruposPorDepto.map((grupo) => (
            <Fragment key={grupo.idDepto}>
              <tr>
                <td colSpan={2} style={{ background: 'var(--bg-1)', fontWeight: 700, color: 'var(--gold)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {grupo.nombre}
                </td>
              </tr>
              {grupo.lista.map((t) => renderFila(t))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
