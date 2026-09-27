import { useEffect, useState } from 'react'
import { departamentosApi } from '../api/recursos.js'

const CLAVE_SECCION = 'dc-admin-departamentos-abierta'
function leerAbierta() {
  try { return localStorage.getItem(CLAVE_SECCION) === '1' } catch { return false }
}

// Configuracion de la plataforma (solo admin): crear departamento, releer los
// Google Groups, y por departamento el webhook de Chat y los umbrales de
// escalamiento. Plegada por defecto (se recuerda por navegador) porque no es
// gestion de tareas del dia a dia.
//
// El webhook es write-only: el backend nunca devuelve el valor crudo (solo
// "tiene_webhook"), asi que el input arranca vacio y "dejarlo en blanco"
// significa "no tocarlo".
// `puedeCrear`: solo Direccion/admin crea departamentos y relee los grupos; un
// OWNER ve esta seccion solo con los avisos de SUS departamentos.
export default function DepartamentosAvisos({ departamentos, onCambio, puedeCrear = true }) {
  const [abierta, setAbierta] = useState(leerAbierta)
  const [avisos, setAvisos] = useState({})
  const [guardandoAviso, setGuardandoAviso] = useState(null)
  const [errorAviso, setErrorAviso] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  const [resultadoSync, setResultadoSync] = useState('')
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [creando, setCreando] = useState(false)
  const [errorCrear, setErrorCrear] = useState('')

  function alternar() {
    setAbierta((v) => {
      try { localStorage.setItem(CLAVE_SECCION, v ? '0' : '1') } catch {}
      return !v
    })
  }

  // Precarga los umbrales ya guardados; no pisa lo que ya este editando.
  useEffect(() => {
    setAvisos((prev) => {
      const siguiente = { ...prev }
      for (const d of departamentos) {
        if (d.id in siguiente) continue
        siguiente[d.id] = { webhook: '', diasDepartamento: d.dias_aviso_departamento ?? '', diasDireccion: d.dias_aviso_direccion ?? '' }
      }
      return siguiente
    })
  }, [departamentos])

  const actualizar = (id, campo, valor) => setAvisos((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }))

  async function releerGrupos() {
    setSincronizando(true)
    setResultadoSync('')
    try {
      const r = await departamentosApi.sincronizarGrupos()
      const frenados = r.departamentos.filter((d) => !d.aplicado)
      setResultadoSync(frenados.length
        ? `Grupos leídos. Sin aplicar: ${frenados.map((d) => `${d.slug} (${d.error})`).join('; ')}`
        : `Grupos leídos: ${r.departamentos.map((d) => `${d.slug} ${d.ahora}`).join(', ')}.`)
      await onCambio()
    } catch (err) {
      setResultadoSync(err.response?.data?.error || 'No se pudieron leer los grupos')
    } finally {
      setSincronizando(false)
    }
  }

  async function crear(e) {
    e.preventDefault()
    setErrorCrear('')
    setCreando(true)
    try {
      await departamentosApi.crear(nombreNuevo)
      setNombreNuevo('')
      await onCambio()
    } catch (err) {
      setErrorCrear(err.response?.data?.error || 'No se pudo crear el departamento')
    } finally {
      setCreando(false)
    }
  }

  async function guardar(id) {
    setErrorAviso('')
    setGuardandoAviso(id)
    const ed = avisos[id] || { webhook: '', diasDepartamento: '', diasDireccion: '' }
    const body = {
      dias_aviso_departamento: ed.diasDepartamento === '' ? null : Number(ed.diasDepartamento),
      dias_aviso_direccion: ed.diasDireccion === '' ? null : Number(ed.diasDireccion)
    }
    if (ed.webhook.trim()) body.chat_webhook_url = ed.webhook.trim()
    try {
      await departamentosApi.notificaciones(id, body)
      setAvisos((prev) => ({ ...prev, [id]: { ...prev[id], webhook: '' } }))
      await onCambio()
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
      await onCambio()
    } catch (err) {
      setErrorAviso(err.response?.data?.error || 'No se pudo quitar el webhook')
    } finally {
      setGuardandoAviso(null)
    }
  }

  return (
    <section className="card seccion-plegable">
      <button type="button" className="seccion-cabecera" onClick={alternar} aria-expanded={abierta}>
        <span className="seccion-flecha" aria-hidden="true">{abierta ? '▾' : '▸'}</span>
        <span className="seccion-titulo">{puedeCrear ? 'Departamentos y avisos' : 'Avisos de tus departamentos'}</span>
        <span className="seccion-resumen">
          {departamentos.length} departamentos · {departamentos.filter((d) => d.chat_space_name).length} con Space de Chat
          {departamentos.some((d) => d.membresia_sync_error) && <span style={{ color: 'var(--rojo)' }}> · error leyendo grupos</span>}
        </span>
      </button>
      {abierta && (
        <div className="seccion-cuerpo">
          {puedeCrear && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <form onSubmit={crear} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input placeholder="Nuevo departamento (ej. Marketing)" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} required style={{ minWidth: 240, padding: '0.4rem' }} />
              <button className="btn" disabled={creando}>Crear departamento</button>
            </form>
            <button className="btn btn-secondary" disabled={sincronizando} onClick={releerGrupos} title="Relee ya los Google Groups depto-*; se refrescan solos cada ~15 min">
              {sincronizando ? 'Leyendo grupos…' : 'Releer Google Groups'}
            </button>
          </div>
          )}
          {errorCrear && <p style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{errorCrear}</p>}
          {resultadoSync && <p style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>{resultadoSync}</p>}
          <p style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)', margin: '0 0 0.75rem' }}>
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
                  const ed = avisos[d.id] || { webhook: '', diasDepartamento: '', diasDireccion: '' }
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.nombre}
                        {d.chat_space_name && <div style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)' }}>vinculado por Space</div>}
                        <div style={{ fontSize: '0.72rem', color: d.membresia_sync_error ? 'var(--rojo)' : 'var(--texto-tenue)' }} title={d.membresia_sync_error || d.email_group_google || ''}>
                          {d.membresia_sync_error ? 'grupo: error al leer' : `grupo: ${d._count?.membresias ?? 0} miembros`}
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder={d.tiene_webhook ? 'Configurado — dejar en blanco para no tocarlo' : 'Sin configurar'}
                          value={ed.webhook}
                          onChange={(e) => actualizar(d.id, 'webhook', e.target.value)}
                          style={{ width: '100%', minWidth: 220, padding: '0.3rem' }}
                        />
                        {d.tiene_webhook && (
                          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', marginTop: '0.25rem', padding: '0.2rem 0.5rem' }} disabled={guardandoAviso === d.id} onClick={() => quitarWebhook(d.id)}>
                            Quitar webhook
                          </button>
                        )}
                      </td>
                      <td>
                        <input type="number" min="0" max="365" placeholder="default" value={ed.diasDepartamento} onChange={(e) => actualizar(d.id, 'diasDepartamento', e.target.value)} style={{ width: '5rem', padding: '0.3rem' }} />
                      </td>
                      <td>
                        <input type="number" min="0" max="365" placeholder="default" value={ed.diasDireccion} onChange={(e) => actualizar(d.id, 'diasDireccion', e.target.value)} style={{ width: '5rem', padding: '0.3rem' }} />
                      </td>
                      <td>
                        <button className="btn" disabled={guardandoAviso === d.id} onClick={() => guardar(d.id)}>Guardar</button>
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
    </section>
  )
}
