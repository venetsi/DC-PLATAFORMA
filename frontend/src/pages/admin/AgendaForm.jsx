import { useEffect, useState } from 'react'
import { asignacionesApi } from '../../api/recursos.js'

const DIAS = [
  { valor: 1, etiqueta: 'Lun' }, { valor: 2, etiqueta: 'Mar' }, { valor: 3, etiqueta: 'Mie' },
  { valor: 4, etiqueta: 'Jue' }, { valor: 5, etiqueta: 'Vie' }, { valor: 6, etiqueta: 'Sab' }, { valor: 7, etiqueta: 'Dom' }
]

function fechaCorta(iso) {
  const [a, m, d] = String(iso).split('-')
  return `${d}/${m}/${a}`
}

// La agenda vigente en palabras, para que quien edita vea que hay antes de tocar.
function describirAgenda(ag) {
  if (!ag) return null
  const c = ag.recurrencia_config || {}
  let regla
  if (ag.recurrencia_tipo === 'UNICA') return `Una vez, el ${fechaCorta(c.fecha)}`
  if (ag.recurrencia_tipo === 'DIARIA') regla = c.excluir_fines_de_semana ? 'Diaria, de lunes a viernes' : 'Diaria, todos los días'
  if (ag.recurrencia_tipo === 'SEMANAL') regla = `Los ${(c.dias_semana || []).map((d) => DIAS.find((x) => x.valor === d)?.etiqueta).join(', ')}`
  if (ag.recurrencia_tipo === 'INTERVALO_MESES') regla = `Día ${c.dia_hasta} ${c.cada_n_meses > 1 ? `cada ${c.cada_n_meses} meses` : 'de cada mes'}`
  return `${regla}, desde el ${fechaCorta(ag.vigencia_desde)}`
}

