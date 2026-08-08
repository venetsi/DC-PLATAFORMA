// Traduce la agenda tal como la carga un admin (mismo vocabulario que
// DCSMART ESTRUCTURA.xlsx: "de 1 al 10 DE CADA MES", "jueves DE CADA SEMANA",
// "cada 3 meses"...) a RRULE (RFC 5545) para Google Calendar.
//
// Limite conocido y aceptado (ver docs/superpowers/plans): RRULE describe
// puntos de recurrencia, no ventanas -- "de 1 al 10" se resuelve guardando el
// RRULE sobre el dia de VENCIMIENTO (dia_hasta); "desde el dia 1" (dia_desde)
// es solo informativo para la UI, no llega a la regla.

const DIAS_ISO_A_RRULE = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' }

function untilSuffix(vigenciaHasta) {
  if (!vigenciaHasta) return ''
  const yyyymmdd = vigenciaHasta.replaceAll('-', '')
  return `;UNTIL=${yyyymmdd}T000000Z`
}

export function construirRecurrence(tipo, config, vigenciaHasta) {
  const until = untilSuffix(vigenciaHasta)
  switch (tipo) {
    case 'UNICA':
      return null // evento sin recurrence, una sola fecha (config.fecha)
    case 'DIARIA': {
      const byday = config?.excluir_fines_de_semana ? ';BYDAY=MO,TU,WE,TH,FR' : ''
      return [`RRULE:FREQ=DAILY${byday}${until}`]
    }
    case 'SEMANAL': {
      const dias = (config?.dias_semana || []).map((d) => DIAS_ISO_A_RRULE[d]).filter(Boolean)
      if (!dias.length) throw new Error('SEMANAL requiere dias_semana')
      return [`RRULE:FREQ=WEEKLY;BYDAY=${dias.join(',')}${until}`]
    }
    case 'INTERVALO_MESES': {
      const cadaNMeses = config?.cada_n_meses ?? 1
      const diaHasta = config?.dia_hasta
      if (!diaHasta) throw new Error('INTERVALO_MESES requiere dia_hasta')
      return [`RRULE:FREQ=MONTHLY;INTERVAL=${cadaNMeses};BYMONTHDAY=${diaHasta}${until}`]
    }
    default:
      throw new Error(`recurrencia_tipo desconocido: ${tipo}`)
  }
}

// Fecha (YYYY-MM-DD) del primer evento a crear, segun el tipo.
export function primeraFecha(tipo, config, vigenciaDesde) {
  if (tipo === 'UNICA') return config.fecha
  return vigenciaDesde
}
