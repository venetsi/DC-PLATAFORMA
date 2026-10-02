import test from 'node:test'
import assert from 'node:assert/strict'
import {
  construirRecurrence, leerRecurrence, primeraFecha, fechasDeConfig,
  conFechasCerradas, conFechasAbiertas, esSerieDeFechas, fechasDeSerie, ultimaFechaDeSerie
} from './recurrencia.js'
import { conCierre } from './cerrar-serie.js'

const FECHAS = ['2026-10-07', '2026-11-06', '2026-12-07']

test('FECHAS: la primera fecha es el inicio y el resto va en RDATE', () => {
  const rec = construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-10-01')
  assert.ok(esSerieDeFechas(rec))
  assert.ok(rec.some((l) => l.startsWith('RDATE;VALUE=DATE:')))
  assert.deepEqual(fechasDeSerie(rec, '2026-10-07'), FECHAS)
})

test('FECHAS: ida y vuelta por leerRecurrence', () => {
  const rec = construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-10-01')
  const ag = leerRecurrence(rec, '2026-10-07')
  assert.equal(ag.recurrencia_tipo, 'FECHAS')
  assert.deepEqual(ag.recurrencia_config.fechas, FECHAS)
  assert.equal(ag.vigencia_hasta, null)
})

test('FECHAS: se descartan las fechas pasadas y sin fechas es un error', () => {
  assert.deepEqual(fechasDeSerie(construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-11-01'), '2026-11-06'), ['2026-11-06', '2026-12-07'])
  assert.throws(() => fechasDeConfig({ fechas: [] }))
  assert.throws(() => construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2027-01-01'))
  assert.equal(primeraFecha('FECHAS', { fechas: FECHAS }, '2026-10-20'), '2026-11-06')
})

test('FECHAS: cerrar excluye las futuras (EXDATE) y reabrir las devuelve', () => {
  const rec = construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-10-01')
  const cerrada = conCierre(rec, '2026-11-10')
  assert.ok(cerrada.some((l) => l.startsWith('EXDATE')))
  assert.equal(cerrada, conFechasCerradas(rec, '2026-11-10') && cerrada)
  const abierta = conFechasAbiertas(cerrada)
  assert.ok(!abierta.some((l) => l.startsWith('EXDATE')))
  assert.deepEqual(fechasDeSerie(abierta, '2026-10-07'), FECHAS)
})

test('FECHAS: leerRecurrence conExcluidas recupera todas las fechas de una serie cerrada', () => {
  const cerrada = conCierre(construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-10-01'), '2026-11-10')
  const ag = leerRecurrence(cerrada, '2026-10-07', { conExcluidas: true })
  assert.deepEqual(ag.recurrencia_config.fechas, FECHAS)
})

test('FECHAS: ultimaFechaDeSerie sirve para avisar que se quedan sin fechas', () => {
  const rec = construirRecurrence('FECHAS', { fechas: FECHAS }, null, '2026-10-01')
  assert.equal(ultimaFechaDeSerie(rec, '2026-10-07'), '2026-12-07')
})
