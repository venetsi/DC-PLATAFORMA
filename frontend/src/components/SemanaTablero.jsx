import { useState } from 'react'
import { aTarea, agruparPorGrupo, pieDeGrupo } from '../lib/agrupar.js'
import { clasificarInstancia } from '../lib/vencimiento.js'
import EtiquetasDependencia from './EtiquetasDependencia.jsx'
import Urgencia from './Urgencia.jsx'
import { pesoUrgencia } from '../lib/urgencia.js'

// Vista "Semana (L-V)" de Mi agenda con el mismo armado que el kiosko
// (kiosko/index.html): a la izquierda las atrasadas, despues lunes a viernes
// de la semana agrupados por local, y abajo la semana siguiente mas chica.
// Mismos criterios que routes/tv.js (ultimos 60 dias; el semaforo se pone rojo
// con cualquier atrasada; "no aplica" no se muestra), salvo que la columna
// Atrasadas junta todo lo vencido que no se ve en un dia de la semana.
//
// A diferencia del kiosko, aca se opera: tocar abre el detalle, quien puede
// editar arrastra una tarea a otro dia (tambien desde Atrasadas, para
// reprogramarla) y crea con el "+" de cada dia.

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']

function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d + n))
  return f.toISOString().slice(0, 10)
}
function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}
function nombreCorto(email) {
  return String(email || '').split('@')[0]
}

// "Tarea › Local", ordenadas por tarea y local (pedido del usuario: antes se
// agrupaba por local y el local quedaba como titulo aparte). Igual en el kiosko.
const porTareaYLocal = (a, b) => pesoUrgencia(a.prioridad) - pesoUrgencia(b.prioridad) || a.titulo.localeCompare(b.titulo) || a.local.localeCompare(b.local)

// Un grupo ("P&L › GRUPO TITA") lleva al lado cuantos locales junta.
function TareaYLocal({ t }) {
  return <><Urgencia prioridad={t.prioridad} />{t.titulo} <span className="sep-local">›</span> {t.local}{t.esGrupo && <span className="grupo-cuenta">×{t.tareas.length}</span>}</>
}

// Quien la hizo (si esta hecha) o quien la tiene a cargo (si no).
function personaDe(t) {
  if (t.esGrupo) return pieDeGrupo(t)
  return t.estado === 'realizada'
    ? (t.realizadaPor ? `✓ ${nombreCorto(t.realizadaPor)}` : '')
    : `→ ${t.asignadoA ? nombreCorto(t.asignadoA) : 'equipo'}`
}

