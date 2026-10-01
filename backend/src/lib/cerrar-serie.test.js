import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cerrarSerie, conCierre, restaurarSerie, sinEmpezar } from './cerrar-serie.js'

test('conCierre: agrega o reemplaza el UNTIL', () => {
  assert.deepEqual(conCierre(['RRULE:FREQ=WEEKLY'], '2026-09-30'), ['RRULE:FREQ=WEEKLY;UNTIL=20260930T000000Z'])
  assert.deepEqual(conCierre(['RRULE:FREQ=MONTHLY;UNTIL=20270401T000000Z;BYMONTHDAY=6'], '2026-09-30'), ['RRULE:FREQ=MONTHLY;UNTIL=20260930T000000Z;BYMONTHDAY=6'])
})

test('sinEmpezar: la primera fecha es posterior al cierre', () => {
  assert.equal(sinEmpezar({ start: { date: '2026-10-07' } }, '2026-09-30'), true)
  assert.equal(sinEmpezar({ start: { date: '2026-09-30' } }, '2026-09-30'), false)
  assert.equal(sinEmpezar({ start: { date: '2026-09-01' } }, '2026-09-30'), false)
})

// Calendar falso: get/instances/delete/patch en memoria.
function calendarFalso(maestro, ocurrencias = []) {
  const llamadas = []
  return {
    llamadas,
    events: {
      get: async () => ({ data: maestro }),
      instances: async () => ({ data: { items: ocurrencias } }),
      delete: async ({ eventId }) => { llamadas.push(['delete', eventId]); maestro.status = 'cancelled' },
      patch: async ({ eventId, requestBody }) => { llamadas.push(['patch', eventId, requestBody]); Object.assign(maestro, requestBody); return { data: maestro } }
    }
  }
}
const ocurrencia = (fecha, estado = 'PENDIENTE') => ({ id: `s_${fecha}`, originalStartTime: { date: fecha }, extendedProperties: { private: { estado } } })

test('cerrarSerie: sin empezar y sin nada hecho, se borra entera (con UNTIL quedaria viva la primera)', async () => {
  const maestro = { id: 's', status: 'confirmed', start: { date: '2026-10-07' }, recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=7'] }
  const cal = calendarFalso(maestro, [ocurrencia('2026-10-07'), ocurrencia('2026-11-07')])
  assert.equal(await cerrarSerie(cal, { calendarId: 'c', eventId: 's', untilDate: '2026-09-30' }), 'borrada')
  assert.deepEqual(cal.llamadas, [['delete', 's']])
})

test('cerrarSerie: sin empezar pero con una ya marcada, se cierra con UNTIL para no perder la marca', async () => {
  const maestro = { id: 's', status: 'confirmed', start: { date: '2026-10-07' }, recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=7'] }
  const cal = calendarFalso(maestro, [ocurrencia('2026-10-07', 'REALIZADA')])
  assert.equal(await cerrarSerie(cal, { calendarId: 'c', eventId: 's', untilDate: '2026-09-30' }), 'cerrada')
  assert.deepEqual(maestro.recurrence, ['RRULE:FREQ=MONTHLY;BYMONTHDAY=7;UNTIL=20260930T000000Z'])
})

test('cerrarSerie: ya empezada, UNTIL como siempre', async () => {
  const maestro = { id: 's', status: 'confirmed', start: { date: '2026-09-01' }, recurrence: ['RRULE:FREQ=WEEKLY'] }
  const cal = calendarFalso(maestro)
  assert.equal(await cerrarSerie(cal, { calendarId: 'c', eventId: 's', untilDate: '2026-09-30' }), 'cerrada')
  assert.deepEqual(maestro.recurrence, ['RRULE:FREQ=WEEKLY;UNTIL=20260930T000000Z'])
  assert.equal(cal.llamadas.some(([op]) => op === 'delete'), false)
})

test('cerrarSerie: una tarea de una sola vez a futuro se borra; una ya pasada, no se toca', async () => {
  const futura = { id: 'u', status: 'confirmed', start: { date: '2026-10-07' }, extendedProperties: { private: { estado: 'PENDIENTE' } } }
  assert.equal(await cerrarSerie(calendarFalso(futura), { calendarId: 'c', eventId: 'u', untilDate: '2026-09-30' }), 'borrada')
  const pasada = { id: 'p', status: 'confirmed', start: { date: '2026-09-10' }, extendedProperties: { private: { estado: 'PENDIENTE' } } }
  const cal = calendarFalso(pasada)
  assert.equal(await cerrarSerie(cal, { calendarId: 'c', eventId: 'p', untilDate: '2026-09-30' }), 'nada')
  assert.deepEqual(cal.llamadas, [])
})

test('cerrarSerie: una ya borrada no se toca; restaurarSerie la vuelve a confirmed', async () => {
  const maestro = { id: 's', status: 'cancelled', start: { date: '2026-10-07' }, recurrence: ['RRULE:FREQ=WEEKLY'] }
  const cal = calendarFalso(maestro)
  assert.equal(await cerrarSerie(cal, { calendarId: 'c', eventId: 's', untilDate: '2026-09-30' }), 'nada')
  await restaurarSerie(cal, { calendarId: 'c', eventId: 's' })
  assert.equal(maestro.status, 'confirmed')
})
