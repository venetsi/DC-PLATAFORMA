import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarCircuitos, estadoDelPaso, completarFila, compararFilas } from './circuito.js'
import { lunesDe } from '../routes/circuito.js'

const T = (id, nombre) => ({ id, nombre, id_departamento: id })
const VTA = T('vta', 'VTA/OP')
const CMV = T('cmv', 'CMV')
const INF = T('inf', 'Informe')
const PDP = T('pdp', 'PDP')
const CAJA = T('caja', 'Caja')

test('las esperas cargadas arman el circuito en orden: VTA/OP -> CMV -> Informe', () => {
  const c = armarCircuitos([
    { previa: CMV, espera: INF }, { previa: VTA, espera: CMV }, { previa: VTA, espera: INF }, { previa: VTA, espera: CMV }
  ])
  assert.equal(c.length, 1)
  assert.deepEqual(c[0].pasos.map((p) => p.nombre), ['VTA/OP', 'CMV', 'Informe'])
})

test('dos circuitos separados quedan separados, el mas largo primero', () => {
  const c = armarCircuitos([{ previa: PDP, espera: CAJA }, { previa: VTA, espera: CMV }, { previa: CMV, espera: INF }])
  assert.deepEqual(c.map((x) => x.pasos.map((p) => p.nombre)), [['VTA/OP', 'CMV', 'Informe'], ['PDP', 'Caja']])
})

test('esperas cruzadas entre dos tareas no cuelgan: quedan las dos', () => {
  const c = armarCircuitos([{ previa: VTA, espera: CMV }, { previa: CMV, espera: VTA }])
  assert.equal(c[0].pasos.length, 2)
})

const ev = (fecha, estado = 'PENDIENTE') => ({ start: { date: fecha }, extendedProperties: { private: { estado } } })
const SEMANA = { lunes: '2026-11-23', viernes: '2026-11-27', hoyISO: '2026-11-24' }

test('estado: una atrasada de antes manda, con dias habiles', () => {
  const r = estadoDelPaso([ev('2026-11-20'), ev('2026-11-25')], SEMANA)
  assert.equal(r.estado, 'atrasada')
  assert.equal(r.fecha, '2026-11-20')
  assert.equal(r.dias, 2)
})

test('estado: hoy, pendiente, hecha, no aplica y sin fecha', () => {
  assert.equal(estadoDelPaso([ev('2026-11-24')], SEMANA).estado, 'hoy')
  assert.deepEqual(estadoDelPaso([ev('2026-11-26')], SEMANA), { estado: 'pendiente', fecha: '2026-11-26' })
  assert.deepEqual(estadoDelPaso([ev('2026-11-23', 'REALIZADA')], SEMANA), { estado: 'hecha', fecha: '2026-11-23' })
  assert.equal(estadoDelPaso([ev('2026-11-23', 'NO_APLICA')], SEMANA).estado, 'no_aplica')
  assert.equal(estadoDelPaso([ev('2026-12-01')], SEMANA).estado, 'sin_fecha')
  assert.equal(estadoDelPaso([], SEMANA).estado, 'sin_fecha')
})

test('fila: el primer paso abierto frena; los de despues esperan', () => {
  const r = completarFila([{ estado: 'hecha' }, { estado: 'atrasada', dias: 1 }, { estado: 'pendiente' }])
  assert.equal(r.frena, 1)
  assert.ok(!r.pasos[1].espera)
  assert.equal(r.pasos[2].espera, true)
})

test('fila: un local sin un paso (null) no se traba ahi', () => {
  const r = completarFila([{ estado: 'hecha' }, null, { estado: 'hoy' }])
  assert.equal(r.frena, 2)
  assert.equal(r.pasos[1], null)
})

test('orden: atrasados (mas dias primero), hoy, pendientes, cerrados', () => {
  const fila = (local, pasos) => ({ local, ...completarFila(pasos) })
  const filas = [
    fila('Cerrado', [{ estado: 'hecha' }]),
    fila('Pendiente', [{ estado: 'pendiente', fecha: '2026-11-26' }]),
    fila('Atrasado 1', [{ estado: 'atrasada', dias: 1 }]),
    fila('Hoy', [{ estado: 'hoy' }]),
    fila('Atrasado 3', [{ estado: 'atrasada', dias: 3 }])
  ].sort(compararFilas)
  assert.deepEqual(filas.map((f) => f.local), ['Atrasado 3', 'Atrasado 1', 'Hoy', 'Pendiente', 'Cerrado'])
})

test('lunes de cualquier dia de la semana', () => {
  assert.equal(lunesDe('2026-11-24'), '2026-11-23')
  assert.equal(lunesDe('2026-11-23'), '2026-11-23')
  assert.equal(lunesDe('2026-11-29'), '2026-11-23')
})
