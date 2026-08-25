import { useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import { useAuthStore } from '../store/authStore.js'
import { instanciasApi, localesApi } from '../api/recursos.js'
import AgendaAgrupada from '../components/AgendaAgrupada.jsx'
import SinAsignacion from './SinAsignacion.jsx'
import { clasificarInstancia } from '../lib/vencimiento.js'

const VISTAS = [
  { id: 'agenda', etiqueta: 'Agenda' },
  { id: 'semana', etiqueta: 'Semana (L-V)' },
  { id: 'mes', etiqueta: 'Mes' }
]

const COLOR_ESTADO = { pendiente: '#e0b83f', vencida: '#e05c3f', realizada: '#3fb66a' }

function semanaActualLunesAViernes() {
  const hoy = new Date()
  const diaIso = hoy.getDay() === 0 ? 7 : hoy.getDay()
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - (diaIso - 1))
  const viernes = new Date(lunes)
  viernes.setDate(lunes.getDate() + 4)
  return { desde: lunes.toISOString().slice(0, 10), hasta: viernes.toISOString().slice(0, 10) }
}

export default function Calendario() {
  const departamento = useAuthStore((s) => s.departamento)
  const [vista, setVista] = useState('agenda')
  const [eventos, setEventos] = useState([])
  const [mapaLocales, setMapaLocales] = useState(new Map())
  const [rango, setRango] = useState(semanaActualLunesAViernes())
  const [marcando, setMarcando] = useState(null)

  useEffect(() => {
    localesApi.listar().then((locales) => setMapaLocales(new Map(locales.map((l) => [l.id, l.nombre]))))
  }, [])

  async function cargar(desde, hasta) {
    if (!departamento) return
    const { items } = await instanciasApi.listarRango({ departamento: departamento.id, desde, hasta })
    setEventos(items)
  }

  useEffect(() => {
    if (departamento && rango) cargar(rango.desde, rango.hasta)
  }, [departamento, rango])

  function onDatesSet(info) {
    const desde = info.startStr.slice(0, 10)
    const hasta = info.endStr.slice(0, 10)
    // Evita un loop infinito: FullCalendar puede re-emitir datesSet cuando
    // cambia la referencia de `events`, aunque las fechas sean las mismas --
    // solo actualizar el estado si el rango realmente cambio.
    setRango((actual) => (actual?.desde === desde && actual?.hasta === hasta ? actual : { desde, hasta }))
  }

  // `idDepto` viene del propio evento (extendedProperties.id_departamento).
  // Acá siempre coincide con el del store, pero dejarlo explícito es lo que
  // permite reusar AgendaAgrupada desde "Mis tareas".
  async function marcar(instanceId, idDepto) {
    setMarcando(instanceId)
    try {
      await instanciasApi.marcar(instanceId, idDepto || departamento.id)
      await cargar(rango.desde, rango.hasta)
    } finally {
      setMarcando(null)
    }
  }

  // Memoizado: FullCalendar recalcula su rango visible cuando `events` cambia
  // de referencia, y eso puede re-disparar datesSet -- sin esto, cada render
  // crea un array nuevo y arriesga un loop con el guard de onDatesSet.
  const fcEventos = useMemo(
    () =>
      eventos.map((ev) => {
        // Mismo criterio (y misma zona horaria) que el resto de la app.
        const color = COLOR_ESTADO[clasificarInstancia(ev).estado]
        return {
          id: ev.id,
          title: ev.summary,
          start: ev.start?.dateTime || ev.start?.date,
          allDay: !ev.start?.dateTime,
          backgroundColor: color,
          borderColor: color
        }
      }),
    [eventos]
  )

  if (!departamento) return <SinAsignacion />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Agenda — {departamento.nombre}</h2>
          {departamento.id_calendar_google && (
            <a
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(departamento.id_calendar_google)}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)' }}
            >
              Ver en Google Calendar ↗
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {VISTAS.map((v) => (
            <button
              key={v.id}
              className={vista === v.id ? 'btn' : 'btn btn-secondary'}
              onClick={() => setVista(v.id)}
            >
              {v.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {vista === 'agenda' && (
        <AgendaAgrupada eventos={eventos} mapaLocales={mapaLocales} onMarcar={marcar} marcando={marcando} />
      )}

      {vista === 'semana' && (
        <div className="card">
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridWeek"
            hiddenDays={[0, 6]}
            eventDisplay="list-item"
            events={fcEventos}
            datesSet={onDatesSet}
            eventClick={(info) => marcar(info.event.id)}
            height="auto"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          />
        </div>
      )}

      {vista === 'mes' && (
        <div className="card">
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            eventDisplay="list-item"
            events={fcEventos}
            datesSet={onDatesSet}
            eventClick={(info) => marcar(info.event.id)}
            height="auto"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          />
        </div>
      )}
    </div>
  )
}
