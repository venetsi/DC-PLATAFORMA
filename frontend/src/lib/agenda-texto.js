// Vocabulario de agenda compartido entre el formulario por asignacion
// (AgendaForm), el editor de frecuencia y la pantalla de Agendas. La API usa
// recurrencia_tipo/config (ver backend lib/recurrencia.js); la UI agrega
// DIARIA_HABIL, que viaja como DIARIA + excluir_fines_de_semana.

export const DIAS_SEMANA = [
  { valor: 1, etiqueta: 'Lun' }, { valor: 2, etiqueta: 'Mar' }, { valor: 3, etiqueta: 'Mié' },
  { valor: 4, etiqueta: 'Jue' }, { valor: 5, etiqueta: 'Vie' }, { valor: 6, etiqueta: 'Sáb' }, { valor: 7, etiqueta: 'Dom' }
]

export function fechaCorta(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).split('-')
  return `${d}/${m}/${a}`
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function fechaHumana(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).split('-').map(Number)
  return `${d} ${MESES_CORTOS[m - 1]}`
}

// La regla en palabras. `conDesde` agrega "desde el dd/mm/aaaa".
export function describirAgenda(ag, { conDesde = false } = {}) {
  if (!ag) return null
  const c = ag.recurrencia_config || {}
  let regla
  if (ag.recurrencia_tipo === 'UNICA') return `Una vez, el ${fechaCorta(c.fecha)}`
  if (ag.recurrencia_tipo === 'DIARIA') regla = c.excluir_fines_de_semana ? 'Lunes a viernes' : 'Todos los días'
  if (ag.recurrencia_tipo === 'SEMANAL') regla = `Los ${(c.dias_semana || []).map((d) => DIAS_SEMANA.find((x) => x.valor === d)?.etiqueta).join(', ')}`
  if (ag.recurrencia_tipo === 'INTERVALO_MESES') regla = `Día ${c.dia_hasta} ${c.cada_n_meses > 1 ? `cada ${c.cada_n_meses} meses` : 'de cada mes'}`
  if (!regla) return 'Agenda editada a mano'
  return conDesde ? `${regla}, desde el ${fechaCorta(ag.vigencia_desde)}` : regla
}

// Clave para comparar reglas (ignora desde/hasta).
export function claveRegla(ag) {
  if (!ag) return 'sin-agenda'
  return `${ag.recurrencia_tipo}|${JSON.stringify(ag.recurrencia_config || {})}`
}

function manianaISO() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Estado del editor de frecuencia.
export function valorInicial() {
  return { tipo: 'DIARIA_HABIL', diasSemana: [1], cadaNMeses: 1, diaHasta: 10, fecha: manianaISO(), desde: manianaISO() }
}

export function valorDesdeAgenda(ag) {
  if (!ag) return valorInicial()
  const c = ag.recurrencia_config || {}
  const base = valorInicial()
  return {
    ...base,
    tipo: ag.recurrencia_tipo === 'DIARIA' && c.excluir_fines_de_semana ? 'DIARIA_HABIL' : ag.recurrencia_tipo,
    diasSemana: c.dias_semana || base.diasSemana,
    cadaNMeses: c.cada_n_meses || base.cadaNMeses,
    diaHasta: c.dia_hasta || base.diaHasta,
    fecha: c.fecha || base.fecha
  }
}

export function agendaDesdeValor(v) {
  let recurrencia_config = {}
  if (v.tipo === 'DIARIA_HABIL') recurrencia_config = { excluir_fines_de_semana: true }
  if (v.tipo === 'SEMANAL') recurrencia_config = { dias_semana: [...v.diasSemana].sort() }
  if (v.tipo === 'INTERVALO_MESES') recurrencia_config = { cada_n_meses: Number(v.cadaNMeses), dia_hasta: Number(v.diaHasta) }
  if (v.tipo === 'UNICA') recurrencia_config = { fecha: v.fecha }
  return {
    recurrencia_tipo: v.tipo === 'DIARIA_HABIL' ? 'DIARIA' : v.tipo,
    recurrencia_config,
    vigencia_desde: v.tipo === 'UNICA' ? v.fecha : v.desde
  }
}

// Error de validacion en palabras, o null.
export function errorDeValor(v) {
  if (v.tipo === 'SEMANAL' && !v.diasSemana.length) return 'Elegí al menos un día de la semana'
  if (v.tipo === 'INTERVALO_MESES' && !(Number(v.diaHasta) >= 1 && Number(v.diaHasta) <= 31)) return 'El día del mes va de 1 a 31'
  if (v.tipo === 'UNICA' && !v.fecha) return 'Elegí la fecha'
  if (v.tipo !== 'UNICA' && !v.desde) return 'Elegí desde cuándo'
  return null
}
