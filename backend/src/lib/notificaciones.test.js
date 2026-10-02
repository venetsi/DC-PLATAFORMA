import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearTransporteChat, crearTransporteChatApp, enviarEnSerie } from './notificaciones.js'
import { SpaceInaccesible } from './chat.js'

const silencioso = { warn() {}, info() {}, log() {} }

test('un Space inaccesible (403) NO se desvincula: el fallo se informa y se reintenta mañana', async () => {
  // Antes un solo 403/404 puntual ponia chat_space_name = null y el
  // departamento quedaba sin avisos sin que nadie se enterara.
  const llamadas = []
  const app = crearTransporteChatApp({ postear: async (space) => { llamadas.push(space); throw new SpaceInaccesible('no autorizado', 403) } })
  const destino = { slug: 'costos', nombre: 'Costos', chat_space_name: 'spaces/COS' }

  const r = await enviarEnSerie(app, [{ etiqueta: 'costos', destino, texto: 'hola' }, { etiqueta: 'otro', destino: { ...destino, chat_space_name: 'spaces/OTRO' }, texto: 'hola' }], { pausaMs: 0, log: silencioso })
  assert.equal(r.enviados, 0)
  assert.deepEqual(r.fallidos.map((f) => f.etiqueta), ['costos', 'otro'])
  assert.equal(llamadas.length, 2) // el primero roto no corta al segundo
})

test('chat-app: sin Space no soporta; con Space manda la card si la hay, si no el texto', async () => {
  const enviados = []
  const app = crearTransporteChatApp({ postear: async (space, cuerpo) => { enviados.push([space, cuerpo]) } })
  assert.equal(app.soporta({ chat_space_name: null }), false)
  await app.enviar({ chat_space_name: 'spaces/A' }, { texto: 'solo texto' })
  await app.enviar({ chat_space_name: 'spaces/A' }, { texto: 't', card: { cardsV2: [] } })
  assert.deepEqual(enviados, [['spaces/A', { text: 'solo texto' }], ['spaces/A', { cardsV2: [] }]])
})

test('con Space Y webhook gana el Space (no llega dos veces)', async () => {
  const hechos = []
  const chat = crearTransporteChat({
    postear: async () => { hechos.push('space') },
    fetchImpl: async () => { hechos.push('webhook'); return { ok: true } }
  })
  await chat.enviar({ chat_space_name: 'spaces/A', chat_webhook_url: 'https://x' }, { texto: 'hola' })
  await chat.enviar({ chat_webhook_url: 'https://x' }, { texto: 'hola' })
  assert.deepEqual(hechos, ['space', 'webhook'])
})

test('postear en Chat reintenta un 429 (seguro: no se creo) pero NO un 500 (ambiguo: se duplicaria)', async () => {
  const destino = { chat_space_name: 'spaces/A' }
  let n = 0
  const con429 = crearTransporteChatApp({ esperaBaseMs: 0, postear: async () => { n++; if (n < 3) throw Object.assign(new Error('cuota'), { code: 429 }) } })
  await con429.enviar(destino, { texto: 'hola' })
  assert.equal(n, 3)

  n = 0
  const con500 = crearTransporteChatApp({ esperaBaseMs: 0, postear: async () => { n++; throw Object.assign(new Error('interno'), { code: 500 }) } })
  await assert.rejects(con500.enviar(destino, { texto: 'hola' }), /interno/)
  assert.equal(n, 1)

  n = 0
  const sinAcceso = crearTransporteChatApp({ esperaBaseMs: 0, postear: async () => { n++; throw new SpaceInaccesible('sin acceso', 403) } })
  await assert.rejects(sinAcceso.enviar(destino, { texto: 'hola' }), SpaceInaccesible)
  assert.equal(n, 1) // un 403/404 no se reintenta
})
