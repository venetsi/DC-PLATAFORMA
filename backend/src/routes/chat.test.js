import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manejarEvento } from './chat.js'

// Sacaron la app de un Space: es la UNICA forma en que un vinculo se da de
// baja solo (un 403 puntual al postear ya no desvincula).
function fastifyFalso() {
  const llamadas = []
  return {
    llamadas,
    log: { info() {}, warn() {} },
    db: {
      departamento: { updateMany: async (a) => { llamadas.push(['departamento', a]); return { count: 1 } } },
      departamentoCompartidoEnSpace: { deleteMany: async (a) => { llamadas.push(['compartidos', a]); return { count: 2 } } }
    }
  }
}

test('REMOVED_FROM_SPACE: se desvincula el duenio Y se sacan los compartidos de ese Space', async () => {
  const fastify = fastifyFalso()
  const r = await manejarEvento(fastify, { chat: { removedFromSpacePayload: { space: { name: 'spaces/MIX' } } } })
  assert.deepEqual(r, {})
  assert.deepEqual(fastify.llamadas, [
    ['departamento', { where: { chat_space_name: 'spaces/MIX' }, data: { chat_space_name: null } }],
    ['compartidos', { where: { chat_space_name: 'spaces/MIX' } }]
  ])
})

test('REMOVED_FROM_SPACE sin nombre de Space: no toca nada', async () => {
  const fastify = fastifyFalso()
  await manejarEvento(fastify, { chat: { removedFromSpacePayload: {} } })
  assert.equal(fastify.llamadas.length, 0)
})
