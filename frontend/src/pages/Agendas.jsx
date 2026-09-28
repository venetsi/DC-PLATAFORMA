import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { agendasApi, departamentosApi, localesApi, tareasApi, usuariosApi } from '../api/recursos.js'
import DepartamentosAvisos from '../components/DepartamentosAvisos.jsx'
import DuplicarTarea from './admin/DuplicarTarea.jsx'
import NuevaTarea, { mensajeDeCreacion } from './agendas/NuevaTarea.jsx'
import DetalleAgenda from './agendas/DetalleAgenda.jsx'
import { dondeTexto, cuandoTexto, responsableTexto, estadoTarea } from './agendas/resumen.js'
import { usePermisos } from '../lib/permisos.js'

// Agendas: las tareas de cada departamento con donde, cuando, quien y como
// vienen, en un solo lugar. Direccion ve y gestiona todos los departamentos;
// cada area, los suyos. Reemplaza al viejo catalogo de /admin/tareas.
//
// Que se puede hacer depende del rol en el Google Group de cada departamento
// (lib/permisos.js): MEMBER mira, MANAGER crea y edita, OWNER ademas
// desactiva, elimina y configura los avisos de su departamento.
export default function Agendas() {
  const { esAdminGlobal, departamentos: propios } = useAuthStore()
  const { puede, enAlguno, filtrar } = usePermisos()
  const puedeConfigurar = enAlguno('administrar')
  const verTodos = esAdminGlobal || propios.length > 1
  const [idDepto, setIdDepto] = useState(verTodos ? '' : propios[0]?.id || '')
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [verInactivas, setVerInactivas] = useState(false)
  const [abierta, setAbierta] = useState(null)
  // null | 'nueva' | { duplicar: id } | { renombrar: id }
  const [panel, setPanel] = useState(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [aviso, setAviso] = useState(null)
  const [deptosConfig, setDeptosConfig] = useState([])
  const [locales, setLocales] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const ultimoPedido = useRef(0)

  async function cargar() {
    const pedido = ++ultimoPedido.current
    setCargando(true)
    try {
      const r = await agendasApi.listar({ departamento: idDepto, inactivas: verInactivas })
      if (pedido === ultimoPedido.current) { setData(r); setError('') }
    } catch (err) {
      if (pedido === ultimoPedido.current) setError(err.response?.data?.error || 'No se pudieron cargar las agendas')
    } finally {
      if (pedido === ultimoPedido.current) setCargando(false)
    }
  }
  const cargarConfig = () => (puedeConfigurar ? departamentosApi.listar().then(setDeptosConfig) : Promise.resolve())

  useEffect(() => { cargar() }, [idDepto, verInactivas])
  useEffect(() => {
    localesApi.listar().then(setLocales)
    usuariosApi.listar().then(setUsuarios)
    cargarConfig()
  }, [])

  function avisar(texto, tono = 'ok') {
    setAviso({ texto, tono })
    setTimeout(() => setAviso((a) => (a?.texto === texto ? null : a)), 6000)
  }

  const grupos = useMemo(() => [...new Set(locales.map((l) => l.grupo).filter(Boolean))].sort(), [locales])
  const nombrePorEmail = (email) => usuarios.find((u) => u.email === email)?.nombre || email
  const usuariosDe = (id) => usuarios.filter((u) => (u.departamentos || [u.id_departamento]).includes(id))
  const deptos = data?.departamentos || []
  const nombreDepto = (id) => deptos.find((d) => d.id === id)?.nombre || ''
  const gestionables = filtrar('editar', deptos)

  const tareas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const lista = (data?.tareas || []).filter((t) => !q || t.nombre.toLowerCase().includes(q) || t.asignaciones.some((a) => (a.local || '').toLowerCase().includes(q) || (a.grupo || '').toLowerCase().includes(q)))
    // Las que necesitan atencion primero: atrasadas, despues sin agenda.
    const peso = (t) => (t.activa ? 0 : 3) + (estadoTarea(t.asignaciones).tono === 'mal' ? 0 : estadoTarea(t.asignaciones).tono === 'medio' ? 1 : 2)
    return lista.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre))
  }, [data, busqueda])

  const totalAtrasadas = tareas.reduce((s, t) => s + estadoTarea(t.asignaciones).atrasadas, 0)
  const totalLocales = new Set(tareas.flatMap((t) => t.asignaciones.map((a) => a.id_local_ext || 'empresa'))).size

  async function renombrar(t) {
    try {
      await tareasApi.editar(t.id, { nombre: nuevoNombre.trim() })
      setPanel(null)
      avisar('Nombre actualizado.')
      await cargar()
    } catch (err) {
      avisar(err.response?.data?.error || 'No se pudo renombrar', 'mal')
    }
  }
  async function desactivar(t) {
    if (!confirm(`¿Desactivar "${t.nombre}"? Deja de agendarse en todos sus locales desde hoy (el historial queda).`)) return
    await tareasApi.editar(t.id, { activa: false })
    avisar(`"${t.nombre}" desactivada.`)
    await cargar()
  }
  async function eliminar(t) {
    if (prompt(`Esto borra "${t.nombre}" Y sus eventos de Google Calendar de forma DEFINITIVA: se pierde el historial.\n\nEscribí ELIMINAR para confirmar:`) !== 'ELIMINAR') return
    await tareasApi.eliminar(t.id)
    avisar(`"${t.nombre}" eliminada.`)
    await cargar()
  }

  const titulo = idDepto ? nombreDepto(idDepto) : 'Todos los departamentos'

  return (
    <div className="agendas">
      {puedeConfigurar && (
        <DepartamentosAvisos
          departamentos={esAdminGlobal ? deptosConfig : deptosConfig.filter((d) => puede('administrar', d.id))}
          puedeCrear={esAdminGlobal}
          onCambio={() => Promise.all([cargarConfig(), cargar()])}
        />
      )}

      <div className="agendas-grid">
        <nav className="agendas-deptos" aria-label="Departamentos">
          {verTodos && (
            <button className={idDepto === '' ? 'depto sel' : 'depto'} onClick={() => setIdDepto('')}>
              <span>Todos</span><span className="tenue">{deptos.reduce((s, d) => s + d.tareas, 0)}</span>
            </button>
          )}
          {deptos.map((d) => (
            <button key={d.id} className={idDepto === d.id ? 'depto sel' : 'depto'} onClick={() => setIdDepto(d.id)}>
              <span>{d.nombre}</span><span className="tenue">{d.tareas}</span>
            </button>
          ))}
        </nav>

        <section className="agendas-main">
          <div className="agendas-cab">
            <div>
              <h2>{titulo}</h2>
              <span className="tenue">
                {tareas.length} {tareas.length === 1 ? 'tarea' : 'tareas'} · {totalLocales} {totalLocales === 1 ? 'lugar' : 'lugares'}
                {totalAtrasadas > 0 && <> · <span className="tono-mal">{totalAtrasadas} atrasadas</span></>}
              </span>
              {cargando && <span className="cargando-chip" role="status">Actualizando…</span>}
            </div>
            <div className="agendas-herramientas">
              <input type="search" placeholder="Buscar tarea, local o grupo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar" />
              {puedeConfigurar && (
                <label className="en-linea tenue"><input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Desactivadas</label>
              )}
              {gestionables.length > 0 && <button className="btn" onClick={() => setPanel(panel === 'nueva' ? null : 'nueva')}>+ Nueva tarea</button>}
            </div>
          </div>

          {aviso && <div className={`aviso aviso-${aviso.tono}`} role="status">{aviso.texto}</div>}
          {error && <p className="error-texto">{error}</p>}

          {panel === 'nueva' && (
            <NuevaTarea
              departamentos={gestionables}
              idDepartamentoInicial={idDepto}
              locales={locales}
              grupos={grupos}
              usuariosDe={usuariosDe}
              onCerrar={() => setPanel(null)}
              onCreada={async (r) => {
                setPanel(null)
                avisar(mensajeDeCreacion(r), r.errores.length ? 'mal' : 'ok')
                if (idDepto && idDepto !== r.tarea.id_departamento) setIdDepto(r.tarea.id_departamento)
                else await cargar()
                setAbierta(r.tarea.id)
              }}
            />
          )}

          <div className="tabla-scroll">
            <table className="tabla-agendas">
              <thead>
                <tr><th>Tarea</th><th>Dónde</th><th>Cuándo</th><th>Responsable</th><th>Estado</th><th aria-label="Acciones" /></tr>
              </thead>
              <tbody>
                {tareas.map((t) => {
                  const donde = dondeTexto(t.asignaciones)
                  const cuando = cuandoTexto(t.asignaciones)
                  const estado = estadoTarea(t.asignaciones)
                  const expandida = abierta === t.id
                  const puedeEditar = puede('editar', t.id_departamento)
                  const puedeAdministrar = puede('administrar', t.id_departamento)
                  return (
                    <Fragment key={t.id}>
                      <tr className={`fila-tarea${expandida ? ' abierta' : ''}${t.activa ? '' : ' inactiva'}`}>
                        <td>
                          <button className="plegar" onClick={() => setAbierta(expandida ? null : t.id)} aria-expanded={expandida}>
                            <span aria-hidden="true">{expandida ? '▾' : '▸'}</span> {t.nombre}
                          </button>
                          {!idDepto && <div className="tenue">{nombreDepto(t.id_departamento)}</div>}
                          {!t.activa && <div className="tenue">desactivada</div>}
                        </td>
                        <td>{donde.principal}{donde.detalle && <div className="tenue">{donde.detalle}</div>}</td>
                        <td>{cuando.principal}{cuando.detalle && <div className="tenue">{cuando.detalle}</div>}</td>
                        <td>{responsableTexto(t.asignaciones, nombrePorEmail)}</td>
                        <td>{t.activa && <span className={`pill-${estado.tono}`}>{estado.texto}</span>}</td>
                        <td className="acciones-fila">
                          {puedeEditar && t.activa && (
                            <>
                              <button className="btn btn-secondary btn-chico" onClick={() => { setNuevoNombre(t.nombre); setPanel({ renombrar: t.id }) }}>Renombrar</button>
                              <button className="btn btn-secondary btn-chico" onClick={() => setPanel(panel?.duplicar === t.id ? null : { duplicar: t.id })}>Duplicar</button>
                            </>
                          )}
                          {puedeAdministrar && t.activa && <button className="btn btn-secondary btn-chico" onClick={() => desactivar(t)}>Desactivar</button>}
                          {puedeAdministrar && !t.activa && <button className="btn btn-secondary btn-chico" onClick={() => eliminar(t)}>Eliminar definitivamente</button>}
                        </td>
                      </tr>
                      {panel?.renombrar === t.id && (
                        <tr><td colSpan={6}>
                          <form className="en-linea" onSubmit={(e) => { e.preventDefault(); renombrar(t) }}>
                            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} autoFocus aria-label="Nuevo nombre" style={{ minWidth: 260 }} />
                            <button className="btn" disabled={!nuevoNombre.trim() || nuevoNombre.trim() === t.nombre}>Guardar</button>
                            <button type="button" className="btn btn-secondary" onClick={() => setPanel(null)}>Cancelar</button>
                          </form>
                        </td></tr>
                      )}
                      {panel?.duplicar === t.id && (
                        <tr><td colSpan={6}>
                          <DuplicarTarea
                            tarea={t}
                            departamentos={gestionables}
                            cantidadAsignaciones={t.asignaciones.length}
                            onCerrar={() => setPanel(null)}
                            onDuplicada={() => cargar()}
                          />
                        </td></tr>
                      )}
                      {expandida && (
                        <tr className="fila-detalle"><td colSpan={6}>
                          {(
                            <DetalleAgenda
                              soloLectura={!puedeEditar}
                              tarea={t}
                              locales={locales}
                              grupos={grupos}
                              departamentos={deptos}
                              usuarios={usuariosDe(t.id_departamento)}
                              nombrePorEmail={nombrePorEmail}
                              onCambio={cargar}
                              avisar={avisar}
                            />
                          )}
                        </td></tr>
                      )}
                    </Fragment>
                  )
                })}
                {data && !tareas.length && (
                  <tr><td colSpan={6} className="vacio">
                    {busqueda ? 'Nada coincide con la búsqueda.' : 'Este departamento todavía no tiene tareas. Creá la primera con "Nueva tarea".'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
