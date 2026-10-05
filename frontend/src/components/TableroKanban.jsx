import { aTarea, agruparPorGrupo } from '../lib/agrupar.js'
import { clasificarInstancia } from '../lib/vencimiento.js'
import EtiquetasDependencia from './EtiquetasDependencia.jsx'
import Urgencia from './Urgencia.jsx'
import { pesoUrgencia } from '../lib/urgencia.js'

// Vista "Tablero" de Mi agenda, al estilo Trello: una lista por departamento y
// una tarjeta por tarea abierta (atrasadas + pendientes de los proximos 30
// dias), ordenadas por vencimiento. Decision del usuario: tocar la tarjeta
// abre el detalle, la casilla la marca hecha (quien puede marcar), y NO se
// arrastra entre listas -- moverla de lista seria cambiarle el departamento.

function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

function nombreCorto(email) {
  return String(email || '').split('@')[0]
}

// Etiqueta de vencimiento, como la fecha de una tarjeta de Trello.
function vencimiento(t, hoyISO) {
  if (t.estado === 'vencida') return { clase: 'vencida', texto: `${fechaCorta(t.fechaISO)} · hace ${t.diasVencida} d` }
  if (t.fechaISO === hoyISO) return { clase: 'hoy', texto: 'Hoy' }
  return { clase: 'futura', texto: fechaCorta(t.fechaISO) }
}

// La misma tarea el mismo dia en varios locales del mismo grupo es UNA
// tarjeta ("GRUPO TITA ×3"): tocarla abre el grupo (`onAbrirGrupo`) y su
// casilla marca todas (`onMarcarGrupo`).
// Colores para las columnas de PERSONA (las de departamento usan el de cada uno).
const COLORES_PERSONA = ['#5fa8e8', '#7cc47f', '#e0789b', '#f0a45d', '#9d8df1', '#3fb6bd', '#c9b086', '#d4a5e8']
const SIN_RESPONSABLE = '__equipo__'

