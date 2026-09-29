import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESES_DE_HORIZONTE, horizontePorDefecto, construirRecurrence, leerRecurrence, primeraFecha, diaHabilDelMes, untilDe, conUntil } from './recurrencia.js'

test('el horizonte por defecto es de 6 meses', () => {
  assert.equal(MESES_DE_HORIZONTE, 6)
  assert.equal(horizontePorDefecto('2026-09-27'), '2027-03-27')
})

test('una serie sin vigencia_hasta termina a los 6 meses de su inicio', () => {
  const [regla] = construirRecurrence('SEMANAL', { dias_semana: [1, 4] }, null, '2026-09-27')
  assert.equal(regla, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270327T000000Z')
})

test('dia habil N: el N-esimo lunes-a-viernes del mes, sin contar feriados', () => {
  // Octubre 2026 arranca jueves: 1 jue, 2 vie, 5 lun... el 10 es el miercoles 14.
  assert.equal(diaHabilDelMes(2026, 9, 1).toISOString().slice(0, 10), '2026-10-01')
  assert.equal(diaHabilDelMes(2026, 9, 4).toISOString().slice(0, 10), '2026-10-06')
  assert.equal(diaHabilDelMes(2026, 9, 10).toISOString().slice(0, 10), '2026-10-14')
  assert.equal(diaHabilDelMes(2026, 9, 17).toISOString().slice(0, 10), '2026-10-23')
  // Septiembre 2026 (arranca martes): el 17 cae el miercoles 23.
  assert.equal(diaHabilDelMes(2026, 8, 17).toISOString().slice(0, 10), '2026-09-23')
  // Mes que se pasa de 11: enero del año siguiente.
  assert.equal(diaHabilDelMes(2026, 12, 1).toISOString().slice(0, 10), '2027-01-01')
  assert.equal(diaHabilDelMes(2026, 1, 25), null)
})

test('dia habil N: la regla, la primera fecha y la lectura de vuelta', () => {
  const [regla] = construirRecurrence('DIA_HABIL', { dia_habil: 10 }, null, '2026-09-28')
  assert.equal(regla, 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=10;UNTIL=20270328T000000Z')
  // El 10 de septiembre (el 14/9) ya paso: arranca en octubre.
  assert.equal(primeraFecha('DIA_HABIL', { dia_habil: 10 }, '2026-09-28'), '2026-10-14')
  // El mismo dia cuenta.
  assert.equal(primeraFecha('DIA_HABIL', { dia_habil: 10 }, '2026-10-14'), '2026-10-14')
  assert.deepEqual(leerRecurrence([regla], '2026-10-14'), {
    vigencia_desde: '2026-10-14',
    vigencia_hasta: '2027-03-28',
    recurrencia_tipo: 'DIA_HABIL',
    recurrencia_config: { dia_habil: 10 }
  })
  assert.throws(() => construirRecurrence('DIA_HABIL', { dia_habil: 21 }, null, '2026-09-28'))
})

test('untilDe y conUntil: leer y reemplazar el fin de una serie', () => {
  const cerrada = ['RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=10;UNTIL=20260929T000000Z']
  assert.equal(untilDe(cerrada), '2026-09-29')
  assert.deepEqual(conUntil(cerrada, '2027-03-29'), ['RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=10;UNTIL=20270329T000000Z'])
  assert.deepEqual(conUntil(['RRULE:FREQ=DAILY'], '2027-01-01'), ['RRULE:FREQ=DAILY;UNTIL=20270101T000000Z'])
  assert.equal(untilDe([]), null)
})

test('una vigencia_hasta explicita gana sobre el horizonte', () => {
  const [regla] = construirRecurrence('DIARIA', { excluir_fines_de_semana: true }, '2026-12-31', '2026-09-27')
  assert.equal(regla, 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231T000000Z')
})
