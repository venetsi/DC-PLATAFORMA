import { pesoUrgencia } from '../lib/urgencia.js'
import { aTarea } from '../lib/agrupar.js'
import { clasificarInstancia } from '../lib/vencimiento.js'

// Vista "Cronograma" de Mi agenda (el Timeline de Trello): los dias de
// izquierda a derecha y una fila por departamento. En cada celda, las tareas de
// ese dia agrupadas por nombre ("CMV ×12" = en 12 locales), con el color del
// peor estado del grupo. Tocar abre el detalle (o la lista, si son varias).

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
// Del peor al mejor: el grupo toma el color del primero que tenga.
const PRIORIDAD = ['vencida', 'pendiente', 'realizada', 'no_aplica']

function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d + n))
  return f.toISOString().slice(0, 10)
}

export default function Cronograma({ eventos, desdeISO, cantidadDias, idsVisibles, deptos, mapaLocales, hoyISO, onAbrir, onAbrirGrupo }) {
  const dias = Array.from({ length: cantidadDias }, (_, i) => {
    const fecha = sumarDias(desdeISO, i)
    const [a, m, d] = fecha.split('-').map(Number)
    const f = new Date(a, m - 1, d)
    return { fecha, dia: DIAS_CORTOS[f.getDay()], numero: d, finde: f.getDay() === 0 || f.getDay() === 6 }
  })
  const enRango = new Set(dias.map((d) => d.fecha))

  // depto -> fecha -> titulo -> tareas[]
  const celdas = new Map(idsVisibles.map((id) => [id, new Map()]))
  for (const ev of eventos) {
    const porFecha = celdas.get(ev.__depto)
    if (!porFecha) continue
    const { estado } = clasificarInstancia(ev)
    const t = { ...aTarea(ev, mapaLocales, hoyISO), estado, clave: `${ev.__depto}::${ev.id}`, idDepartamento: ev.__depto, departamento: deptos.get(ev.__depto)?.nombre }
    if (!enRango.has(t.fechaISO)) continue
    if (!porFecha.has(t.fechaISO)) porFecha.set(t.fechaISO, new Map())
    const porTitulo = porFecha.get(t.fechaISO)
    if (!porTitulo.has(t.titulo)) porTitulo.set(t.titulo, [])
    porTitulo.get(t.titulo).push(t)
  }
  const filas = idsVisibles
    .map((id) => ({ id, info: deptos.get(id) || { nombre: '…', color: '#8fb3bd' } }))
    .sort((a, b) => a.info.nombre.localeCompare(b.info.nombre))

  return (
    <div className="crono-scroll">
      <div className="crono" style={{ gridTemplateColumns: `9.5rem repeat(${cantidadDias}, minmax(6.5rem, 1fr))` }}>
        <div className="crono-esquina" />
        {dias.map((d) => (
          <div key={d.fecha} className={`crono-dia${d.finde ? ' finde' : ''}${d.fecha === hoyISO ? ' hoy' : ''}`}>
            <span>{d.dia}</span> <b>{d.numero}</b>
          </div>
        ))}
        {filas.map((f) => (
          <div key={f.id} className="crono-fila" style={{ display: 'contents' }}>
            <div className="crono-depto">
              <span className="kanban-color" style={{ background: f.info.color }} aria-hidden="true" />
              {f.info.nombre}
            </div>
            {dias.map((d) => {
              const grupos = [...(celdas.get(f.id).get(d.fecha)?.entries() || [])].sort(([a, ta], [b, tb]) => pesoUrgencia(ta.some((t) => t.prioridad === 'ALTA') ? 'ALTA' : null) - pesoUrgencia(tb.some((t) => t.prioridad === 'ALTA') ? 'ALTA' : null) || a.localeCompare(b))
              return (
                <div key={d.fecha} className={`crono-celda${d.finde ? ' finde' : ''}${d.fecha === hoyISO ? ' hoy' : ''}`}>
                  {grupos.map(([titulo, tareas]) => {
                    const estado = PRIORIDAD.find((p) => tareas.some((t) => t.estado === p))
                    const unica = tareas.length === 1
                    // ⏳ si alguna del grupo espera a otra tarea; 🔗 si alguna frena a otra.
                    const espera = tareas.some((t) => t.esperaA?.length)
                    const frena = tareas.some((t) => t.laEspera?.length)
                    const nota = espera ? ' (espera a otra tarea)' : frena ? ' (sigue con otra tarea)' : ''
                    return (
                      <button
                        key={titulo}
                        type="button"
                        className={`crono-barra ${estado}`}
                        style={{ borderLeftColor: f.info.color }}
                        title={(unica ? `${titulo} — ${tareas[0].local}` : `${titulo}: ${tareas.map((t) => t.local).join(', ')}`) + nota}
                        onClick={() => (unica ? onAbrir(tareas[0]) : onAbrirGrupo({ titulo, fecha: d.fecha, tareas }))}
                      >
                        <span className="crono-titulo">{espera ? '⏳ ' : frena ? '🔗 ' : ''}{titulo}</span>
                        <span className="crono-extra">{unica ? tareas[0].local : `×${tareas.length}`}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