// `grupoDeLocal` (Map id_local -> grupo): la misma tarea el mismo dia en varios
// locales del mismo grupo va en una sola linea. Tocarla abre el grupo
// (`onAbrirGrupo`); arrastrarla mueve todas las abiertas (`onMoverGrupo`).
export default function SemanaTablero({ eventos, lunes, hoyISO, mapaLocales, grupoDeLocal, deptos, mostrarDepto, puedeMover, onAbrir, onAbrirGrupo, onMover, onMoverGrupo, puedeCrear, onCrear }) {
  const [arrastrando, setArrastrando] = useState(null)
  const [sobre, setSobre] = useState(null)
  // Los grupos que se pintaron en este render, para encontrar el que se suelta.
  const gruposPintados = new Map()
  function agrupada(lista) {
    const items = agruparPorGrupo([...lista].sort(porTareaYLocal), grupoDeLocal).sort(porTareaYLocal)
    for (const item of items) if (item.esGrupo) gruposPintados.set(item.clave, item)
    return items
  }
  const abrir = (item) => (item.esGrupo ? onAbrirGrupo(item) : onAbrir(item))

  const diasEsta = DIAS.map((nombre, i) => ({ nombre, fecha: sumarDias(lunes, i) }))
  const diasProxima = DIAS.map((nombre, i) => ({ nombre, fecha: sumarDias(lunes, 7 + i) }))

  // Cada evento -> la tarea que se muestra (+ datos para arrastrar y abrir).
  const tareas = eventos
    .map((ev) => {
      const { estado } = clasificarInstancia(ev)
      if (estado === 'no_aplica') return null
      const t = aTarea(ev, mapaLocales, hoyISO)
      return {
        ...t,
        clave: `${ev.__depto}::${ev.id}`,
        idDepartamento: ev.__depto,
        departamento: deptos.get(ev.__depto)?.nombre,
        movible: (estado === 'pendiente' || estado === 'vencida') && puedeMover(ev),
        ev
      }
    })
    .filter(Boolean)

  // Atrasadas = todo lo vencido sin hacer que NO se ve en una columna de dia:
  // semanas anteriores, y tambien sabados y domingos (una vencida de fin de
  // semana si no, no aparecia en ningun lado). Las vencidas de lunes a viernes
  // de la semana a la vista quedan en su dia, en rojo, como en el kiosko.
  const fechasVisibles = new Set(diasEsta.map((d) => d.fecha))
  const atrasadas = tareas
    .filter((t) => t.estado === 'vencida' && !fechasVisibles.has(t.fechaISO))
    .sort((a, b) => a.fechaISO.localeCompare(b.fechaISO))
  const porFecha = (fecha) => tareas.filter((t) => t.fechaISO === fecha)

  // Numeros del dia, con el mismo criterio que el kiosko.
  const deHoy = porFecha(hoyISO)
  const pendientesHoy = deHoy.filter((t) => t.estado === 'pendiente').length
  const realizadasHoy = deHoy.filter((t) => t.estado === 'realizada').length
  const vencidas = tareas.filter((t) => t.estado === 'vencida').length
  const semaforo = vencidas > 0 ? 'rojo' : pendientesHoy > 0 ? 'amarillo' : 'verde'
  const textoSemaforo = { rojo: 'Hay atrasadas', amarillo: 'Pendientes para hoy', verde: 'Todo al día' }[semaforo]

  function soltarEn(fecha) {
    return {
      onDragOver: (e) => {
        if (!arrastrando) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (sobre !== fecha) setSobre(fecha)
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setSobre((s) => (s === fecha ? null : s))
      },
      onDrop: (e) => {
        e.preventDefault()
        const t = tareas.find((x) => x.clave === arrastrando) || gruposPintados.get(arrastrando)
        setArrastrando(null)
        setSobre(null)
        if (!t || t.fechaISO === fecha) return
        if (t.esGrupo) onMoverGrupo(t, fecha)
        else onMover(t, fecha)
      }
    }
  }

  // Funciones que devuelven JSX (no componentes definidos adentro): asi React
  // conserva los mismos nodos del DOM entre renders, y un arrastre en curso no
  // se corta cuando cambia el estado de "sobre que dia esta".
  function renderTarea(t, conAtraso) {
    const depto = mostrarDepto ? deptos.get(t.idDepartamento) : null
    const persona = personaDe(t)
    return (
      <li
        key={t.clave}
        className={`${t.estado} clickable${t.movible ? ' movible' : ''}${arrastrando === t.clave ? ' arrastrando' : ''}`}
        draggable={t.movible}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', t.clave)
          e.dataTransfer.effectAllowed = 'move'
          setArrastrando(t.clave)
        }}
        onDragEnd={() => { setArrastrando(null); setSobre(null) }}
        onClick={() => abrir(t)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && abrir(t)}
        role="button"
        tabIndex={0}
        title={t.esGrupo
          ? `${t.tareas.map((x) => x.local).join(', ')}. ${t.movible ? 'Tocá para ver los locales o arrastrá el grupo a otro día' : 'Tocá para ver los locales'}`
          : t.movible ? 'Tocá para ver el detalle o arrastrala a otro día' : 'Ver detalle'}
      >
        <span className="tarea-texto">
          <span>
            {depto && <span className="chip-depto" style={{ color: depto.color, background: `${depto.color}26` }} title={depto.nombre}>{depto.abreviatura}</span>}
            <TareaYLocal t={t} />
            {conAtraso && t.diasVencida > 0 && <span className="tarea-atraso">{fechaCorta(t.fechaISO)} · hace {t.diasVencida} d</span>}
          </span>
          {persona && <span className="tarea-persona">{persona}</span>}
          <EtiquetasDependencia tarea={t} compacta />
        </span>
      </li>
    )
  }

  function renderGrupos(lista, vacio, conAtraso = false) {
    if (!lista.length) return <div className="dia-vacio">{vacio}</div>
    return <ul className="tarea-bullets">{agrupada(lista).map((t) => renderTarea(t, conAtraso))}</ul>
  }

  function renderCrear(fecha) {
    if (!puedeCrear) return null
    return (
      <button type="button" className="dia-crear" onClick={() => onCrear(fecha)} aria-label={`Nueva tarea el ${fechaCorta(fecha)}`} title="Nueva tarea este día">+</button>
    )
  }

  return (
    <div className="semana-tablero">
      <div className="st-kpis">
        <div className="st-kpi">
          <span className={`st-semaforo ${semaforo}`} aria-hidden="true" />
          <div><b>{textoSemaforo}</b><span>Estado de hoy</span></div>
        </div>
        <div className="st-kpi"><b className="tono-medio">{pendientesHoy}</b><span>Pendientes hoy</span></div>
        <div className="st-kpi"><b className="tono-ok">{realizadasHoy}</b><span>Realizadas hoy</span></div>
        <div className="st-kpi"><b className="tono-mal">{vencidas}</b><span>Atrasadas</span></div>
      </div>

      <div className="st-semana">
        <section className={`dia-col st-atrasadas${atrasadas.length ? '' : ' sin-tareas'}`} aria-label="Atrasadas">
          <div className="dia-nombre">Atrasadas</div>
          <div className="dia-fecha">{atrasadas.length} sin resolver</div>
          <div className="dia-contenido">
            {renderGrupos(atrasadas, "Sin atrasadas", true)}
          </div>
        </section>
        {/* "sin-tareas": en celular un dia sin tareas ocupa una sola linea. */}
        {diasEsta.map((d) => (
          <section
            key={d.fecha}
            className={`dia-col${d.fecha === hoyISO ? ' hoy' : ''}${sobre === d.fecha ? ' destino' : ''}${porFecha(d.fecha).length ? '' : ' sin-tareas'}`}
            aria-label={`${d.nombre} ${fechaCorta(d.fecha)}`}
            {...soltarEn(d.fecha)}
          >
            <div className="dia-cab">
              <div>
                <div className="dia-nombre">{d.nombre}</div>
                <div className="dia-fecha">{fechaCorta(d.fecha)}</div>
              </div>
              {renderCrear(d.fecha)}
            </div>
            <div className="dia-contenido">
              {renderGrupos(porFecha(d.fecha), "Sin tareas")}
            </div>
          </section>
        ))}
      </div>

      <div className="st-proxima">
        <div className="st-titulo-proxima">Próxima semana</div>
        <div className="st-proxima-grid">
          <div className="st-mini hueco" aria-hidden="true" />
          {diasProxima.map((d) => {
            // Mas chica a proposito, pero con lo mismo que la semana: tarea ›
            // local, responsable y si espera o sigue con otra.
            const lista = agrupada(porFecha(d.fecha))
            return (
              <div key={d.fecha} className={`st-mini${sobre === d.fecha ? ' destino' : ''}${lista.length ? '' : ' sin-tareas'}`} {...soltarEn(d.fecha)}>
                <div className="st-mini-cab">
                  <span>{d.nombre} {fechaCorta(d.fecha)}</span>
                  {renderCrear(d.fecha)}
                </div>
                <ul>
                  {lista.map((t) => {
                    const depto = mostrarDepto ? deptos.get(t.idDepartamento) : null
                    const dep = t.esperaA?.length ? `⏳ ${t.esperaA[0].nombre_tarea}${t.esperaA.length > 1 ? ` y ${t.esperaA.length - 1} más` : ''}`
                      : t.laEspera?.length ? `🔗 ${t.laEspera[0].nombre_tarea}${t.laEspera.length > 1 ? ` y ${t.laEspera.length - 1} más` : ''}` : ''
                    return (
                      <li key={t.clave}>
                        <button type="button" onClick={() => abrir(t)} title={t.esGrupo ? `${t.titulo} › ${t.tareas.map((x) => x.local).join(', ')}` : `${t.titulo} › ${t.local}`}>
                          {depto && <span className="chip-depto" style={{ color: depto.color, background: `${depto.color}26` }}>{depto.abreviatura}</span>}
                          <TareaYLocal t={t} />
                          <span className="st-mini-sub">
                            {personaDe(t)}
                            {dep && <> · <span className={t.esperaA?.length ? 'dep-espera' : 'dep-frena'}>{dep}</span></>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {!lista.length && <li className="st-mini-vacio">Sin tareas</li>}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
