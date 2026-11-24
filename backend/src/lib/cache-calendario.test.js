import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envolverConCache } from './cache-calendario.js'

function falso() {
  const llamadas = { listar: 0, marcar: 0 }
  let estado = 'PENDIENTE'
  const gcal = {
    listarInstancias: async ({ calendarId }) => { llamadas.listar++; return [{ id: 'e1', calendarId, extendedProperties: { private: { estado } } }] },
    marcarInstancia: async () => { llamadas.marcar++; estado = 'REALIZADA'; return { id: 'e1' } },
    leerInstancia: async () => ({ id: 'e1' })
  }
  return { gcal, llamadas }
}

test('dos lecturas iguales dentro del tiempo leen Calendar una sola vez', async () => {
  const { gcal, llamadas } = falso()
  let t = 0
  const c = envolverConCache(gcal, { ttlMs: 30_000, ahora: () => t })
  await c.listarInstancias({ calendarId: 'a', timeMin: 'x' })
  t = 10_000
  await c.listarInstancias({ calendarId: 'a', timeMin: 'x' })
  assert.equal(llamadas.listar, 1)
  t = 31_000
  await c.listarInstancias({ calendarId: 'a', timeMin: 'x' })
  assert.equal(llamadas.listar, 2)
})

test('pedidos simultaneos comparten la lectura', async () => {
  const { gcal, llamadas } = falso()
  const c = envolverConCache(gcal)
  await Promise.all([c.listarInstancias({ calendarId: 'a' }), c.listarInstancias({ calendarId: 'a' }), c.listarInstancias({ calendarId: 'a' })])
  assert.equal(llamadas.listar, 1)
})

test('marcar descarta lo guardado de ese calendario y se ve el cambio en el acto', async () => {
  const { gcal, llamadas } = falso()
  const c = envolverConCache(gcal)
  await c.listarInstancias({ calendarId: 'a' })
  await c.listarInstancias({ calendarId: 'b' })
  await c.marcarInstancia({ calendarId: 'a', instanceId: 'e1' })
  const [ev] = await c.listarInstancias({ calendarId: 'a' })
  assert.equal(ev.extendedProperties.private.estado, 'REALIZADA')
  assert.equal(llamadas.listar, 3)
  await c.listarInstancias({ calendarId: 'b' }) // el otro calendario sigue guardado
  assert.equal(llamadas.listar, 3)
})

test('quien modifica lo que recibe no ensucia lo guardado', async () => {
  const { gcal } = falso()
  const c = envolverConCache(gcal)
  const [ev] = await c.listarInstancias({ calendarId: 'a' })
  ev.extendedProperties.private.estado = 'ROTO'
  const [otra] = await c.listarInstancias({ calendarId: 'a' })
  assert.equal(otra.extendedProperties.private.estado, 'PENDIENTE')
})

test('un error no queda guardado', async () => {
  let fallar = true
  const c = envolverConCache({ listarInstancias: async () => { if (fallar) throw new Error('503'); return [] } })
  await assert.rejects(c.listarInstancias({ calendarId: 'a' }))
  fallar = false
  assert.deepEqual(await c.listarInstancias({ calendarId: 'a' }), [])
})

test('lo que no es lectura grande ni escritura pasa directo', async () => {
  const { gcal } = falso()
  const c = envolverConCache(gcal)
  assert.deepEqual(await c.leerInstancia({ calendarId: 'a', instanceId: 'e1' }), { id: 'e1' })
})