// Formulario para definir/editar la agenda de una TareaAsignacion -- traduce
// el vocabulario del ejemplo real (dia/periodo) a recurrencia_tipo/config.
export default function AgendaForm({ asignacion, usuarios = [], onGuardado }) {
  // DIARIA_HABIL es solo de la UI: se manda como DIARIA + excluir_fines_de_semana.
  const [tipo, setTipo] = useState('DIARIA_HABIL')
  const [diasSemana, setDiasSemana] = useState([])
  const [cadaNMeses, setCadaNMeses] = useState(1)
  const [diaHasta, setDiaHasta] = useState(10)
  const [fecha, setFecha] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState(new Date().toISOString().slice(0, 10))
  // Precargado con lo que ya tiene la asignacion: sin esto, guardar un cambio
  // de recurrencia con el campo vacio borraria el responsable ya cargado.
  const [asignadoA, setAsignadoA] = useState(asignacion.asignado_a || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [agendaActual, setAgendaActual] = useState(null)

  // Precarga la agenda real: antes el formulario arrancaba siempre vacio y
  // "Actualizar" (por ejemplo, para cambiar solo el responsable) pisaba la
  // frecuencia verdadera.
  useEffect(() => {
    if (!asignacion.id_calendar_event) return
    asignacionesApi.leerAgenda(asignacion.id).then((ag) => {
      if (!ag) return
      setAgendaActual(ag)
      const c = ag.recurrencia_config || {}
      setTipo(ag.recurrencia_tipo === 'DIARIA' && c.excluir_fines_de_semana ? 'DIARIA_HABIL' : ag.recurrencia_tipo)
      if (c.dias_semana) setDiasSemana(c.dias_semana)
      if (c.cada_n_meses) setCadaNMeses(c.cada_n_meses)
      if (c.dia_hasta) setDiaHasta(c.dia_hasta)
      if (c.fecha) setFecha(c.fecha)
    }).catch(() => {})
  }, [asignacion.id, asignacion.id_calendar_event])

  function toggleDia(d) {
    setDiasSemana((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    let recurrencia_config = {}
    if (tipo === 'DIARIA_HABIL') recurrencia_config = { excluir_fines_de_semana: true }
    if (tipo === 'SEMANAL') recurrencia_config = { dias_semana: diasSemana }
    if (tipo === 'INTERVALO_MESES') recurrencia_config = { cada_n_meses: Number(cadaNMeses), dia_hasta: Number(diaHasta) }
    if (tipo === 'UNICA') recurrencia_config = { fecha }

    setGuardando(true)
    try {
      await asignacionesApi.definirAgenda(asignacion.id, {
        recurrencia_tipo: tipo === 'DIARIA_HABIL' ? 'DIARIA' : tipo,
        recurrencia_config,
        vigencia_desde: vigenciaDesde,
        asignado_a: asignadoA
      })
      onGuardado()
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar la agenda')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {agendaActual && (
        <span style={{ fontSize: '0.8rem', width: '100%' }}>
          <strong>Agenda actual:</strong> {describirAgenda(agendaActual)}
          {asignacion.asignado_a ? ` · responsable ${asignacion.asignado_a}` : ''}
        </span>
      )}
      <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="DIARIA_HABIL">Diaria, lunes a viernes</option>
        <option value="DIARIA">Diaria, todos los días</option>
        <option value="SEMANAL">Semanal</option>
        <option value="INTERVALO_MESES">Cada N meses</option>
        <option value="UNICA">Una vez</option>
      </select>

      {tipo === 'SEMANAL' && (
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {DIAS.map((d) => (
            <label key={d.valor} style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <input type="checkbox" checked={diasSemana.includes(d.valor)} onChange={() => toggleDia(d.valor)} />
              {d.etiqueta}
            </label>
          ))}
        </div>
      )}

      {tipo === 'INTERVALO_MESES' && (
        <>
          <label style={{ fontSize: '0.8rem' }}>cada
            <input type="number" min="1" value={cadaNMeses} onChange={(e) => setCadaNMeses(e.target.value)} style={{ width: 50, marginLeft: 4 }} /> mes(es)
          </label>
          <label style={{ fontSize: '0.8rem' }}>vence día
            <input type="number" min="1" max="31" value={diaHasta} onChange={(e) => setDiaHasta(e.target.value)} style={{ width: 50, marginLeft: 4 }} />
          </label>
        </>
      )}

      {tipo === 'UNICA' && (
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
      )}

      <label style={{ fontSize: '0.8rem' }}>desde
        <input type="date" value={vigenciaDesde} onChange={(e) => setVigenciaDesde(e.target.value)} style={{ marginLeft: 4 }} />
      </label>

      {/* Responsable nominal opcional: vacio = la hace cualquiera del
          departamento, que sigue siendo el caso por defecto. */}
      <select
        value={asignadoA}
        onChange={(e) => setAsignadoA(e.target.value)}
        title="Responsable de esta tarea"
        style={{ maxWidth: 200 }}
      >
        <option value="">Sin responsable fijo</option>
        {usuarios.map((u) => (
          <option key={u.id} value={u.email}>{u.nombre || u.email}</option>
        ))}
        {/* Si el responsable guardado ya no esta en la lista (cambio de
            departamento, baja en dcsmart), igual se muestra en vez de
            desaparecer en silencio y perderse al guardar. */}
        {asignadoA && !usuarios.some((u) => u.email === asignadoA) && (
          <option value={asignadoA}>{asignadoA} (fuera del depto.)</option>
        )}
      </select>

      <button className="btn" disabled={guardando}>{asignacion.id_calendar_event ? 'Actualizar' : 'Agendar'}</button>
      {error && <span style={{ color: 'var(--rojo)', fontSize: '0.8rem' }}>{error}</span>}

      {/* La serie se crea acotada a 6 meses y se renueva sola mientras la
          tarea siga activa (ver backend lib/recurrencia.js + jobs/reconciliar.js).
          Se avisa para que nadie asuma que queda agendada para siempre. */}
      {tipo !== 'UNICA' && (
        <span style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)', width: '100%' }}>
          Se agenda por 6 meses y se renueva automáticamente mientras la tarea siga activa.
        </span>
      )}
      {agendaActual && (
        <span style={{ fontSize: '0.72rem', color: 'var(--texto-tenue)', width: '100%' }}>
          Si cambiás solo el responsable, la agenda queda igual. Si cambiás la frecuencia, rige desde la fecha "desde" (nunca antes de hoy); lo anterior queda como estaba.
        </span>
      )}
    </form>
  )
}
