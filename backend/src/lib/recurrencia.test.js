import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESES_DE_HORIZONTE, horizontePorDefecto, construirRecurrence } from './recurrencia.js'

test('el horizonte por defecto es de 6 meses', () => {
  assert.equal(MESES_DE_HORIZONTE, 6)
  assert.equal(horizontePorDefecto('2026-09-27'), '2027-03-27')
})

test('una serie sin vigencia_hasta termina a los 6 meses de su inicio', () => {
  const [regla] = construirRecurrence('SEMANAL', { dias_semana: [1, 4] }, null, '2026-09-27')
  assert.equal(regla, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270327T000000Z')
})

test('una vigencia_hasta explicita gana sobre el horizonte', () => {
  const [regla] = construirRecurrence('DIARIA', { excluir_fines_de_semana: true }, '2026-12-31', '2026-09-27')
  assert.equal(regla, 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231T000000Z')
})
