import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { pantallasApi } from '../api/recursos.js'

// Pantallas de TV (kiosko). Una TV sin conectar abre tv.dcsmart.app y muestra
// un QR con un codigo; el QR trae a esta pantalla con ?codigo=, y desde aca
// se elige que agendas muestra (flujo de dispositivo, RFC 8628: ver backend
// lib/tv-conexion.js). Tambien la lista de las ya conectadas.
const TV_URL = (import.meta.env.VITE_TV_URL || 'https://tv.dcsmart.app').replace(/^https?:\/\//, '')
// La TV avisa que esta viva como mucho cada 10 min (ver routes/tv.js).
const MINUTOS_EN_LINEA = 15

function haceTexto(fecha) {
  if (!fecha) return null
  const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

function mmss(seg) {
  const s = Math.max(0, Math.round(seg))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Mismo criterio que el backend (nombrePorDefecto en lib/tv-conexion.js).
function nombrePorDefecto(nombres) {
  if (!nombres.length) return 'TV'
  if (nombres.length === 1) return `TV ${nombres[0]}`
  if (nombres.length === 2) return `TV ${nombres[0]} y ${nombres[1]}`
  return `TV ${nombres[0]}, ${nombres[1]} y ${nombres.length - 2} más`
}

function Chip({ d, tachado }) {
  return (
    <span className={`chip-depto${tachado ? ' tachado' : ''}`} style={{ color: d.color, background: `${d.color}26` }} title={d.nombre}>
      {d.abreviatura}
    </span>
  )
}

function ElegirDepartamentos({ opciones, seleccion, onCambio }) {
  function alternar(id) {
    const nueva = new Set(seleccion)
    if (nueva.has(id)) nueva.delete(id)
    else nueva.add(id)
    onCambio(nueva)
  }
  if (!opciones.length) return <p className="tenue">No ves ninguna agenda para mostrar.</p>
  return (
    <div className="pantalla-deptos">
      {opciones.map((d) => (
        <label key={d.id} className={`pantalla-depto${seleccion.has(d.id) ? ' sel' : ''}`}>
          <input type="checkbox" checked={seleccion.has(d.id)} onChange={() => alternar(d.id)} />
          <Chip d={d} />
          <span>{d.nombre}</span>
        </label>
      ))}
    </div>
  )
}

function ConectarPantalla({ codigoInicial, onListo, onCerrar }) {
  const [codigo, setCodigo] = useState(codigoInicial)
  const [pedido, setPedido] = useState(null) // respuesta de GET /pantallas/conexion/:codigo + recibido
  const [error, setError] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [, setTic] = useState(0)

  async function buscar(texto) {
    const limpio = String(texto || '').trim()
    if (!limpio) return
    setBuscando(true)
    setError('')
    try {
      const r = await pantallasApi.conexion(limpio)
      setPedido({ ...r, recibido: Date.now() })
      setSeleccion(new Set(r.departamentos.length === 1 ? [r.departamentos[0].id] : []))
      setNombre('')
    } catch (err) {
      setPedido(null)
      setError(err.response?.data?.error || 'No se pudo buscar el código. Probá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  useEffect(() => {
    setCodigo(codigoInicial)
    if (codigoInicial) buscar(codigoInicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoInicial])

  // Cuenta regresiva del codigo mientras se elige.
  useEffect(() => {
    if (!pedido) return
    const t = setInterval(() => setTic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [pedido])
  const restaSeg = pedido ? pedido.vence_en_seg - (Date.now() - pedido.recibido) / 1000 : 0
  const vencido = pedido && restaSeg <= 0

  const elegidos = useMemo(() => (pedido?.departamentos || []).filter((d) => seleccion.has(d.id)), [pedido, seleccion])

  async function conectar(e) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    try {
      const r = await pantallasApi.aprobar(pedido.codigo, { ids_departamento: elegidos.map((d) => d.id), nombre: nombre.trim() || undefined })
      setPedido(null)
      onListo(`Listo: «${r.pantalla.nombre}» ya muestra ${r.pantalla.departamentos.join(', ')}. La TV cambia sola en unos segundos.`)
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo conectar la pantalla.')
    } finally {
      setEnviando(false)
    }
  }

  async function rechazar() {
    setEnviando(true)
    setError('')
    try {
      await pantallasApi.rechazar(pedido.codigo)
      setPedido(null)
      onListo('Listo, se rechazó la conexión. Esa pantalla va a mostrar un código nuevo.')
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo rechazar.')
    } finally {
      setEnviando(false)
    }
  }

  if (!pedido || vencido) {
    return (
      <section className="card pantalla-conectar">
        <h3>Conectar una pantalla</h3>
        <p className="tenue" style={{ margin: 0 }}>
          En la TV abrí <strong>{TV_URL}</strong>: muestra un QR. Escanealo con el celular, o escribí acá el código que aparece abajo del QR.
        </p>
        {vencido && <p className="error-texto">El código venció. La pantalla ya muestra uno nuevo: escanealo otra vez.</p>}
        {error && <p className="error-texto">{error}</p>}
        <form className="pantalla-codigo" onSubmit={(e) => { e.preventDefault(); buscar(codigo) }}>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="BCD-FGH"
            aria-label="Código que muestra la pantalla"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" disabled={buscando || !codigo.trim()}>{buscando ? 'Buscando…' : 'Buscar'}</button>
        </form>
      </section>
    )
  }

  return (
    <section className="card pantalla-conectar destacada">
      <div className="pantalla-conectar-cab">
        <h3>Conectar la pantalla <span className="pantalla-codigo-grande">{pedido.codigo}</span></h3>
        <button type="button" className="btn btn-secondary btn-chico" onClick={() => { setPedido(null); onCerrar() }}>Cerrar</button>
      </div>
      <p className="tenue" style={{ margin: 0 }}>
        Pedida {pedido.pedido_hace_seg < 60 ? 'recién' : `hace ${Math.round(pedido.pedido_hace_seg / 60)} min`} desde {pedido.equipo} · el código vence en {mmss(restaSeg)}
      </p>
      <p className="pantalla-alerta">
        Conectala solo si tenés la pantalla adelante: va a mostrar estas agendas a cualquiera que la mire.
      </p>
      <form onSubmit={conectar} className="pantalla-form">
        <fieldset>
          <legend>¿Qué agendas muestra?</legend>
          <ElegirDepartamentos opciones={pedido.departamentos} seleccion={seleccion} onCambio={setSeleccion} />
        </fieldset>
        <label className="campo">
          Nombre de la pantalla
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={nombrePorDefecto(elegidos.map((d) => d.nombre))} maxLength={60} />
        </label>
        {error && <p className="error-texto">{error}</p>}
        <div className="acciones">
          <button className="btn" disabled={enviando || !elegidos.length}>{enviando ? 'Conectando…' : 'Conectar'}</button>
          <button type="button" className="btn btn-secondary" disabled={enviando} onClick={rechazar}>No reconozco esta pantalla</button>
        </div>
      </form>
    </section>
  )
}

function TarjetaPantalla({ p, opciones, cargarOpciones, onCambio, avisar }) {
  const [modo, setModo] = useState(null) // null | 'agendas' | 'nombre'
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [nombre, setNombre] = useState(p.nombre)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const enLinea = p.ultima_conexion && Date.now() - new Date(p.ultima_conexion).getTime() < MINUTOS_EN_LINEA * 60000
  const noSeMuestran = p.departamentos.filter((d) => !d.se_muestra)

  async function abrirAgendas() {
    setError('')
    setSeleccion(new Set(p.departamentos.map((d) => d.id)))
    setModo('agendas')
    cargarOpciones()
  }

  async function guardar(body) {
    setGuardando(true)
    setError('')
    try {
      const r = await pantallasApi.editar(p.id, body)
      setModo(null)
      if (r.a_tu_nombre) avisar(`«${p.nombre}» quedó a tu nombre: ahora muestra lo que vos elegiste, con tus permisos.`)
      await onCambio()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  async function desconectar() {
    if (!window.confirm(`¿Desconectar «${p.nombre}»? En menos de un minuto la TV vuelve a mostrar el QR.`)) return
    setGuardando(true)
    try {
      await pantallasApi.desconectar(p.id)
      avisar(`«${p.nombre}» se desconectó.`)
      await onCambio()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo desconectar.')
      setGuardando(false)
    }
  }

  // Solo las agendas que esta persona puede elegir: una que ya no ve no se
  // ofrece y, al guardar, sale de la pantalla (el servidor la rechazaria).
  const opcionesEditor = useMemo(() => [...(opciones || [])].sort((a, b) => a.nombre.localeCompare(b.nombre)), [opciones])
  const elegiblesIds = useMemo(() => new Set(opcionesEditor.map((d) => d.id)), [opcionesEditor])
  const seleccionValida = [...seleccion].filter((id) => elegiblesIds.has(id))

  return (
    <li className="card pantalla-tarjeta">
      <div className="pantalla-tarjeta-cab">
        <div>
          <div className="pantalla-nombre">{p.nombre}</div>
          <div className="pantalla-chips">
            {p.departamentos.map((d) => (
              <span key={d.id} className={d.se_muestra ? '' : 'no-se-muestra'} title={d.se_muestra ? d.nombre : `${d.nombre}: no se muestra`}>
                <Chip d={d} tachado={!d.se_muestra} />{d.nombre}
              </span>
            ))}
          </div>
        </div>
        <span className={`pantalla-estado ${p.esperando_tv ? 'medio' : enLinea ? 'ok' : 'mal'}`}>
          {p.esperando_tv ? 'Terminando de conectarse…' : enLinea ? 'En línea' : p.ultima_conexion ? `Sin conexión ${haceTexto(p.ultima_conexion)}` : 'Todavía no se conectó'}
        </span>
      </div>
      <p className="tenue" style={{ margin: 0 }}>
        La conectó {p.conectada_por_nombre} {haceTexto(p.creada)} · {p.equipo}
      </p>
      {!p.duenio_activo && (
        <p className="pantalla-alerta">Quien la conectó ya no tiene acceso: la TV volvió a mostrar el QR. Desconectala y conectala de nuevo.</p>
      )}
      {p.duenio_activo && noSeMuestran.length > 0 && (
        <p className="pantalla-alerta">
          {noSeMuestran.map((d) => d.nombre).join(', ')} no se {noSeMuestran.length === 1 ? 'muestra' : 'muestran'}: {p.conectada_por_nombre} ya no ve {noSeMuestran.length === 1 ? 'esa agenda' : 'esas agendas'}.
        </p>
      )}

      {modo === 'agendas' && (
        <div className="pantalla-editor">
          {opciones ? <ElegirDepartamentos opciones={opcionesEditor} seleccion={seleccion} onCambio={setSeleccion} /> : <p className="tenue">Cargando…</p>}
          <div className="acciones">
            <button className="btn" disabled={guardando || !seleccionValida.length} onClick={() => guardar({ ids_departamento: seleccionValida })}>Guardar</button>
            <button className="btn btn-secondary" onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {modo === 'nombre' && (
        <form className="pantalla-editor en-linea" onSubmit={(e) => { e.preventDefault(); guardar({ nombre }) }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} aria-label="Nombre de la pantalla" autoFocus />
          <button className="btn" disabled={guardando || !nombre.trim() || nombre.trim() === p.nombre}>Guardar</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setNombre(p.nombre); setModo(null) }}>Cancelar</button>
        </form>
      )}
      {error && <p className="error-texto">{error}</p>}

      {!modo && (p.puede_editar || p.puede_desconectar) && (
        <div className="acciones">
          {p.puede_editar && <button className="btn btn-secondary btn-chico" onClick={abrirAgendas}>Cambiar agendas</button>}
          {p.puede_editar && <button className="btn btn-secondary btn-chico" onClick={() => { setError(''); setModo('nombre') }}>Renombrar</button>}
          {p.puede_desconectar && <button className="btn btn-secondary btn-chico" disabled={guardando} onClick={desconectar}>Desconectar</button>}
        </div>
      )}
    </li>
  )
}

export default function Pantallas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const codigoUrl = searchParams.get('codigo') || ''
  const [pantallas, setPantallas] = useState(null)
  const [opciones, setOpciones] = useState(null)
  const [aviso, setAviso] = useState(null)

  async function cargarLista() {
    try {
      setPantallas(await pantallasApi.listar())
    } catch {
      setPantallas([])
    }
  }
  useEffect(() => { cargarLista() }, [])

  function cargarOpciones() {
    if (!opciones) pantallasApi.departamentos().then(setOpciones).catch(() => setOpciones([]))
  }

  function avisar(texto) {
    setAviso(texto)
    setTimeout(() => setAviso((a) => (a === texto ? null : a)), 10000)
  }

  return (
    <div className="pantallas">
      <div>
        <h2 style={{ margin: '0 0 0.25rem' }}>Pantallas</h2>
        <p className="tenue" style={{ margin: 0 }}>
          Las TVs de la oficina que muestran agendas. Cada una muestra lo que puede ver quien la conectó.
        </p>
      </div>
      {aviso && <div className="aviso aviso-ok" role="status">{aviso}</div>}

      <ConectarPantalla
        codigoInicial={codigoUrl}
        onListo={(texto) => { avisar(texto); setSearchParams({}, { replace: true }); cargarLista() }}
        onCerrar={() => setSearchParams({}, { replace: true })}
      />

      <section>
        <h3 style={{ margin: '0 0 0.6rem' }}>Pantallas conectadas</h3>
        {pantallas === null ? (
          <p className="tenue">Cargando…</p>
        ) : !pantallas.length ? (
          <p className="tenue">Todavía no hay pantallas conectadas que puedas ver.</p>
        ) : (
          <ul className="pantallas-lista">
            {pantallas.map((p) => (
              <TarjetaPantalla key={p.id} p={p} opciones={opciones} cargarOpciones={cargarOpciones} onCambio={cargarLista} avisar={avisar} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
