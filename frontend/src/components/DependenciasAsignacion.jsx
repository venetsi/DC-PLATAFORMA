import { useEffect, useMemo, useState } from 'react'
import { dependenciasApi, asignacionesApi, tareasApi } from '../api/recursos.js'

// Configurar los prerrequisitos de UNA asignación: "esta tarea espera a que
// termine aquella". Avisan, no bloquean (ver backend lib/dependencias.js).
//
// "En todos los locales" es el atajo para no cargar local por local: cada
// local de esta tarea espera a la tarea elegida EN SU MISMO local. Como toca
// todas las asignaciones de la tarea, avisa con `onCambioEnLote` para que los
// demás bloques vuelvan a leer (`version`).
//
// Vive acá y no dentro de AgendaDeTarea.jsx para no engordar más ese archivo.
export default function DependenciasAsignacion({ asignacion, departamentos, version = 0, onCambioEnLote }) {
  const [dependencias, setDependencias] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [idDepto, setIdDepto] = useState('')
  const [tareas, setTareas] = useState([])
  const [idTarea, setIdTarea] = useState('')
  const [asignaciones, setAsignaciones] = useState([])
  const [idPrerequisito, setIdPrerequisito] = useState('')
  const [enTodos, setEnTodos] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setDependencias(await dependenciasApi.listar(asignacion.id))
  }
  useEffect(() => { cargar() }, [asignacion.id, version])

  // Al elegir departamento se traen sus tareas; al elegir tarea, sus
  // asignaciones (que es lo que realmente se referencia).
  useEffect(() => {
    setIdTarea(''); setAsignaciones([]); setIdPrerequisito('')
    if (idDepto) tareasApi.listar(idDepto).then(setTareas)
    else setTareas([])
  }, [idDepto])

  useEffect(() => {
    setIdPrerequisito('')
    if (idTarea) asignacionesApi.listar({ id_tarea: idTarea }).then(setAsignaciones)
    else setAsignaciones([])
  }, [idTarea])

  const nombreDeAsignacion = useMemo(
    () => (a) => a.local?.nombre || 'Toda la empresa',
    []
  )

  async function agregar(e) {
    e.preventDefault()
    setError('')
    setResultado('')
    setGuardando(true)
    try {
      if (enTodos) {
        const r = await dependenciasApi.crearEnLote({ id_asignacion: asignacion.id, id_tarea_prerequisito: idTarea })
        setResultado(textoDelLote(r))
        onCambioEnLote?.()
      } else {
        await dependenciasApi.crear({ id_asignacion: asignacion.id, id_asignacion_prerequisito: idPrerequisito })
      }
      setIdDepto(''); setIdTarea(''); setIdPrerequisito(''); setEnTodos(false)
      await cargar()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la dependencia')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(id) {
    await dependenciasApi.borrar(id)
    await cargar()
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      {dependencias.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--texto-tenue)', marginBottom: '0.35rem' }}>
          Espera a:{' '}
          {dependencias.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <strong style={{ color: 'var(--texto)' }}>{d.nombre_tarea}</strong> — {d.departamento} ({d.local})
              <button
                type="button"
                onClick={() => borrar(d.id)}
                title="Quitar esta dependencia"
                style={{ marginLeft: 4, background: 'none', border: 'none', color: 'var(--rojo)', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!abierto && (
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => setAbierto(true)}>
          + Depende de otra tarea
        </button>
      )}

      {abierto && (
        <form onSubmit={agregar} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.35rem' }}>
          <select value={idDepto} onChange={(e) => setIdDepto(e.target.value)} required style={{ fontSize: '0.8rem' }}>
            <option value="">Departamento...</option>
            {(departamentos || []).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>

          <select value={idTarea} onChange={(e) => setIdTarea(e.target.value)} required disabled={!idDepto} style={{ fontSize: '0.8rem' }}>
            <option value="">Tarea...</option>
            {tareas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>

          {!enTodos && (
            <select value={idPrerequisito} onChange={(e) => setIdPrerequisito(e.target.value)} required disabled={!idTarea} style={{ fontSize: '0.8rem' }}>
              <option value="">Local...</option>
              {asignaciones.map((a) => <option key={a.id} value={a.id}>{nombreDeAsignacion(a)}</option>)}
            </select>
          )}

          <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.78rem' }}>
            <input type="checkbox" checked={enTodos} onChange={(e) => setEnTodos(e.target.checked)} />
            En todos los locales (cada uno espera al suyo)
          </label>

          <button className="btn" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} disabled={guardando || (enTodos ? !idTarea : !idPrerequisito)}>
            {guardando ? 'Agregando…' : 'Agregar'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            onClick={() => { setAbierto(false); setError(''); setIdDepto(''); setEnTodos(false) }}
          >
            Cancelar
          </button>
          {error && <span style={{ color: 'var(--rojo)', fontSize: '0.75rem', width: '100%' }}>{error}</span>}
        </form>
      )}
      {resultado && <p style={{ color: 'var(--verde)', fontSize: '0.78rem', margin: '0.35rem 0 0' }}>{resultado}</p>}
    </div>
  )
}

// "12 locales ahora esperan a CMV. 2 ya estaban. Sin ese local en la otra tarea: X, Y."
function textoDelLote(r) {
  const partes = []
  partes.push(r.creadas === 1 ? '1 local ahora espera a esa tarea.' : `${r.creadas} locales ahora esperan a esa tarea.`)
  if (r.ya_existian) partes.push(r.ya_existian === 1 ? '1 ya estaba.' : `${r.ya_existian} ya estaban.`)
  if (r.sin_par?.length) partes.push(`La otra tarea no está en: ${r.sin_par.join(', ')}.`)
  if (r.ciclos?.length) partes.push(`No se agregó en ${r.ciclos.join(', ')}: se formaría un círculo.`)
  return partes.join(' ')
}
