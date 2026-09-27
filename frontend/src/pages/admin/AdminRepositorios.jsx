import { Fragment, useEffect, useRef, useState } from 'react'
import { departamentosApi, repositoriosApi } from '../../api/recursos.js'
import SubirArchivo from '../../components/SubirArchivo.jsx'

const ETIQUETA_ESTADO = {
  PENDIENTE: { texto: 'Indexando…', color: 'var(--gold)' },
  INDEXADO: { texto: 'Listo', color: 'var(--teal)' },
  ERROR: { texto: 'Error', color: 'var(--rojo)' }
}

const ETIQUETA_TIPO_DOC = {
  TXT: 'Texto',
  MD: 'Markdown',
  PDF: 'PDF',
  URL: 'URL',
  DRIVE_DOC: 'Google Doc',
  DRIVE_SHEET: 'Google Sheet',
  DRIVE_SLIDE: 'Google Slides'
}

// Checkbox de departamentos, reusado tanto para crear un repositorio como
// para editar a cuales esta asignado uno existente -- sin departamentos
// tildados, el repositorio es general (lo ve cualquier Space).
function CheckboxDepartamentos({ departamentos, seleccionados, onCambiar }) {
  function toggle(id) {
    onCambiar(seleccionados.includes(id) ? seleccionados.filter((s) => s !== id) : [...seleccionados, id])
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', fontSize: '0.85rem' }}>
      {departamentos.map((d) => (
        <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <input type="checkbox" checked={seleccionados.includes(d.id)} onChange={() => toggle(d.id)} />
          {d.nombre}
        </label>
      ))}
    </div>
  )
}

