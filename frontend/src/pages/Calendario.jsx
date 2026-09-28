import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import esLocale from '@fullcalendar/core/locales/es'
import { useAuthStore } from '../store/authStore.js'
import { instanciasApi, localesApi, departamentosApi, usuariosApi, asignacionesApi } from '../api/recursos.js'
import AgendaAgrupada from '../components/AgendaAgrupada.jsx'
import DetalleTarea from '../components/DetalleTarea.jsx'
import NuevaTarea, { mensajeDeCreacion } from './agendas/NuevaTarea.jsx'
import SemanaTablero from '../components/SemanaTablero.jsx'
import TableroKanban from '../components/TableroKanban.jsx'
import Cronograma from '../components/Cronograma.jsx'
import EtiquetasDependencia from '../components/EtiquetasDependencia.jsx'
import { aTarea } from '../lib/agrupar.js'
import SinAsignacion from './SinAsignacion.jsx'
import { AvisoPrerrequisitos } from './MisTareas.jsx'
import { clasificarInstancia, hoyEnArgentina } from '../lib/vencimiento.js'
import { usePermisos } from '../lib/permisos.js'
import { infoDepartamentos } from '../lib/colores-depto.js'
import { fechaHumana } from '../lib/agenda-texto.js'
import { todasLasEtiquetas } from '../lib/dependencias.js'
import { useMedia, CONSULTA_CELULAR, CONSULTA_TACTIL } from '../lib/pantalla.js'

// Tablero (listas por departamento, estilo Trello), Calendario (el mes),
// Agenda (la semana por dia y local), Cronograma (linea de tiempo por
// departamento) y Semana (armada como el kiosko).
const VISTAS = [
  { id: 'tablero', etiqueta: 'Tablero' },
  { id: 'mes', etiqueta: 'Calendario' },
  { id: 'agenda', etiqueta: 'Agenda' },
  { id: 'cronograma', etiqueta: 'Cronograma' },
  { id: 'semana', etiqueta: 'Semana (L-V)' }
]
// La ultima vista elegida se recuerda en este navegador.
const CLAVE_VISTA = 'dc_plataforma_vista'
function vistaGuardada() {
  try {
    const v = localStorage.getItem(CLAVE_VISTA)
    return VISTAS.some((x) => x.id === v) ? v : 'agenda'
  } catch {
    return 'agenda'
  }
}
// Cronograma: dos semanas a la vista, se avanza de a una.
const CRONO_DIAS = 14
// Tablero: las atrasadas de los ultimos 60 dias y lo pendiente de los proximos 30.
const TABLERO_ATRAS = 60
const TABLERO_ADELANTE = 30

const COLOR_ESTADO = { pendiente: '#e0b83f', vencida: '#e05c3f', realizada: '#3fb66a', no_aplica: '#6b7686' }

// Valor del selector que junta todos los departamentos de la persona.
const TODOS = ''
// Separador del id de evento en FullCalendar: el mismo id de instancia puede
// repetirse entre calendarios de departamentos distintos.
const SEP = '::'

// Fecha local (no toISOString, que es UTC: despues de las 21:00 corria el
// rango un dia).
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "hasta" es EXCLUSIVO en la API de Calendar: se manda el sabado para que
// entre el viernes (antes la vista inicial no mostraba el viernes).
// Sabado y domingo ya no queda nada de la semana laboral: se muestra la que
// arranca el lunes que viene.
function semanaActualLunesAViernes() {
  const hoy = new Date()
  const diaIso = hoy.getDay() === 0 ? 7 : hoy.getDay()
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - (diaIso - 1) + (diaIso >= 6 ? 7 : 0))
  const sabado = new Date(lunes)
  sabado.setDate(lunes.getDate() + 5)
  return { desde: isoLocal(lunes), hasta: isoLocal(sabado) }
}

function sumarDiasISO(iso, n) {
  const [a, m, d] = iso.split('-').map(Number)
  return isoLocal(new Date(a, m - 1, d + n))
}

// "Del 28 sept al 11 oct"
function textoRango(desdeISO, dias) {
  const f = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) }
  return `Del ${f(desdeISO)} al ${f(sumarDiasISO(desdeISO, dias - 1))}`
}

