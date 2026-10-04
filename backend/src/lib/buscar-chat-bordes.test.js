// Bordes de /buscar que la revision del 2026-10-04 encontro sin cubrir: lo que
// recibe cada dependencia (el borde de PERMISOS), la limpieza de temporizadores,
// el corte cuando el SDK ignora el signal, y el saneado de texto.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ejecutarBuscar, TEXTO_LENTO, TEXTO_NO_INICIO, TEXTO_SIN_PREGUNTA, TEXTO_ERROR } from './buscar-chat.js'
import { escaparPseudoEtiquetas } from './chat-texto.js'

function armar(extra = {}) {
  const reg = { ambitoArgs: null, repoArgs: null, responderArgs: null, posteos: [], actualizaciones: [] }
  const deps = {
    db: { marca: 'db' },
    log: { info() {}, error() {}, warn() {} },
    ambitoDelSpace: async (db, args) => { reg.ambitoArgs = { db, ...args }; return { departamentos: [{ id: 'd1' }], porFallback: false } },
    repositoriosVisibles: async (db, ids) => { reg.repoArgs = { db, ids }; return [{ gemini_file_search_store: 'fileSearchStores/a' }, { gemini_file_search_store: null }, { gemini_file_search_store: 'fileSearchStores/b' }] },
    postear: async (space, cuerpo) => { reg.posteos.push([space, cuerpo]); return { name: 'spaces/S/messages/M' } },
    actualizar: async (name, cuerpo) => { reg.actualizaciones.push([name, cuerpo]) },
    responder: async (args) => { reg.responderArgs = args; return 'ok' },
    ...extra
  }
  return { reg, deps }
}
const extUser = { email: 'ana@x', marca: 'ext' }

test('al ambito se le pasa el Space y la persona REAL (si se pierden, se buscaria en otro ambito) y a Gemini la pregunta y solo los stores con contenido', async () => {
  const { deps, reg } = armar()
  await ejecutarBuscar({ pregunta: '¿viáticos?', space: 'spaces/AAA', extUser }, deps)
  assert.deepEqual(reg.ambitoArgs, { db: deps.db, space: 'spaces/AAA', extUser })
  assert.deepEqual(reg.repoArgs, { db: deps.db, ids: ['d1'] })
  assert.equal(reg.responderArgs.pregunta, '¿viáticos?')
  assert.deepEqual(reg.responderArgs.storeNames, ['fileSearchStores/a', 'fileSearchStores/b'])
  assert.deepEqual(reg.posteos, [['spaces/AAA', { text: '🔎 Buscando…' }]])
})

test('pregunta de solo espacios o no-string: se trata como vacia', async () => {
  for (const pregunta of ['   ', '\n\t', undefined, null]) {
    const { deps, reg } = armar()
    const r = await ejecutarBuscar({ pregunta, space: 'spaces/S', extUser }, deps)
    assert.equal(r.texto, TEXTO_SIN_PREGUNTA)
    assert.equal(reg.ambitoArgs, null)
  }
})

test('la pregunta se recorta de espacios antes de mandarla', async () => {
  const { deps, reg } = armar()
  await ejecutarBuscar({ pregunta: '  hola  ', space: 'spaces/S', extUser }, deps)
  assert.equal(reg.responderArgs.pregunta, 'hola')
})

test('si Chat no devuelve el nombre del mensaje no se puede actualizar: se avisa, sin gastar una consulta', async () => {
  const { deps, reg } = armar({ postear: async () => ({}) })
  const r = await ejecutarBuscar({ pregunta: 'x', space: 'spaces/S', extUser }, deps)
  assert.equal(r.texto, TEXTO_NO_INICIO)
  assert.equal(reg.responderArgs, null)
})

test('un responder que IGNORA el signal igual se corta al cumplirse el plazo (el corte no depende del SDK)', async () => {
  const { deps, reg } = armar({ responder: () => new Promise(() => {}), plazoGeminiMs: 50, topePedidoMs: 5000 })
  const t0 = Date.now()
  const r = await ejecutarBuscar({ pregunta: 'x', space: 'spaces/S', extUser }, deps)
  assert.deepEqual(r, { texto: null })
  assert.ok(Date.now() - t0 < 1500, `tardo ${Date.now() - t0} ms`)
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_LENTO }]])
})

test('no quedan temporizadores vivos: cada setTimeout que arma el modulo se limpia (camino normal, error y tope)', async () => {
  const creados = new Set()
  const setReal = globalThis.setTimeout
  const clearReal = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms, ...resto) => { const h = setReal(fn, ms, ...resto); if (ms >= 1000) creados.add(h); return h }
  globalThis.clearTimeout = (h) => { creados.delete(h); return clearReal(h) }
  try {
    const casos = [
      armar(),
      armar({ responder: async () => { throw new Error('x') } }),
      armar({ actualizar: async () => { throw new Error('y') } })
    ]
    for (const { deps } of casos) await ejecutarBuscar({ pregunta: 'x', space: 'spaces/S', extUser }, deps)
    assert.equal(creados.size, 0, `quedaron ${creados.size} temporizadores largos sin limpiar`)
  } finally {
    globalThis.setTimeout = setReal
    globalThis.clearTimeout = clearReal
  }
})

test('los mensajes de error tambien pasan por el saneado: el texto de error se escapa igual que cualquier otro', async () => {
  const { deps, reg } = armar({ responder: async () => { throw new Error('x') } })
  await ejecutarBuscar({ pregunta: 'x', space: 'spaces/S', extUser }, deps)
  assert.equal(reg.actualizaciones[0][1].text, escaparPseudoEtiquetas(TEXTO_ERROR))
})

// ── escaparPseudoEtiquetas ───────────────────────────────────────────────────

test('escape: mayusculas, <> vacio y multilinea', () => {
  assert.equal(escaparPseudoEtiquetas('<B>x</B> <Tarea>'), '<B>x</B> [Tarea]')
  assert.equal(escaparPseudoEtiquetas('<>'), '[]')
  assert.equal(escaparPseudoEtiquetas('<users/all\nmas>'), '[users/all\nmas]')
})

test('escape: menciones `<users/...>` siempre se neutralizan, tambien dentro de un nombre de archivo o de una lista', () => {
  assert.equal(escaparPseudoEtiquetas('Ver <users/all> y <users/123>'), 'Ver [users/all] y [users/123]')
  assert.equal(escaparPseudoEtiquetas('• informe_<users/all>.pdf'), '• informe_[users/all].pdf')
})

test('escape: una comparacion con "<" y ">" NO se corrompe (montos de una politica)', () => {
  assert.equal(escaparPseudoEtiquetas('solo para montos < 100 y > 50'), 'solo para montos < 100 y > 50')
  assert.equal(escaparPseudoEtiquetas('si x <5 y y> 3'), 'si x <5 y y> 3')
})

test('escape: los links con la sintaxis de Chat se respetan, y los esquemas raros no', () => {
  assert.equal(escaparPseudoEtiquetas('<https://ejemplo.com|ver acá>'), '<https://ejemplo.com|ver acá>')
  assert.equal(escaparPseudoEtiquetas('<mailto:a@b.com>'), '<mailto:a@b.com>')
  assert.equal(escaparPseudoEtiquetas('<javascript:alert(1)>'), '[javascript:alert(1)]')
})