function ListaDocumentos({ documentos, onEliminar }) {
  if (!documentos.length) return <p style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem' }}>Todavía no hay documentos acá.</p>
  return (
    <div className="tabla-scroll">
    <table>
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        {documentos.map((d) => (
          <tr key={d.id}>
            <td>{d.origen && d.tipo === 'URL' ? <a href={d.origen} target="_blank" rel="noreferrer">{d.nombre}</a> : d.nombre}</td>
            <td>{ETIQUETA_TIPO_DOC[d.tipo] || d.tipo}</td>
            <td>
              <span style={{ color: ETIQUETA_ESTADO[d.estado]?.color, fontWeight: 600 }}>
                {ETIQUETA_ESTADO[d.estado]?.texto || d.estado}
              </span>
              {d.estado === 'ERROR' && d.error && <div style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)' }}>{d.error}</div>}
            </td>
            <td><button className="btn btn-secondary" onClick={() => onEliminar(d)}>Sacar</button></td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

// Panel de detalle de UN repositorio: departamentos asignados, y segun el
// tipo, o bien carga manual (archivo/URL) o el boton de resincronizar Drive.
function DetalleRepositorio({ repositorio, departamentos, onCambio, onEliminado }) {
  const [documentos, setDocumentos] = useState([])
  const [asignados, setAsignados] = useState(repositorio.departamentos.map((a) => a.id_departamento))
  const [guardandoAsignacion, setGuardandoAsignacion] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [resultadoSync, setResultadoSync] = useState(null)
  const intervaloRef = useRef(null)

  async function cargarDocumentos() {
    setDocumentos(await repositoriosApi.listarDocumentos(repositorio.id))
  }

  useEffect(() => { cargarDocumentos() }, [repositorio.id])

  useEffect(() => {
    const hayPendientes = documentos.some((d) => d.estado === 'PENDIENTE')
    clearInterval(intervaloRef.current)
    if (hayPendientes) intervaloRef.current = setInterval(cargarDocumentos, 3000)
    return () => clearInterval(intervaloRef.current)
  }, [documentos])

  async function guardarAsignacion() {
    setGuardandoAsignacion(true)
    try {
      await repositoriosApi.actualizarDepartamentos(repositorio.id, asignados)
      await onCambio()
    } finally {
      setGuardandoAsignacion(false)
    }
  }

  async function onArchivo(archivo) {
    setError('')
    setSubiendo(true)
    try {
      await repositoriosApi.subir(repositorio.id, archivo)
      await cargarDocumentos()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo subir el archivo')
    } finally {
      setSubiendo(false)
    }
  }

  async function onAgregarUrl(e) {
    e.preventDefault()
    setError('')
    setSubiendo(true)
    try {
      await repositoriosApi.agregarUrl(repositorio.id, url)
      setUrl('')
      await cargarDocumentos()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo cargar esa URL')
    } finally {
      setSubiendo(false)
    }
  }

  async function onSincronizar() {
    setError('')
    setSincronizando(true)
    setResultadoSync(null)
    try {
      const resultado = await repositoriosApi.sincronizar(repositorio.id)
      setResultadoSync(resultado)
      await cargarDocumentos()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo sincronizar la carpeta')
    } finally {
      setSincronizando(false)
    }
  }

  async function onEliminarDoc(doc) {
    if (!confirm(`¿Sacar "${doc.nombre}" de este repositorio?`)) return
    await repositoriosApi.eliminarDocumento(doc.id)
    await cargarDocumentos()
  }

  async function onEliminarRepositorio() {
    if (!confirm(`¿Borrar el repositorio "${repositorio.nombre}" entero, con todos sus documentos? No se puede deshacer.`)) return
    await repositoriosApi.eliminar(repositorio.id)
    onEliminado()
  }

  return (
    <div style={{ padding: '1rem', background: 'var(--bg-1, rgba(255,255,255,0.02))' }}>
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--texto-tenue)', marginBottom: '0.3rem' }}>
          Departamentos asignados (ninguno = general, lo ve cualquier Space)
        </span>
        <CheckboxDepartamentos departamentos={departamentos} seleccionados={asignados} onCambiar={setAsignados} />
        <button className="btn btn-secondary" onClick={guardarAsignacion} disabled={guardandoAsignacion} style={{ marginTop: '0.5rem' }}>
          Guardar asignación
        </button>
      </div>

      {repositorio.tipo === 'DRIVE_FOLDER' ? (
        <div style={{ marginBottom: '1rem' }}>
          <button className="btn" onClick={onSincronizar} disabled={sincronizando}>
            {sincronizando ? 'Sincronizando…' : 'Resincronizar carpeta'}
          </button>
          {repositorio.ultimo_sync && (
            <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: 'var(--texto-tenue)' }}>
              Última vez: {new Date(repositorio.ultimo_sync).toLocaleString('es-AR')}
            </span>
          )}
          {resultadoSync && (
            <p style={{ fontSize: '0.85rem', color: 'var(--texto-tenue)', marginTop: '0.5rem' }}>
              {resultadoSync.importados} nuevo(s), {resultadoSync.salteados} ya estaban o no son de un tipo soportado
              {resultadoSync.errores?.length ? `, ${resultadoSync.errores.length} con error` : ''}.
            </p>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <SubirArchivo onArchivo={onArchivo} disabled={subiendo} />
          <form onSubmit={onAgregarUrl} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <input
              placeholder="https://... (una página con el texto a indexar)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              style={{ flex: 1, padding: '0.4rem' }}
            />
            <button className="btn" disabled={subiendo}>Agregar URL</button>
          </form>
        </div>
      )}

      {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

      <ListaDocumentos documentos={documentos} onEliminar={onEliminarDoc} />

      <button className="btn btn-secondary" onClick={onEliminarRepositorio} style={{ marginTop: '1rem' }}>
        Borrar repositorio
      </button>
    </div>
  )
}

// Pantalla para administrar los repositorios que /buscar (Chat) puede
// consultar via Gemini. Un repositorio tiene nombre propio y se asigna a
// cero o mas departamentos (pedido explicito: "quiero del admin poder
// asignar los repos por multidepartamento") -- sin ninguno, es general.
export default function AdminRepositorios() {
  const [departamentos, setDepartamentos] = useState([])
  const [repositorios, setRepositorios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [abiertoId, setAbiertoId] = useState(null)

  const [nombreNuevo, setNombreNuevo] = useState('')
  const [tipoNuevo, setTipoNuevo] = useState('MANUAL')
  const [driveFolderNuevo, setDriveFolderNuevo] = useState('')
  const [departamentosNuevo, setDepartamentosNuevo] = useState([])
  const [creando, setCreando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState('')

  async function cargarRepositorios() {
    setRepositorios(await repositoriosApi.listar())
  }

  useEffect(() => {
    departamentosApi.listar().then(setDepartamentos)
    cargarRepositorios().finally(() => setCargando(false))
  }, [])

  async function onCrear(e) {
    e.preventDefault()
    setErrorCreacion('')
    setCreando(true)
    try {
      await repositoriosApi.crear({
        nombre: nombreNuevo,
        tipo: tipoNuevo,
        driveFolder: tipoNuevo === 'DRIVE_FOLDER' ? driveFolderNuevo : undefined,
        idsDepartamentos: departamentosNuevo
      })
      setNombreNuevo('')
      setDriveFolderNuevo('')
      setDepartamentosNuevo([])
      setTipoNuevo('MANUAL')
      await cargarRepositorios()
    } catch (err) {
      setErrorCreacion(err.response?.data?.error || 'No se pudo crear el repositorio')
    } finally {
      setCreando(false)
    }
  }

  function etiquetaDepartamentos(repositorio) {
    if (!repositorio.departamentos.length) return 'General'
    return repositorio.departamentos.map((a) => a.departamento.nombre).join(', ')
  }

  return (
    <div>
      <h2>Repositorios para /buscar</h2>
      <p style={{ color: 'var(--texto-tenue)', maxWidth: 640 }}>
        Cada repositorio agrupa documentos que Gemini puede usar para responder <code>/buscar</code> en
        Chat, y se asigna a uno o varios departamentos (o a ninguno, para que lo vea cualquier Space).
      </p>

      <form onSubmit={onCrear} className="card" style={{ maxWidth: 640, marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Nuevo repositorio</h3>
        <input
          placeholder="Nombre (ej. Políticas de RRHH)"
          value={nombreNuevo}
          onChange={(e) => setNombreNuevo(e.target.value)}
          required
          style={{ padding: '0.4rem' }}
        />
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <input type="radio" checked={tipoNuevo === 'MANUAL'} onChange={() => setTipoNuevo('MANUAL')} />
            Documentos sueltos (archivo o URL)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <input type="radio" checked={tipoNuevo === 'DRIVE_FOLDER'} onChange={() => setTipoNuevo('DRIVE_FOLDER')} />
            Carpeta de Google Drive
          </label>
        </div>
        {tipoNuevo === 'DRIVE_FOLDER' && (
          <input
            placeholder="Link o id de la carpeta de Drive"
            value={driveFolderNuevo}
            onChange={(e) => setDriveFolderNuevo(e.target.value)}
            required
            style={{ padding: '0.4rem' }}
          />
        )}
        <div>
          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--texto-tenue)', marginBottom: '0.3rem' }}>
            Departamentos (ninguno = general)
          </span>
          <CheckboxDepartamentos departamentos={departamentos} seleccionados={departamentosNuevo} onCambiar={setDepartamentosNuevo} />
        </div>
        <button className="btn" disabled={creando} style={{ alignSelf: 'flex-start' }}>Crear repositorio</button>
        {errorCreacion && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{errorCreacion}</p>}
      </form>

      {cargando ? (
        <p>Cargando...</p>
      ) : !repositorios.length ? (
        <p style={{ color: 'var(--texto-tenue)' }}>Todavía no hay ningún repositorio creado.</p>
      ) : (
        // En celular no entra: se desliza dentro de su caja, sin correr la pagina.
        <div className="tabla-scroll">
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Departamentos</th><th>Documentos</th><th></th></tr></thead>
          <tbody>
            {repositorios.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>{r.nombre}</td>
                  <td>{r.tipo === 'DRIVE_FOLDER' ? 'Carpeta de Drive' : 'Manual'}</td>
                  <td>{etiquetaDepartamentos(r)}</td>
                  <td>{r._count.documentos}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => setAbiertoId(abiertoId === r.id ? null : r.id)}>
                      {abiertoId === r.id ? 'Cerrar' : 'Administrar'}
                    </button>
                  </td>
                </tr>
                {abiertoId === r.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <DetalleRepositorio
                        repositorio={r}
                        departamentos={departamentos}
                        onCambio={cargarRepositorios}
                        onEliminado={() => { setAbiertoId(null); cargarRepositorios() }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
