import { Fragment, useEffect, useMemo, useState } from 'react'
import { departamentosApi, tareasApi, localesApi } from '../../api/recursos.js'
import { useAuthStore } from '../../store/authStore.js'
import AgendaDeTarea from './AgendaDeTarea.jsx'

export default function AdminTareas() {
  const esAdminGlobal = useAuthStore((s) => s.esAdminGlobal)
  const departamentoPropio = useAuthStore((s) => s.departamento)

  const [departamentos, setDepartamentos] = useState([])
  const [tareas, setTareas] = useState([])
  const [locales, setLocales] = useState([])
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

  // Solo admin puede pedir las desactivadas -- son las candidatas a
  // "Eliminar definitivamente" (ver DELETE /tareas/:id).
  const [mostrarInactivas, setMostrarInactivas] = useState(false)

  async function cargarTareas(incluirInactivas = mostrarInactivas) {
    setTareas(await tareasApi.listar(undefined, incluirInactivas))
  }
  async function cargarDepartamentos() {
    setDepartamentos(await departamentosApi.listar())
  }

  useEffect(() => {
    cargarDepartamentos()
    cargarTareas()
    localesApi.listar().then(setLocales)
  }, [])

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

  const nombreDepto = (id) => departamentos.find((d) => d.id === id)?.nombre || id

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
              <td>{t.nombre}</td>
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
              <AgendaDeTarea tarea={t} locales={locales} grupos={grupos} onCerrar={() => setAgendaAbiertaId(null)} />
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
