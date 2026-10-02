import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conReintento } from './reintento.js'

const error = (code) => Object.assign(new Error(`e${code}`), { code })

test('reintenta un 429 y devuelve el resultado cuando se resuelve', async () => {
  let llamadas = 0
  const r = await conReintento(async () => { llamadas++; if (llamadas < 3) throw error(429); return 'ok' }, { esperaBaseMs: 0 })
  assert.equal(r, 'ok')
  assert.equal(llamadas, 3)
})

test('un error que no es de cuota (404) no se reintenta', async () => {
  let llamadas = 0
  await assert.rejects(conReintento(async () => { llamadas++; throw error(404) }, { esperaBaseMs: 0 }), /e404/)
  assert.equal(llamadas, 1)
})

test('se rinde despues de los intentos y tira el ultimo error', async () => {
  let llamadas = 0
  await assert.rejects(conReintento(async () => { llamadas++; throw error(503) }, { intentos: 3, esperaBaseMs: 0 }), /e503/)
  assert.equal(llamadas, 3)
})

test('un 403 de PERMISOS (calendario no compartido) no se reintenta; uno de cuota si', async () => {
  let llamadas = 0
  const permisos = Object.assign(new Error('forbidden'), { code: 403, errors: [{ reason: 'forbidden' }] })
  await assert.rejects(conReintento(async () => { llamadas++; throw permisos }, { esperaBaseMs: 0 }), /forbidden/)
  assert.equal(llamadas, 1)

  llamadas = 0
  const cuota = Object.assign(new Error('rate'), { code: 403, errors: [{ reason: 'rateLimitExceeded' }] })
  assert.equal(await conReintento(async () => { llamadas++; if (llamadas < 2) throw cuota; return 'ok' }, { esperaBaseMs: 0 }), 'ok')
  assert.equal(llamadas, 2)
})

test('el estado puede venir de response.status, y un 504 tambien se reintenta', async () => {
  let llamadas = 0
  const r = await conReintento(async () => { llamadas++; if (llamadas === 1) throw Object.assign(new Error('x'), { response: { status: 429 } }); if (llamadas === 2) throw Object.assign(new Error('y'), { code: 504 }); return 'ok' }, { esperaBaseMs: 0 })
  assert.equal(r, 'ok')
  assert.equal(llamadas, 3)
})

test('con "codigos" propios solo se reintenta lo que se pide (para postear en Chat: 429 y 503, nunca 500)', async () => {
  const codigos = new Set([429, 503])
  let llamadas = 0
  await assert.rejects(conReintento(async () => { llamadas++; throw error(500) }, { esperaBaseMs: 0, codigos }), /e500/)
  assert.equal(llamadas, 1)
  llamadas = 0
  assert.equal(await conReintento(async () => { llamadas++; if (llamadas < 2) throw error(503); return 'ok' }, { esperaBaseMs: 0, codigos }), 'ok')
})