// `agrupar`: 'departamento' (una lista por departamento, como siempre) o
// 'responsable' (una lista por persona, con las tareas ordenadas por departamento
// y fecha y la etiqueta del departamento en cada tarjeta).
export default function TableroKanban({ eventos, idsVisibles, deptos, mapaLocales, grupoDeLocal, hoyISO, puedeMarcar, onAbrir, onAbrirGrupo, onMarcar, onMarcarGrupo, marcando, agrupar = 'departamento', nombreDePersona = nombreCorto }) {
  const porResponsable = agrupar === 'responsable'
  const visibles = new Set(idsVisibles)
  const abiertas = []
  for (const ev of eventos) {
    const { estado } = clasificarInstancia(ev)
    if (estado !== 'pendiente' && estado !== 'vencida') continue
    if (!visibles.has(ev.__depto)) continue
    const t = aTarea(ev, mapaLocales, hoyISO)
    abiertas.push({ ...t, clave: `${ev.__depto}::${ev.id}`, idDepartamento: ev.__depto, departamento: deptos.get(ev.__depto)?.nombre })
  }
  const porFechaYUrgencia = (a, b) => a.fechaISO.localeCompare(b.fechaISO) || pesoUrgencia(a.prioridad) - pesoUrgencia(b.prioridad) || a.titulo.localeCompare(b.titulo) || a.local.localeCompare(b.local)
  // Por responsable: primero el departamento, despues la fecha.
  const porDeptoYFecha = (a, b) => String(a.departamento || '').localeCompare(String(b.departamento || '')) || porFechaYUrgencia(a, b)

  let listas
  if (!porResponsable) {
    const porDepto = new Map(idsVisibles.map((id) => [id, []]))
    for (const t of abiertas) porDepto.get(t.idDepartamento)?.push(t)
    listas = [...porDepto.entries()]
      .map(([id, tareas]) => ({
        id,
        info: deptos.get(id) || { nombre: '…', color: '#8fb3bd', abreviatura: '' },
        tareas: agruparPorGrupo(tareas, grupoDeLocal).sort(porFechaYUrgencia)
      }))
      // Las colapsadas (sin tareas abiertas) van al final; dentro de cada grupo, por nombre.
      .sort((a, b) => (!a.tareas.length - !b.tareas.length) || a.info.nombre.localeCompare(b.info.nombre))
  } else {
    const porPersona = new Map()
    for (const t of abiertas) {
      const clave = String(t.asignadoA || '').toLowerCase().trim() || SIN_RESPONSABLE
      if (!porPersona.has(clave)) porPersona.set(clave, [])
      porPersona.get(clave).push(t)
    }
    // Una columna por persona con tareas abiertas; "Equipo" (sin responsable
    // fijo) al final. El agrupado por grupo de locales va DENTRO de cada persona.
    listas = [...porPersona.entries()]
      .map(([clave, tareas]) => ({
        id: clave,
        info: {
          nombre: clave === SIN_RESPONSABLE ? 'Equipo (sin responsable fijo)' : nombreDePersona(clave),
          color: clave === SIN_RESPONSABLE ? '#8fb3bd' : null
        },
        tareas: agruparPorGrupo(tareas, grupoDeLocal).sort(porDeptoYFecha)
      }))
      .sort((a, b) => (a.id === SIN_RESPONSABLE) - (b.id === SIN_RESPONSABLE) || a.info.nombre.localeCompare(b.info.nombre))
      .map((l, i) => ({ ...l, info: { ...l.info, color: l.info.color || COLORES_PERSONA[i % COLORES_PERSONA.length] } }))
  }

  return (
    <div className="kanban" role="list" aria-label={porResponsable ? 'Tablero por responsable' : 'Tablero por departamento'}>
      {listas.map((l) => !l.tareas.length ? (
        // Sin tareas abiertas: colapsada, como una lista plegada de Trello
        // (una franja angosta con el nombre), para que no ocupe una columna entera.
        <section key={l.id} className="kanban-lista colapsada" role="listitem" aria-label={`${l.info.nombre}: sin tareas abiertas`} title={`${l.info.nombre}: sin tareas abiertas`}>
          <span className="kanban-color" style={{ background: l.info.color }} aria-hidden="true" />
          <span className="kanban-vertical">{l.info.nombre}</span>
          <span className="kanban-cuenta">0</span>
        </section>
      ) : (
        <section key={l.id} className="kanban-lista" role="listitem" aria-label={l.info.nombre}>
          <header className="kanban-cab">
            <span className="kanban-color" style={{ background: l.info.color }} aria-hidden="true" />
            <strong>{l.info.nombre}</strong>
            {/* Tareas, no tarjetas: un grupo cuenta por cada local. */}
            <span className="kanban-cuenta">{l.tareas.reduce((n, t) => n + (t.esGrupo ? t.tareas.length : 1), 0)}</span>
          </header>
          <ul className="kanban-tarjetas">
            {l.tareas.map((t) => {
              const v = vencimiento(t, hoyISO)
              const puede = puedeMarcar(t.idDepartamento)
              const persona = t.esGrupo
                ? (t.personas.length ? t.personas.join(', ') : 'equipo')
                : t.asignadoA ? nombreCorto(t.asignadoA) : 'equipo'
              const abrir = () => (t.esGrupo ? onAbrirGrupo(t) : onAbrir(t))
              return (
                <li
                  key={t.clave}
                  className="kanban-tarjeta"
                  role="button"
                  tabIndex={0}
                  onClick={abrir}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), abrir())}
                  title={t.esGrupo ? `${t.tareas.map((x) => x.local).join(', ')}. Tocá para ver los locales` : 'Ver el detalle'}
                >
                  <div className="kanban-titulo"><Urgencia prioridad={t.prioridad} />{t.titulo}</div>
                  <div className="kanban-meta">
                    {porResponsable && deptos.get(t.idDepartamento) && (
                      <span className="chip-depto" style={{ color: deptos.get(t.idDepartamento).color, background: `${deptos.get(t.idDepartamento).color}26` }} title={deptos.get(t.idDepartamento).nombre}>{deptos.get(t.idDepartamento).abreviatura}</span>
                    )}
                    {t.local}{t.esGrupo && <span className="grupo-cuenta">×{t.tareas.length}</span>}{!porResponsable && <> · {persona}</>}
                  </div>
                  <EtiquetasDependencia tarea={t} />
                  <div className="kanban-pie">
                    {puede && (
                      <button
                        type="button"
                        className="kanban-check"
                        disabled={t.esGrupo ? t.tareas.some((x) => marcando === x.id) : marcando === t.id}
                        aria-label={t.esGrupo ? `Marcar hechas las ${t.tareas.length} de ${t.titulo} — ${t.local}` : `Marcar hecha: ${t.titulo} — ${t.local}`}
                        title={t.esGrupo ? 'Marcar hecho todo el grupo' : 'Marcar hecha'}
                        onClick={(e) => { e.stopPropagation(); if (t.esGrupo) onMarcarGrupo(t); else onMarcar(t) }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className={`kanban-vence ${v.clase}`}>{v.texto}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
