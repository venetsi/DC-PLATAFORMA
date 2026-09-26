import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { instanciasApi, localesApi } from '../api/recursos.js'
import AgendaAgrupada from '../components/AgendaAgrupada.jsx'
import SinAsignacion from './SinAsignacion.jsx'

// "Mis tareas": lo que le toca a esta persona, en vez de la agenda entera del
// departamento (esa es la vista "Mi agenda"). El backend decide el alcance
// -- ver GET /api/instancias/mias -- y devuelve los eventos crudos, asi que
// acá se reusa el mismo AgendaAgrupada que la otra pantalla.
export default function MisTareas() {
  const departamento = useAuthStore((s) => s.departamento)
  const [data, setData] = useState(null)
  const [mapaLocales, setMapaLocales] = useState(new Map())
  const [soloMias, setSoloMias] = useState(false)
  const [marcando, setMarcando] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState(null)

  useEffect(() => {
    localesApi.listar().then((locales) => setMapaLocales(new Map(locales.map((l) => [l.id, l.nombre]))))
  }, [])

  async function cargar(only = soloMias) {
    setCargando(true)
    try {
      setData(await instanciasApi.mias({ soloMias: only }))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  function alternarSoloMias() {
    const nuevo = !soloMias
    setSoloMias(nuevo)
    cargar(nuevo)
  }

  // El departamento sale del evento, no del store: es lo que permite reusar
  // esta pantalla el día que muestre tareas de más de un calendario.
  async function marcar(instanceId, idDepto) {
    setMarcando(instanceId)
    try {
      const r = await instanciasApi.marcar(instanceId, idDepto || departamento.id)
      // El aviso va DESPUÉS de marcar, no un confirm() antes: la decisión fue
      // avisar sin bloquear, y un modal de confirmación es bloqueo con otro nombre.
      setAviso(r?.avisos?.length ? r.avisos : null)
      await cargar()
    } finally {
      setMarcando(null)
    }
  }

  if (!departamento) return <SinAsignacion />

  const resumen = data?.resumen
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          {/* El nombre del departamento va en el título a propósito: hoy la
              vista no cruza calendarios, y sin esto se leería como un bug. */}
          <h2 style={{ margin: 0 }}>Mis tareas — {departamento.nombre}</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)' }}>
            Últimos 60 días y las próximas 2 semanas
          </span>
        </div>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--texto-tenue)' }}>
          <input type="checkbox" checked={soloMias} onChange={alternarSoloMias} />
          Solo las que tengo asignadas
        </label>
      </div>

      {resumen && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <Contador valor={resumen.vencidas} etiqueta="Vencidas" color="var(--rojo)" />
          <Contador valor={resumen.pendientes} etiqueta="Pendientes" color="var(--amarillo)" />
          <Contador valor={resumen.realizadas} etiqueta="Realizadas" color="var(--verde)" />
        </div>
      )}

      {aviso && <AvisoPrerrequisitos avisos={aviso} onCerrar={() => setAviso(null)} />}

      {cargando && !data && <p style={{ color: 'var(--texto-tenue)' }}>Cargando…</p>}

      {data && data.items.length === 0 && (
        <p style={{ color: 'var(--texto-tenue)' }}>
          {soloMias
            ? 'No tenés tareas asignadas a tu nombre en este período.'
            : 'No hay tareas para vos en este período.'}
        </p>
      )}

      {data && data.items.length > 0 && (
        <AgendaAgrupada eventos={data.items} mapaLocales={mapaLocales} onMarcar={marcar} marcando={marcando} />
      )}
    </div>
  )
}

// La marca YA se aplicó cuando esto aparece: es informativo, no una pregunta.
export function AvisoPrerrequisitos({ avisos, onCerrar }) {
  return (
    <div
      className="card"
      style={{ borderColor: 'var(--amarillo)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}
    >
      <div style={{ fontSize: '0.85rem' }}>
        <strong style={{ color: 'var(--amarillo)' }}>Marcada, pero ojo:</strong>{' '}
        {avisos.length === 1 ? 'todavía no está hecha' : 'todavía no están hechas'}{' '}
        {avisos.map((a, i) => (
          <span key={a.id_asignacion}>
            {i > 0 && ', '}
            <strong>{a.nombre_tarea}</strong> — {a.departamento} ({a.local})
          </span>
        ))}
        .
      </div>
      <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={onCerrar}>
        Entendido
      </button>
    </div>
  )
}

function Contador({ valor, etiqueta, color }) {
  return (
    <div className="card" style={{ minWidth: 110, padding: '0.75rem 1rem' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color, lineHeight: 1 }}>{valor}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--texto-tenue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {etiqueta}
      </div>
    </div>
  )
}
