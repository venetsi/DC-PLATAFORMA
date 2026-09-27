// Traduce la agenda tal como la carga un admin (mismo vocabulario que
// DCSMART ESTRUCTURA.xlsx: "de 1 al 10 DE CADA MES", "jueves DE CADA SEMANA",
// "cada 3 meses"...) a RRULE (RFC 5545) para Google Calendar.
//
// Limite conocido y aceptado (ver docs/superpowers/plans): RRULE describe
// puntos de recurrencia, no ventanas -- "de 1 al 10" se resuelve guardando el
// RRULE sobre el dia de VENCIMIENTO (dia_hasta); "desde el dia 1" (dia_desde)
// es solo informativo para la UI, no llega a la regla.

const DIAS_ISO_A_RRULE = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' }

// Ninguna serie se crea infinita. Antes, si no se pasaba vigencia_hasta la
// RRULE salia sin UNTIL y el evento se repetia para siempre -- y como el
// formulario de agenda no ofrece fecha de fin, en la practica TODAS lo eran.
// El horizonte se renueva solo desde jobs/reconciliar.js mientras la
// asignacion siga activa, asi que acotarlo no apaga nada por sorpresa.
// 6 meses desde 2026-09-27 (antes 12, a pedido del usuario). Las series ya
// creadas conservan su UNTIL y pasan a 6 meses cuando el job las renueva.
export const MESES_DE_HORIZONTE = 6

export function horizontePorDefecto(desdeISO, meses = MESES_DE_HORIZONTE) {
  const [a, m, d] = String(desdeISO).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 + meses, d)).toISOString().slice(0, 10)
}

function untilSuffix(vigenciaHasta) {
  if (!vigenciaHasta) return ''
  const yyyymmdd = vigenciaHasta.replaceAll('-', '')
  return `;UNTIL=${yyyymmdd}T000000Z`
}

// `vigenciaDesde` es opcional y solo se usa para calcular el horizonte por
// defecto cuando no vino un `vigenciaHasta` explicito.
export function construirRecurrence(tipo, config, vigenciaHasta, vigenciaDesde) {
  const hasta = vigenciaHasta || (vigenciaDesde ? horizontePorDefecto(vigenciaDesde) : null)
  const until = untilSuffix(hasta)
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

const RRULE_A_DIAS_ISO = Object.fromEntries(Object.entries(DIAS_ISO_A_RRULE).map(([k, v]) => [v, Number(k)]))

// Inverso de construirRecurrence: lee el maestro de Calendar y devuelve la
// agenda en el mismo vocabulario del formulario. null si la regla no es una
// de las que arma la plataforma (evento editado a mano en Calendar).
export function leerRecurrence(recurrence, startDate) {
  const regla = (recurrence || []).find((r) => r.startsWith('RRULE:'))
  if (!regla) return { recurrencia_tipo: 'UNICA', recurrencia_config: { fecha: startDate }, vigencia_desde: startDate, vigencia_hasta: null }

  const partes = Object.fromEntries(regla.slice(6).split(';').map((p) => p.split('=')))
  const u = partes.UNTIL
  const vigencia_hasta = u ? `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` : null
  const base = { vigencia_desde: startDate, vigencia_hasta }

  if (partes.FREQ === 'DAILY') {
    const habil = partes.BYDAY === 'MO,TU,WE,TH,FR'
    if (partes.BYDAY && !habil) return null
    return { ...base, recurrencia_tipo: 'DIARIA', recurrencia_config: habil ? { excluir_fines_de_semana: true } : {} }
  }
  if (partes.FREQ === 'WEEKLY' && partes.BYDAY) {
    const dias = partes.BYDAY.split(',').map((d) => RRULE_A_DIAS_ISO[d])
    if (dias.some((d) => !d)) return null
    return { ...base, recurrencia_tipo: 'SEMANAL', recurrencia_config: { dias_semana: dias } }
  }
  if (partes.FREQ === 'MONTHLY' && partes.BYMONTHDAY) {
    return {
      ...base,
      recurrencia_tipo: 'INTERVALO_MESES',
      recurrencia_config: { cada_n_meses: Number(partes.INTERVAL || 1), dia_hasta: Number(partes.BYMONTHDAY) }
    }
  }
  return null
}

// Misma regla ignorando el UNTIL (que cambia con cada renovacion).
export function mismaRegla(a, b) {
  const limpiar = (rs) => (rs || []).map((r) => r.replace(/;UNTIL=[^;]*/, '')).sort().join('|')
  return limpiar(a) === limpiar(b)
}

// Fecha (YYYY-MM-DD) del primer evento a crear: la primera >= vigenciaDesde
// que cumple la regla. Si el DTSTART no cumple la RRULE, Google Calendar lo
// agrega igual como ocurrencia extra -- una tarea "los jueves" dada de alta un
// lunes aparecia ese lunes y vencia esa noche.
export function primeraFecha(tipo, config, vigenciaDesde) {
  if (tipo === 'UNICA') return config.fecha
  const [a, m, d] = String(vigenciaDesde).split('-').map(Number)
  const desde = new Date(Date.UTC(a, m - 1, d))
  const iso = (f) => f.toISOString().slice(0, 10)
  const diaIso = (f) => f.getUTCDay() || 7 // 1=lun ... 7=dom

  if (tipo === 'DIARIA' && config?.excluir_fines_de_semana) {
    const f = new Date(desde)
    while (diaIso(f) > 5) f.setUTCDate(f.getUTCDate() + 1)
    return iso(f)
  }
  if (tipo === 'SEMANAL') {
    const dias = config?.dias_semana || []
    const f = new Date(desde)
    for (let i = 0; i < 7 && !dias.includes(diaIso(f)); i++) f.setUTCDate(f.getUTCDate() + 1)
    return iso(f)
  }
  if (tipo === 'INTERVALO_MESES' && config?.dia_hasta) {
    // Primer mes (desde el de vigenciaDesde) que tenga ese dia y no haya pasado.
    for (let i = 0; i < 24; i++) {
      const f = new Date(Date.UTC(a, m - 1 + i, config.dia_hasta))
      if (f.getUTCDate() === config.dia_hasta && f >= desde) return iso(f)
    }
  }
  return vigenciaDesde
}