// "Semana del 28 sep al 2 oct"
function textoSemana(lunesISO) {
  const f = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) }
  return `Semana del ${f(lunesISO)} al ${f(sumarDiasISO(lunesISO, 4))}`
}

// Lo que pide la vista Semana (tablero estilo kiosko): 60 dias hacia atras
// para las atrasadas, y hasta el viernes de la semana siguiente.
function rangoTablero(lunesISO) {
  const desdeAtrasadas = sumarDiasISO(hoyEnArgentina(), -60)
  return { desde: desdeAtrasadas < lunesISO ? desdeAtrasadas : lunesISO, hasta: sumarDiasISO(lunesISO, 12) }
}

function fechaDe(ev) {
  return ev.start?.date || String(ev.start?.dateTime || '').slice(0, 10)
}

// "Mi agenda": las tareas de todos los departamentos de la persona juntas
// (decision del usuario: quien esta en varios grupos arranca viendo todo, con
// el departamento marcado por color) o de uno solo. En Semana y Mes, quien
// es MANAGER u OWNER del grupo puede arrastrar una tarea a otro dia y tocar un
// dia vacio para crear una tarea ahi.
export default function Calendario() {
  const propios = useAuthStore((s) => s.departamentos)
  const esAdminGlobal = useAuthStore((s) => s.esAdminGlobal)
  const { puede, filtrar } = usePermisos()

  const [todosDeptos, setTodosDeptos] = useState([])
  // Direccion y admin eligen entre todos; el resto, entre los suyos.
  const opciones = esAdminGlobal ? todosDeptos : propios
  const [idElegido, setIdElegido] = useState(esAdminGlobal || propios.length > 1 ? TODOS : propios[0]?.id || TODOS)
  const idsVisibles = idElegido === TODOS ? opciones.map((d) => d.id) : [idElegido]
  const varios = idsVisibles.length > 1
  const elegido = opciones.find((d) => d.id === idElegido)

  const [vista, setVistaEstado] = useState(vistaGuardada)
  function setVista(v) {
    setVistaEstado(v)
    try { localStorage.setItem(CLAVE_VISTA, v) } catch { /* sin almacenamiento: no se recuerda */ }
  }
  // En un celular el mes no entra (cada dia queda de ~43px y no se lee el
  // nombre de la tarea): ahi solo Agenda y Semana, que son listas por dia.
  const celular = useMedia(CONSULTA_CELULAR)
  const tactil = useMedia(CONSULTA_TACTIL)
  const vistas = celular ? VISTAS.filter((v) => v.id !== 'mes') : VISTAS
  useEffect(() => {
    if (celular && vista === 'mes') setVista('agenda')
  }, [celular, vista])
  const [eventos, setEventos] = useState([])
  const [locales, setLocales] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [rango, setRango] = useState(semanaActualLunesAViernes())
  // Lunes de la semana que muestra la vista Semana (arranca en la actual).
  const lunesActual = semanaActualLunesAViernes().desde
  const [semanaLunes, setSemanaLunes] = useState(lunesActual)
  const [cronoDesde, setCronoDesde] = useState(lunesActual)
  // Grupo de tareas iguales del mismo dia en el Cronograma ("CMV ×12").
  const [grupo, setGrupo] = useState(null)
  const [marcando, setMarcando] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [abierta, setAbierta] = useState(null)
  const [nueva, setNueva] = useState(null)
  const [cargando, setCargando] = useState(false)
  // id_asignacion -> departamento dueño de la tarea: con eso, una tarea
  // compartida se muestra con la etiqueta de su dueño (Sueldos = RRHH aunque
  // tambien este en el calendario de Administracion).
  const [duenioPorAsignacion, setDuenioPorAsignacion] = useState(() => new Map())
  // Cache por seleccion+rango: volver a algo ya visto es instantaneo (y se
  // revalida en segundo plano). Y un contador de pedidos para descartar
  // respuestas viejas: antes, cambiar rapido de departamento o de mes dejaba
  // que una respuesta atrasada pisara a la ultima.
  const cache = useRef(new Map())
  const ultimoPedido = useRef(0)

  useEffect(() => {
    localesApi.listar().then(setLocales)
    departamentosApi.listar().then(setTodosDeptos)
    asignacionesApi.listar()
      .then((lista) => setDuenioPorAsignacion(new Map(lista.map((a) => [a.id, a.tarea?.id_departamento]))))
      .catch(() => {})
  }, [])

  const mapaLocales = useMemo(() => new Map(locales.map((l) => [l.id, l.nombre])), [locales])
  const grupos = useMemo(() => [...new Set(locales.map((l) => l.grupo).filter(Boolean))].sort(), [locales])
  // Color por departamento, estable: sale de TODOS los activos.
  const deptos = useMemo(() => infoDepartamentos(todosDeptos.length ? todosDeptos : propios), [todosDeptos, propios])
  const claveSeleccion = idsVisibles.join(',')

  // `mantener`: despues de marcar/mover se refresca sin vaciar la pantalla.
  async function cargar(desde, hasta, { forzar = false, mantener = false } = {}) {
    if (!idsVisibles.length) return
    const clave = `${claveSeleccion}|${desde}|${hasta}`
    const pedido = ++ultimoPedido.current
    const enCache = cache.current.get(clave)
    if (enCache && !forzar) setEventos(enCache)
    else if (!enCache && !mantener) setEventos([]) // nunca mostrar lo de OTRA seleccion mientras carga
    setCargando(true)
    try {
      const porDepto = await Promise.all(idsVisibles.map((id) =>
        instanciasApi.listarRango({ departamento: id, desde, hasta })
          .then(({ items }) => items.map((ev) => ({ ...ev, __depto: id })))
          // Un departamento sin calendario (o sin permiso) no tumba a los demas.
          .catch(() => [])
      ))
      // Todas las copias; cual se muestra de cada tarea compartida se decide
      // al renderizar (ver `visibles`), cuando ya se sabe de quien es cada una.
      const items = porDepto.flat()
      cache.current.set(clave, items)
      if (pedido === ultimoPedido.current) setEventos(items)
    } finally {
      if (pedido === ultimoPedido.current) setCargando(false)
    }
  }
  // Despues de marcar, mover o crear: todo lo cacheado quedo viejo (una tarea
  // puede estar en varias selecciones), asi que se descarta entero.
  function recargar() {
    cache.current.clear()
    return cargar(rango.desde, rango.hasta, { forzar: true, mantener: true })
  }

  useEffect(() => {
    if (idsVisibles.length && rango) cargar(rango.desde, rango.hasta)
  }, [claveSeleccion, rango?.desde, rango?.hasta])

  // Cada vista pide su propio rango: Agenda la semana en curso, Semana el
  // tablero estilo kiosko, y Mes lo que diga FullCalendar (ver onDatesSet).
  useEffect(() => {
    if (vista === 'agenda') setRango(semanaActualLunesAViernes())
    if (vista === 'semana') setRango(rangoTablero(semanaLunes))
    if (vista === 'tablero') {
      const hoy = hoyEnArgentina()
      setRango({ desde: sumarDiasISO(hoy, -TABLERO_ATRAS), hasta: sumarDiasISO(hoy, TABLERO_ADELANTE + 1) })
    }
    if (vista === 'cronograma') setRango({ desde: cronoDesde, hasta: sumarDiasISO(cronoDesde, CRONO_DIAS) })
  }, [vista, semanaLunes, cronoDesde])

  function onDatesSet(info) {
    const desde = info.startStr.slice(0, 10)
    const hasta = info.endStr.slice(0, 10)
    // Evita un loop infinito: FullCalendar puede re-emitir datesSet cuando
    // cambia la referencia de `events`, aunque las fechas sean las mismas.
    setRango((actual) => (actual?.desde === desde && actual?.hasta === hasta ? actual : { desde, hasta }))
  }

  function avisar(texto, { tono = 'ok', deshacer = null } = {}) {
    setMensaje({ texto, tono, deshacer })
    // Con "Deshacer" queda mas tiempo: 8 s no alcanzan para darse cuenta y volver.
    setTimeout(() => setMensaje((m) => (m?.texto === texto ? null : m)), deshacer ? 15000 : 8000)
  }

  async function marcar(instanceId, idDepto) {
    setMarcando(instanceId)
    try {
      const r = await instanciasApi.marcar(instanceId, idDepto)
      setAviso(r?.avisos?.length ? r.avisos : null)
      await recargar()
    } finally {
      setMarcando(null)
    }
  }

  async function noAplica(instanceId, idDepto, motivo) {
    await instanciasApi.noAplica(instanceId, idDepto, motivo)
    await recargar()
  }

  async function reprogramar(instanceId, idDepto, fecha, motivo) {
    await instanciasApi.reprogramar(instanceId, idDepto, fecha, motivo)
    await recargar()
  }

  // Arrastrar en Semana/Mes = "Cambiar fecha" de esa ocurrencia, con la opcion
  // de deshacer (la instancia conserva su id aunque cambie de dia). La tarea
  // pasa al dia nuevo en pantalla en el acto (junto con sus copias en otros
  // departamentos, que el backend mueve igual) y despues se confirma recargando.
  async function moverTarea({ idDepto, instanceId, titulo, nuevaFecha, fechaVieja, deshaciendo = false }) {
    const movido = eventos.find((e) => e.__depto === idDepto && e.id === instanceId)
    const idAsignacion = movido?.extendedProperties?.private?.id_asignacion
    setEventos((prev) => prev.map((e) => {
      const mismaTarea = e.__depto === idDepto && e.id === instanceId
      const copia = idAsignacion && e.extendedProperties?.private?.id_asignacion === idAsignacion && fechaDe(e) === fechaVieja
      return mismaTarea || copia ? { ...e, start: { date: nuevaFecha }, end: { date: sumarDiasISO(nuevaFecha, 1) } } : e
    }))
    try {
      await instanciasApi.reprogramar(instanceId, idDepto, nuevaFecha)
      if (deshaciendo) avisar(`"${titulo}" volvió al ${fechaHumana(nuevaFecha)}.`)
      else {
        avisar(`"${titulo}" pasó al ${fechaHumana(nuevaFecha)}.`, {
          deshacer: () => {
            setMensaje(null)
            return moverTarea({ idDepto, instanceId, titulo, nuevaFecha: fechaVieja, fechaVieja: nuevaFecha, deshaciendo: true }).catch(() => {})
          }
        })
      }
    } catch (err) {
      avisar(err.response?.data?.error || 'No se pudo mover la tarea.', { tono: 'mal' })
      throw err
    } finally {
      recargar()
    }
  }

  async function alSoltar(info) {
    const [idDepto, instanceId] = info.event.id.split(SEP)
    try {
      await moverTarea({ idDepto, instanceId, titulo: info.event.title, nuevaFecha: info.event.startStr.slice(0, 10), fechaVieja: info.oldEvent.startStr.slice(0, 10) })
    } catch {
      info.revert()
    }
  }

  const editables = filtrar('editar', opciones)
  const puedeCrear = editables.length > 0

  function abrirNueva(fecha) {
    if (!puedeCrear) return
    if (!usuarios.length) usuariosApi.listar().then(setUsuarios)
    setNueva({ fecha })
  }
  const usuariosDe = (id) => usuarios.filter((u) => (u.departamentos || [u.id_departamento]).includes(id))

  // Una tarea compartida entre dos departamentos visibles aparece una vez por
  // calendario: se muestra una sola. Gana la copia donde la persona puede
  // hacer mas (marcar en una copia propaga a las otras) y, a igual permiso, la
  // del departamento dueño (Sueldos se ve como RRHH, no como Administracion).
  const visibles = useMemo(() => {
    const puntaje = (ev) => (puede('editar', ev.__depto) ? 2 : 0) +
      (duenioPorAsignacion.get(ev.extendedProperties?.private?.id_asignacion) === ev.__depto ? 1 : 0)
    const porClave = new Map()
    for (const ev of eventos) {
      const idAsignacion = ev.extendedProperties?.private?.id_asignacion
      const k = idAsignacion ? `${idAsignacion}|${fechaDe(ev)}` : `${ev.__depto}${SEP}${ev.id}`
      const previa = porClave.get(k)
      if (!previa || puntaje(ev) > puntaje(previa)) porClave.set(k, ev)
    }
    return [...porClave.values()]
  }, [eventos, duenioPorAsignacion])

  // Memoizado: FullCalendar recalcula su rango visible cuando `events` cambia
  // de referencia, y eso puede re-disparar datesSet.
  const fcEventos = useMemo(
    () =>
      visibles.map((ev) => {
        const { estado } = clasificarInstancia(ev)
        const abiertaAun = estado === 'pendiente' || estado === 'vencida'
        return {
          id: `${ev.__depto}${SEP}${ev.id}`,
          title: ev.extendedProperties?.private?.nombre_tarea
            ? ev.summary?.replace(/^[✓⊘] /, '') || ev.extendedProperties.private.nombre_tarea
            : ev.summary,
          start: ev.start?.dateTime || ev.start?.date,
          allDay: !ev.start?.dateTime,
          // Solo se arrastra lo que sigue abierto, y si el rol lo permite.
          startEditable: abiertaAun && puede('editar', ev.__depto),
          durationEditable: false,
          // ⏳ espera a otra, 🔗 otra la espera (ver EtiquetasDependencia).
          extendedProps: { estado, depto: deptos.get(ev.__depto), espera: !!ev.espera_a?.length, frena: !!ev.la_espera?.length }
        }
      }),
    [visibles, deptos]
  )

  function contenidoEvento(arg) {
    const { estado, depto, espera, frena } = arg.event.extendedProps
    const marca = espera ? '⏳ ' : frena ? '🔗 ' : ''
    const nota = espera ? ' (espera a otra tarea)' : frena ? ' (otra tarea la espera)' : ''
    return (
      <span className={`fc-tarea estado-${estado}`} title={`${depto ? `${depto.nombre}: ` : ''}${arg.event.title}${nota}`}>
        <span className="fc-punto" style={{ background: COLOR_ESTADO[estado] }} />
        {varios && depto && <span className="chip-depto" style={{ color: depto.color, background: `${depto.color}26` }}>{depto.abreviatura}</span>}
        <span className="fc-titulo">{marca}{arg.event.title}</span>
      </span>
    )
  }

  function abrirDetalle(idEvento) {
    const ev = visibles.find((e) => `${e.__depto}${SEP}${e.id}` === idEvento)
    if (ev) setAbierta({ ...aTarea(ev, mapaLocales), idDepartamento: ev.__depto, departamento: deptos.get(ev.__depto)?.nombre })
  }

  // La casilla del Tablero: marcar no se puede deshacer, asi que se confirma.
  // Si todavia espera a otra tarea se dice en la misma pregunta: la
  // confirmacion ya existia, asi que avisar no suma un paso (y no bloquea).
  function marcarDesdeTablero(t) {
    const pregunta = t.esperaA?.length
      ? `"${t.titulo} — ${t.local}" espera a ${todasLasEtiquetas(t.esperaA, t.local)}, que todavía no está hecha. ¿Marcarla igual? No se puede deshacer.`
      : `¿Marcar "${t.titulo} — ${t.local}" como hecha? No se puede deshacer.`
    if (!window.confirm(pregunta)) return
    marcar(t.id, t.idDepartamento)
  }

  // Con el dedo, el arrastre de Semana no anda en la mayoria de los celulares,
  // y en Mes (FullCalendar) pide mantener apretado.
  const textoAyuda = {
    tablero: 'Tocá una tarjeta para ver el detalle; la casilla la marca hecha. Están las atrasadas de los últimos 60 días y lo pendiente de los próximos 30, por vencimiento.',
    cronograma: 'Una fila por departamento y un día por columna. Tocá una tarea para ver el detalle; ×N quiere decir que se hace en N locales.',
    semana: puedeCrear && (tactil
      ? 'Tocá una tarea para ver el detalle o cambiarle la fecha, o usá + para crear una tarea ese día.'
      : 'Arrastrá una tarea a otro día para moverla (también desde Atrasadas), o usá + para crear una tarea ese día.'),
    mes: puedeCrear && (tactil
      ? 'Mantené apretada una tarea para arrastrarla a otro día, o tocá un día para crear una tarea ahí.'
      : 'Arrastrá una tarea pendiente a otro día para moverla, o tocá un día para crear una tarea ahí.')
  }[vista]

  if (!esAdminGlobal && !propios.length) return <SinAsignacion />

  const propsCalendario = {
    plugins: [dayGridPlugin, interactionPlugin],
    eventDisplay: 'block',
    events: fcEventos,
    datesSet: onDatesSet,
    eventClick: (info) => abrirDetalle(info.event.id),
    eventContent: contenidoEvento,
    editable: true,
    eventDrop: alSoltar,
    dateClick: (info) => abrirNueva(info.dateStr),
    height: 'auto',
    locale: esLocale,
    firstDay: 1,
    headerToolbar: { left: 'prev,next today', center: 'title', right: '' }
  }

  return (
    <div>
      <div className="agenda-cab">
        <div>
          <h2 style={{ margin: 0, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Agenda</span>
            <span className="agenda-guion" aria-hidden="true">—</span>
            {opciones.length > 1 ? (
              <select value={idElegido} onChange={(e) => setIdElegido(e.target.value)} style={{ fontSize: '1rem', padding: '0.3rem 2rem 0.3rem 0.6rem' }} aria-label="Departamento">
                <option value={TODOS}>{esAdminGlobal ? 'Todos los departamentos' : 'Todos mis departamentos'}</option>
                {opciones.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            ) : (
              opciones[0]?.nombre || ''
            )}
            {cargando && <span className="cargando-chip" role="status">Actualizando…</span>}
          </h2>
          {varios ? (
            <div className="leyenda-deptos">
              {idsVisibles.map((id) => deptos.get(id)).filter(Boolean).map((d) => (
                <span key={d.nombre}><span className="chip-depto" style={{ color: d.color, background: `${d.color}26` }}>{d.abreviatura}</span>{d.nombre}</span>
              ))}
            </div>
          ) : elegido?.id_calendar_google && (
            <a
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(elegido.id_calendar_google)}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.8rem', color: 'var(--texto-tenue)' }}
            >
              Ver en Google Calendar ↗
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {puedeCrear && <button className="btn" onClick={() => abrirNueva(null)}>+ Nueva tarea</button>}
          {vistas.map((v) => (
            <button key={v.id} className={vista === v.id ? 'btn' : 'btn btn-secondary'} onClick={() => setVista(v.id)}>
              {v.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {textoAyuda && <p className="tenue" style={{ margin: '0 0 0.6rem' }}>{textoAyuda}</p>}
      {mensaje && (
        <div className={`aviso aviso-${mensaje.tono}`} role="status" style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span>{mensaje.texto}</span>
          {mensaje.deshacer && <button className="btn btn-secondary btn-chico" onClick={mensaje.deshacer}>Deshacer</button>}
        </div>
      )}
      {aviso && <AvisoPrerrequisitos avisos={aviso} onCerrar={() => setAviso(null)} />}

      {vista === 'agenda' && (
        <AgendaAgrupada
          eventos={visibles.map((ev) => ({ ...ev, extendedProperties: { ...ev.extendedProperties, private: { ...ev.extendedProperties?.private, id_departamento: ev.__depto } } }))}
          mapaLocales={mapaLocales}
          onMarcar={marcar}
          onNoAplica={noAplica}
          onReprogramar={reprogramar}
          onEditado={recargar}
          marcando={marcando}
          deptos={deptos}
          mostrarDepto={varios}
        />
      )}

      {vista === 'semana' && (
        <>
          <div className="st-nav">
            <button className="btn btn-secondary" onClick={() => setSemanaLunes((l) => sumarDiasISO(l, -7))} aria-label="Semana anterior">‹</button>
            <strong>{textoSemana(semanaLunes)}</strong>
            <button className="btn btn-secondary" onClick={() => setSemanaLunes((l) => sumarDiasISO(l, 7))} aria-label="Semana siguiente">›</button>
            {semanaLunes !== lunesActual && <button className="btn btn-secondary btn-chico" onClick={() => setSemanaLunes(lunesActual)}>Hoy</button>}
          </div>
          <SemanaTablero
            eventos={visibles}
            lunes={semanaLunes}
            hoyISO={hoyEnArgentina()}
            mapaLocales={mapaLocales}
            deptos={deptos}
            mostrarDepto={varios}
            puedeMover={(ev) => puede('editar', ev.__depto)}
            onAbrir={setAbierta}
            onMover={(t, fecha) => moverTarea({ idDepto: t.idDepartamento, instanceId: t.id, titulo: `${t.titulo} — ${t.local}`, nuevaFecha: fecha, fechaVieja: t.fechaISO }).catch(() => {})}
            puedeCrear={puedeCrear}
            onCrear={abrirNueva}
          />
        </>
      )}

      {vista === 'tablero' && (
        <TableroKanban
          eventos={visibles}
          idsVisibles={idsVisibles}
          deptos={deptos}
          mapaLocales={mapaLocales}
          hoyISO={hoyEnArgentina()}
          puedeMarcar={(id) => puede('marcar', id)}
          onAbrir={setAbierta}
          onMarcar={marcarDesdeTablero}
          marcando={marcando}
        />
      )}

      {vista === 'cronograma' && (
        <>
          <div className="st-nav">
            <button className="btn btn-secondary" onClick={() => setCronoDesde((l) => sumarDiasISO(l, -7))} aria-label="Semana anterior">‹</button>
            <strong>{textoRango(cronoDesde, CRONO_DIAS)}</strong>
            <button className="btn btn-secondary" onClick={() => setCronoDesde((l) => sumarDiasISO(l, 7))} aria-label="Semana siguiente">›</button>
            {cronoDesde !== lunesActual && <button className="btn btn-secondary btn-chico" onClick={() => setCronoDesde(lunesActual)}>Hoy</button>}
          </div>
          <Cronograma
            eventos={visibles}
            desdeISO={cronoDesde}
            cantidadDias={CRONO_DIAS}
            idsVisibles={idsVisibles}
            deptos={deptos}
            mapaLocales={mapaLocales}
            hoyISO={hoyEnArgentina()}
            onAbrir={setAbierta}
            onAbrirGrupo={setGrupo}
          />
        </>
      )}

      {grupo && (
        <div className="detalle-fondo" onClick={() => setGrupo(null)}>
          <div className="card detalle-tarea" role="dialog" aria-label={grupo.titulo} onClick={(e) => e.stopPropagation()}>
            <div className="detalle-encabezado">
              <div>
                <h3 style={{ margin: 0 }}>{grupo.titulo}</h3>
                <p className="detalle-sub">{fechaHumana(grupo.fecha)} · {grupo.tareas.length} locales</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setGrupo(null)} aria-label="Cerrar">✕</button>
            </div>
            <ul className="tarea-bullets">
              {grupo.tareas.map((t) => (
                <li
                  key={t.clave}
                  className={`${t.estado} clickable`}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setGrupo(null); setAbierta(t) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setGrupo(null); setAbierta(t) } }}
                >
                  <span className="tarea-texto"><span>{t.local}</span><EtiquetasDependencia tarea={t} compacta /></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {vista === 'mes' && (
        <div className="card calendario-fc">
          <FullCalendar {...propsCalendario} initialView="dayGridMonth" />
        </div>
      )}

      {abierta && (
        <DetalleTarea
          tarea={abierta}
          onCerrar={() => setAbierta(null)}
          onMarcar={marcar}
          onNoAplica={noAplica}
          onReprogramar={reprogramar}
          onEditado={recargar}
        />
      )}

      {nueva && (
        <div className="detalle-fondo" onClick={() => setNueva(null)}>
          <div className="modal-ancho" onClick={(e) => e.stopPropagation()}>
            <NuevaTarea
              departamentos={editables}
              idDepartamentoInicial={idElegido !== TODOS ? idElegido : editables[0]?.id}
              locales={locales}
              grupos={grupos}
              usuariosDe={usuariosDe}
              fechaInicial={nueva.fecha}
              onCerrar={() => setNueva(null)}
              onCreada={async (r) => {
                setNueva(null)
                avisar(mensajeDeCreacion(r), { tono: r.errores.length ? 'mal' : 'ok' })
                await recargar()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
