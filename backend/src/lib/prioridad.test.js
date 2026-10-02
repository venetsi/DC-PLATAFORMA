import test from 'node:test'
import assert from 'node:assert/strict'
import { iconoDe, prefijoDe, pesoDe } from './prioridad.js'
import { prioridadValida } from './agenda.js'
import { lineaDeTarea } from './mensajes-chat.js'

test('iconoDe/prefijoDe: rojo, verde y nada', () => {
  assert.equal(iconoDe({ prioridad: 'ALTA' }), '🔴')
  assert.equal(iconoDe({ prioridad: 'NORMAL' }), '🟢')
  assert.equal(prefijoDe({}), '')
  assert.equal(prefijoDe({ prioridad: 'ALTA' }), '🔴 ')
  assert.ok(pesoDe({ prioridad: 'ALTA' }) < pesoDe({ prioridad: 'NORMAL' }))
})

test('prioridadValida: acepta ALTA/NORMAL/null/undefined y rechaza lo demas', () => {
  for (const ok of ['ALTA', 'NORMAL', null, undefined]) assert.doesNotThrow(() => prioridadValida(ok))
  assert.throws(() => prioridadValida('urgente'))
})

test('lineaDeTarea: el icono va al principio de la linea de Chat', () => {
  const evento = { summary: 'x', extendedProperties: { private: { nombre_tarea: 'P&L', prioridad: 'ALTA' } } }
  assert.match(lineaDeTarea({ evento, dias: 0 }, new Map()), /^• 🔴 P&L/)
})
