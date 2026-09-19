import { useEffect, useRef, useState } from 'react'
import { departamentosApi, repositoriosApi } from '../../api/recursos.js'
import SubirArchivo from '../../components/SubirArchivo.jsx'

const ETIQUETA_ESTADO = {
  PENDIENTE: { texto: 'Indexando…', color: 'var(--gold)' },
  INDEXADO: { texto: 'Listo', color: 'var(--teal)' },
  ERROR: { texto: 'Error', color: 'var(--rojo)' }
}

const ETIQUETA_TIPO = {
  TXT: 'Texto',
  MD: 'Markdown',
  PDF: 'PDF',
  URL: 'URL',
  DRIVE_DOC: 'Google Doc',
  DRIVE_SHEET: 'Google Sheet',
  DRIVE_SLIDE: 'Google Slides'
}

// Pantalla para cargar los documentos que /buscar (Chat) puede consultar via
// Gemini. Sin pantalla de detalle de Departamento en este frontend todavia,
// asi que va independiente (no como tab), con un selector de a que
// departamento (o "general") pertenece cada documento.
export default function AdminRepositorios() {
  const [departamentos, setDepartamentos] = useState([])
  const [scope, setScope] = useState('general')
  const [documentos, setDocumentos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const intervaloRef = useRef(null)

  useEffect(() => {
    departamentosApi.listar().then(setDepartamentos)
  }, [])

  async function cargarDocumentos() {
    setDocumentos(await repositoriosApi.listar(scope))
  }

  useEffect(() => {
    setCargando(true)
    cargarDocumentos().finally(() => setCargando(false))
  }, [scope])

  // Mientras haya algo PENDIENTE (el indexado en Gemini es asincrónico, ver
  // lib/repositorios.js), se refresca solo cada 3s -- sin esto, un documento
  // recién subido "no aparece" listo por un rato y parece un bug.
  useEffect(() => {
    const hayPendientes = documentos.some((d) => d.estado === 'PENDIENTE')
    clearInterval(intervaloRef.current)
    if (hayPendientes) intervaloRef.current = setInterval(cargarDocumentos, 3000)
    return () => clearInterval(intervaloRef.current)
  }, [documentos, scope])

  async function onArchivo(archivo) {
    setError('')
    setSubiendo(true)
    try {
      await repositoriosApi.subir(archivo, { idDepartamento: scope === 'general' ? undefined : scope })
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
      await repositoriosApi.agregarUrl(url, scope === 'general' ? undefined : scope)
      setUrl('')
      await cargarDocumentos()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo cargar esa URL')
    } finally {
      setSubiendo(false)
    }
  }

  async function onEliminar(documento) {
    if (!confirm(`¿Sacar "${documento.nombre}" de los documentos que puede consultar /buscar?`)) return
    await repositoriosApi.eliminar(documento.id)
    await cargarDocumentos()
  }

  return (
    <div>
      <h2>Documentos para /buscar</h2>
      <p style={{ color: 'var(--texto-tenue)', maxWidth: 640 }}>
        Lo que cargues acá es lo que Gemini puede usar para responder <code>/buscar</code> en
        Chat. Lo del pool <strong>General</strong> lo ve cualquier Space; lo de un departamento
        solo lo ven los Spaces que lo cubran.
      </p>

      <div className="card" style={{ maxWidth: 640, marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--texto-tenue)', marginBottom: '0.3rem' }}>
            Departamento
          </span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: '0.4rem', width: '100%' }}>
            <option value="general">General (todos los Spaces)</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>

        <SubirArchivo onArchivo={onArchivo} disabled={subiendo} />

        <form onSubmit={onAgregarUrl} style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <input
            placeholder="https://... (una página con el texto a indexar)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={{ flex: 1, padding: '0.4rem' }}
          />
          <button className="btn" disabled={subiendo}>Agregar URL</button>
        </form>

        <button
          className="btn btn-secondary"
          disabled
          title="Falta otorgar el permiso drive.readonly en la consola de Workspace"
          style={{ marginTop: '0.75rem' }}
        >
          Agregar desde Google Drive (todavía no disponible)
        </button>

        {error && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
      </div>

      {cargando ? (
        <p>Cargando...</p>
      ) : !documentos.length ? (
        <p style={{ color: 'var(--texto-tenue)' }}>Todavía no hay documentos en este pool.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.id}>
                <td>{d.origen ? <a href={d.origen} target="_blank" rel="noreferrer">{d.nombre}</a> : d.nombre}</td>
                <td>{ETIQUETA_TIPO[d.tipo] || d.tipo}</td>
                <td>
                  <span style={{ color: ETIQUETA_ESTADO[d.estado]?.color, fontWeight: 600 }}>
                    {ETIQUETA_ESTADO[d.estado]?.texto || d.estado}
                  </span>
                  {d.estado === 'ERROR' && d.error && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)' }}>{d.error}</div>
                  )}
                </td>
                <td><button className="btn btn-secondary" onClick={() => onEliminar(d)}>Sacar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
