import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ejecutarBuscar, esPorTiempo, esMensajeDirecto, recortar, MAX_CARACTERES,
  TEXTO_SIN_PREGUNTA, TEXTO_SIN_DOCUMENTOS, TEXTO_SIN_GENERALES, AVISO_SIN_VINCULAR, TEXTO_LENTO, TEXTO_ERROR
} from './buscar-chat.js'
import { escaparPseudoEtiquetas } from './chat-texto.js'
import { responderPregunta } from './gemini-buscar.js'

// ── Escenario ────────────────────────────────────────────────────────────────
function armar({ ambito = { departamentos: [{ id: 'd1' }, { id: 'd2' }], porFallback: false }, repos = [{ gemini_file_search_store: 'fileSearchStores/a' }], respuesta = 'La política es X.', fallaPostear = false, fallaActualizar = false, responder, opciones = {} } = {}) {
  const reg = { repoIds: null, posteos: [], actualizaciones: [], logs: { info: [], error: [], warn: [] }, responderArgs: null }
  const log = {
    info: (o, m) => reg.logs.info.push([o, m]),
    error: (o, m) => reg.logs.error.push([o, m]),
    warn: (o, m) => reg.logs.warn.push([o, m])
  }
  const deps = {
    db: {},
    log,
    ambitoDelSpace: async () => ambito,
    repositoriosVisibles: async (_db, ids) => { reg.repoIds = ids; return repos },
    postear: async (space, cuerpo) => {
      if (fallaPostear) throw new Error('403 sin acceso')
      reg.posteos.push([space, cuerpo])
      return { name: 'spaces/S/messages/M' }
    },
    actualizar: async (name, cuerpo) => {
      if (fallaActualizar === 'cuelga') return new Promise(() => {})
      reg.intentos = (reg.intentos || 0) + 1
      if (fallaActualizar === 'primera' && reg.intentos === 1) throw new Error('invalidContent')
      if (fallaActualizar === true) throw new Error('Chat rechazó el mensaje')
      reg.actualizaciones.push([name, cuerpo])
    },
    responder: responder || (async (args) => { reg.responderArgs = args; return respuesta }),
    ...opciones
  }
  return { reg, deps }
}
const entrada = (extra = {}) => ({ pregunta: '¿política de viáticos?', space: 'spaces/S', extUser: { email: 'a@x' }, ...extra })

// ── Casos de salida inmediata ────────────────────────────────────────────────

test('sin pregunta: explica como usarlo y no consulta nada', async () => {
  const { deps, reg } = armar()
  const r = await ejecutarBuscar(entrada({ pregunta: '' }), deps)
  assert.equal(r.texto, TEXTO_SIN_PREGUNTA)
  assert.equal(reg.repoIds, null)
  assert.equal(reg.posteos.length, 0)
})

test('sin documentos cargados: lo dice y no llama a Gemini ni posta el placeholder', async () => {
  const { deps, reg } = armar({ repos: [{ gemini_file_search_store: null }] })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.equal(r.texto, TEXTO_SIN_DOCUMENTOS)
  assert.equal(reg.posteos.length, 0)
  assert.equal(reg.responderArgs, null)
})

test('si no se puede postear el placeholder: avisa y no gasta una consulta a Gemini', async () => {
  const { deps, reg } = armar({ fallaPostear: true })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.match(r.texto, /No pude iniciar la búsqueda/)
  assert.equal(reg.responderArgs, null)
})

// ── Camino feliz: el pedido espera el resultado ───────────────────────────────

test('camino feliz: placeholder, respuesta en el mismo mensaje, y el pedido NO termina antes de actualizarlo', async () => {
  const { deps, reg } = armar()
  const r = await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(r, { texto: null })
  assert.deepEqual(reg.posteos, [['spaces/S', { text: '🔎 Buscando…' }]])
  // Al volver, la actualizacion YA se hizo (antes se devolvia `{}` y se actualizaba "por detras").
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: 'La política es X.' }]])
  assert.deepEqual(reg.repoIds, ['d1', 'd2'])
  assert.equal(reg.logs.info.at(-1)[0].buscar.estado, 'ok')
  assert.equal(typeof reg.logs.info.at(-1)[0].buscar.duracion_ms, 'number')
})

test('a Gemini se le pasa un AbortSignal para poder cortarlo (y se limpia el temporizador al terminar)', async () => {
  const { deps, reg } = armar()
  await ejecutarBuscar(entrada(), deps)
  assert.ok(reg.responderArgs.signal instanceof AbortSignal)
  assert.equal(reg.responderArgs.signal.aborted, false)
})

// ── 1. Timeout ───────────────────────────────────────────────────────────────

test('Gemini colgado: se corta a tiempo y el mensaje deja de decir "Buscando…"', async () => {
  const responder = ({ signal }) => new Promise((_, rechazar) => {
    signal.addEventListener('abort', () => rechazar(Object.assign(new Error('Request aborted by client'), { name: 'APIUserAbortError' })))
  })
  const { deps, reg } = armar({ responder, opciones: { plazoGeminiMs: 40, topePedidoMs: 2000 } })
  const t0 = Date.now()
  const r = await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(r, { texto: null })
  assert.ok(Date.now() - t0 < 1000, 'tenia que cortar cerca de los 40 ms, no esperar el tope total')
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_LENTO }]])
  assert.equal(reg.logs.info.at(-1)[0].buscar.estado, 'tiempo')
})

test('esPorTiempo reconoce el abort del SDK, su timeout y un ETIMEDOUT; no un error cualquiera', () => {
  assert.ok(esPorTiempo({ name: 'APIUserAbortError' }))
  assert.ok(esPorTiempo({ name: 'APIConnectionTimeoutError' }))
  assert.ok(esPorTiempo({ name: 'AbortError' }))
  assert.ok(esPorTiempo({ code: 'ETIMEDOUT' }))
  assert.ok(!esPorTiempo(new Error('429 cuota')))
})

test('un error de Gemini (no de tiempo) se dice distinto y no se confunde con lentitud', async () => {
  const { deps, reg } = armar({ responder: async () => { throw new Error('429 cuota') } })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_ERROR }]])
  assert.equal(reg.logs.info.at(-1)[0].buscar.estado, 'error')
})

test('tope del pedido: si actualizar se cuelga, el webhook igual contesta a tiempo', async () => {
  const { deps, reg } = armar({ fallaActualizar: 'cuelga', opciones: { plazoGeminiMs: 1000, topePedidoMs: 60 } })
  const t0 = Date.now()
  const r = await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(r, { texto: null })
  assert.ok(Date.now() - t0 < 800)
  assert.equal(reg.logs.warn.length, 1)
  assert.match(reg.logs.warn[0][1], /tope del pedido/)
})

test('si falla la actualizacion con la respuesta, se reintenta UNA vez con un texto de rescate (el mensaje no queda en "Buscando…")', async () => {
  const { deps, reg } = armar({ fallaActualizar: 'primera' })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(r, { texto: null })
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_ERROR }]])
  assert.match(reg.logs.info.at(-1)[0].buscar.estado, /reintento/)
})

test('si fallan los dos intentos de actualizar, no tira: queda en el log', async () => {
  const { deps, reg } = armar({ fallaActualizar: true })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(r, { texto: null })
  assert.ok(reg.logs.error.some(([, m]) => /no se pudo actualizar/.test(m)))
  assert.ok(reg.logs.error.some(([, m]) => /texto de rescate/.test(m)))
  assert.match(reg.logs.info.at(-1)[0].buscar.estado, /sin_actualizar/)
})

// ── 2. Escape de pseudo-etiquetas ────────────────────────────────────────────

test('la respuesta del modelo se sanea antes de actualizar: <algo> y <users/all> no llegan tal cual', async () => {
  const { deps, reg } = armar({ respuesta: 'Pedí <tarea> a <users/all>. *Dato* y <b>negrita</b> sí valen.' })
  await ejecutarBuscar(entrada(), deps)
  const texto = reg.actualizaciones[0][1].text
  assert.doesNotMatch(texto, /<tarea>|<users\/all>/)
  assert.match(texto, /\[tarea\]/)
  assert.match(texto, /\[users\/all\]/)
  assert.match(texto, /<b>negrita<\/b>/) // lo que Chat soporta se respeta
})

test('los mensajes de error tambien salen por la misma guarda', async () => {
  const { deps, reg } = armar({ responder: async () => { throw new Error('x') } })
  await ejecutarBuscar(entrada(), deps)
  assert.equal(reg.actualizaciones[0][1].text, escaparPseudoEtiquetas(TEXTO_ERROR))
})

test('escaparPseudoEtiquetas: respeta <b> <i> <u> <s> <font> <a>, cambia el resto, tolera no-strings', () => {
  assert.equal(escaparPseudoEtiquetas('<b>x</b> <i>y</i> <u>z</u> <s>w</s> <a href="u">l</a> <font color="#fff">f</font>'), '<b>x</b> <i>y</i> <u>z</u> <s>w</s> <a href="u">l</a> <font color="#fff">f</font>')
  assert.equal(escaparPseudoEtiquetas('<tarea> <users/123> <br>'), '[tarea] [users/123] [br]')
  assert.equal(escaparPseudoEtiquetas(undefined), undefined)
  assert.equal(escaparPseudoEtiquetas('sin angulos'), 'sin angulos')
})

// ── 3. Ambito sin vincular ───────────────────────────────────────────────────

test('Space sin vincular: se busca SOLO en lo general (ids vacios) y la respuesta lo avisa', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [{ id: 'mio' }], porFallback: true } })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.repoIds, [], 'no tiene que pasar el departamento propio de quien pregunta')
  const texto = reg.actualizaciones[0][1].text
  assert.match(texto, /La política es X\./)
  assert.ok(texto.includes(AVISO_SIN_VINCULAR.slice(0, 40)))
  assert.equal(reg.logs.info.at(-1)[0].buscar.solo_generales, true)
})

test('Space sin vincular y sin documentos generales: mensaje propio, sin consultar', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [{ id: 'mio' }], porFallback: true }, repos: [] })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.equal(r.texto, TEXTO_SIN_GENERALES)
  assert.equal(reg.posteos.length, 0)
})

test('sin departamento en absoluto: tambien solo lo general', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [], modoTodo: false, porFallback: false } })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.repoIds, [])
})

test('Space vinculado y modo todo: usa todos los departamentos del ambito, sin aviso', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], modoTodo: true, porFallback: false } })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.repoIds, ['a', 'b', 'c'])
  assert.doesNotMatch(reg.actualizaciones[0][1].text, /no está vinculado/)
})

// ── Lo que se le pasa al SDK de Gemini ───────────────────────────────────────

test('responderPregunta: corte por el timeout del SDK (NO por signal: el abort en vuelo no es fiable), sin reintentos del SDK, y la respuesta lleva las fuentes', async () => {
  let recibido
  const fastify = {
    gemini: {
      interactions: {
        create: async (params, opciones) => {
          recibido = { params, opciones }
          return {
            output_text: 'Respuesta',
            steps: [{ type: 'model_output', content: [{ type: 'text', annotations: [{ type: 'file_citation', file_name: 'politica.pdf' }] }] }]
          }
        }
      }
    }
  }
  const texto = await responderPregunta(fastify, { pregunta: 'p', storeNames: ['fileSearchStores/a'], signal: new AbortController().signal, plazoMs: 20000 })
  assert.equal(recibido.opciones.maxRetries, 0)
  assert.ok(recibido.opciones.timeout > 19000 && recibido.opciones.timeout <= 20000, `timeout ${recibido.opciones.timeout}`)
  assert.equal('signal' in recibido.opciones, false, 'no se pasa signal al SDK: con signal el SDK ignora su timeout')
  assert.deepEqual(recibido.params.tools, [{ type: 'file_search', file_search_store_names: ['fileSearchStores/a'] }])
  assert.equal(texto, 'Respuesta\n\n_Fuentes: politica.pdf_')
})

test('responderPregunta: un 503 transitorio se reintenta UNA vez (si queda tiempo); otro error no', async () => {
  let llamadas = 0
  const falla503 = Object.assign(new Error('overloaded'), { status: 503 })
  const fastify = { gemini: { interactions: { create: async () => { llamadas++; if (llamadas === 1) throw falla503; return { output_text: 'ok', steps: [] } } } } }
  assert.equal(await responderPregunta(fastify, { pregunta: 'p', storeNames: ['x'], plazoMs: 20000 }), 'ok')
  assert.equal(llamadas, 2)

  llamadas = 0
  const siempre = { gemini: { interactions: { create: async () => { llamadas++; throw falla503 } } } }
  await assert.rejects(responderPregunta(siempre, { pregunta: 'p', storeNames: ['x'], plazoMs: 20000 }), /overloaded/)
  assert.equal(llamadas, 2, 'solo UN reintento')

  llamadas = 0
  const mala = { gemini: { interactions: { create: async () => { llamadas++; throw Object.assign(new Error('400'), { status: 400 }) } } } }
  await assert.rejects(responderPregunta(mala, { pregunta: 'p', storeNames: ['x'], plazoMs: 20000 }), /400/)
  assert.equal(llamadas, 1)
})

test('responderPregunta: sin tiempo suficiente (< 4 s) o con signal abortado, NO reintenta', async () => {
  let llamadas = 0
  const falla = Object.assign(new Error('503'), { status: 503 })
  const fastify = { gemini: { interactions: { create: async () => { llamadas++; throw falla } } } }
  await assert.rejects(responderPregunta(fastify, { pregunta: 'p', storeNames: ['x'], plazoMs: 3000 }))
  assert.equal(llamadas, 1)
  llamadas = 0
  const ac = new AbortController(); ac.abort()
  await assert.rejects(responderPregunta(fastify, { pregunta: 'p', storeNames: ['x'], plazoMs: 20000, signal: ac.signal }))
  assert.equal(llamadas, 1)
})

test('responderPregunta: SIN_INFORMACION da el texto fijo', async () => {
  const fastify = { gemini: { interactions: { create: async () => ({ output_text: 'SIN_INFORMACION', steps: [] }) } } }
  assert.match(await responderPregunta(fastify, { pregunta: 'p', storeNames: ['x'] }), /No encontré esa información/)
})

// ── Revision del 2026-10-04: casos que faltaban ──────────────────────────────

test('chat privado con la app: NO se restringe a lo general (lo ve solo quien pregunta) y no lleva el aviso', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [{ id: 'mio1' }, { id: 'mio2' }], porFallback: true } })
  await ejecutarBuscar(entrada({ esMensajeDirecto: true }), deps)
  assert.deepEqual(reg.repoIds, ['mio1', 'mio2'])
  assert.doesNotMatch(reg.actualizaciones[0][1].text, /no está vinculado/)
})

test('esMensajeDirecto reconoce el recurso Space de la API y el formato viejo, y no un Space comun', () => {
  assert.ok(esMensajeDirecto({ spaceType: 'DIRECT_MESSAGE' }))
  assert.ok(esMensajeDirecto({ singleUserBotDm: true }))
  assert.ok(esMensajeDirecto({ type: 'DM' }))
  assert.ok(!esMensajeDirecto({ spaceType: 'SPACE', name: 'spaces/S' }))
  assert.ok(!esMensajeDirecto(undefined))
})

test('persona sin ningun departamento (ambito vacio sin fallback): solo lo general y con aviso', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [], porFallback: false } })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.repoIds, [])
  assert.ok(reg.actualizaciones[0][1].text.includes(AVISO_SIN_VINCULAR.slice(0, 40)))
})

test('respuesta larga: se recorta para no pasar el limite de Chat y se actualiza igual', async () => {
  const larga = Array.from({ length: 400 }, (_, i) => `Linea ${i} con bastante texto de relleno para ocupar espacio`).join('\n')
  const { deps, reg } = armar({ respuesta: larga })
  await ejecutarBuscar(entrada(), deps)
  const texto = reg.actualizaciones[0][1].text
  assert.ok(texto.length <= MAX_CARACTERES, `largo ${texto.length}`)
  assert.match(texto, /respuesta recortada/)
  assert.ok(texto.startsWith('Linea 0'))
})

test('recortar: no toca lo corto, corta en un salto de linea y deja el aviso', () => {
  assert.equal(recortar('corto'), 'corto')
  const t = recortar('a'.repeat(100) + '\n' + 'b'.repeat(5000), 500)
  assert.ok(t.length <= 500)
  assert.match(t, /recortada/)
})

test('respuesta larga sin vincular: entra el aviso completo igual y el total no pasa el limite', async () => {
  const { deps, reg } = armar({ ambito: { departamentos: [{ id: 'm' }], porFallback: true }, respuesta: 'x'.repeat(9000) })
  await ejecutarBuscar(entrada(), deps)
  const texto = reg.actualizaciones[0][1].text
  assert.ok(texto.length <= MAX_CARACTERES)
  assert.ok(texto.includes(AVISO_SIN_VINCULAR.slice(0, 40)))
})

test('respuesta vacia de Gemini: se avisa como error en vez de dejar un mensaje vacio', async () => {
  const { deps, reg } = armar({ respuesta: '   ' })
  await ejecutarBuscar(entrada(), deps)
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_ERROR }]])
})

test('un rechazo sin mensaje (undefined / null / string) no rompe el catch ni el pedido', async () => {
  for (const rechazo of [undefined, null, 'cadena']) {
    const { deps, reg } = armar({ responder: async () => { throw rechazo } })
    const r = await ejecutarBuscar(entrada(), deps)
    assert.deepEqual(r, { texto: null })
    assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_ERROR }]])
  }
})

test('los plazos se miden desde que LLEGA el evento: si ya paso casi todo el tope, el plazo de Gemini es corto', async () => {
  // Reloj falso: el evento llego hace 20 s. Tope 27 s - 20 s - 4 s de margen = 3 s para Gemini.
  let reloj = 20000
  const { deps, reg } = armar({ opciones: { ahora: () => reloj, topePedidoMs: 27000 } })
  let abortoEn = null
  deps.responder = ({ signal }) => new Promise((resolver, rechazar) => {
    const t0 = Date.now()
    signal.addEventListener('abort', () => {
      abortoEn = Date.now() - t0
      rechazar(Object.assign(new Error('abort'), { name: 'APIUserAbortError' }))
    })
  })
  await ejecutarBuscar(entrada({ inicioPedido: 0 }), deps)
  assert.ok(abortoEn !== null && abortoEn >= 2500 && abortoEn < 4500, `Gemini se corto a los ${abortoEn} ms (esperado ~3000, no 22000)`)
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_LENTO }]])
})

test('el tramo previo (ambito/repositorios/placeholder) tambien esta acotado: si se cuelga, se contesta a tiempo', async () => {
  const { deps } = armar({ opciones: { topePedidoMs: 60 } })
  deps.postear = () => new Promise(() => {}) // Chat colgado antes de poder postear
  const t0 = Date.now()
  const r = await ejecutarBuscar(entrada(), deps)
  assert.ok(Date.now() - t0 < 800)
  assert.equal(r.texto, TEXTO_LENTO) // sin placeholder, la persona no ve nada: se le avisa por el webhook
})

test('un fallo de la base antes de responder se convierte en mensaje, no en un 500', async () => {
  const { deps } = armar()
  deps.ambitoDelSpace = async () => { throw new Error('base caida') }
  const r = await ejecutarBuscar(entrada(), deps)
  assert.equal(r.texto, TEXTO_ERROR)
})

// ── Cancelacion al vencer el tope (hallazgo del harness de punta a punta) ─────

test('si el tope vence ANTES de poder postear el placeholder: el webhook avisa y NO queda un mensaje fantasma ni se consulta a Gemini', async () => {
  let liberar
  const { deps, reg } = armar({ opciones: { topePedidoMs: 50 } })
  deps.postear = (space, cuerpo) => new Promise((resolver) => { liberar = () => { reg.posteos.push([space, cuerpo]); resolver({ name: 'spaces/S/messages/M' }) } })
  const r = await ejecutarBuscar(entrada(), deps)
  assert.equal(r.texto, TEXTO_LENTO)
  // Chat contesta tarde: el placeholder aparece, pero no se consulta a Gemini y se deja el texto de "tardo demasiado".
  liberar()
  await new Promise((resolver) => setTimeout(resolver, 30))
  assert.equal(reg.responderArgs, null, 'no se debe consultar a Gemini despues de haber contestado')
  assert.deepEqual(reg.actualizaciones, [['spaces/S/messages/M', { text: TEXTO_LENTO }]])
})

test('si el tope vence mientras esperaba al ambito, no se postea nada despues', async () => {
  const { deps, reg } = armar({ opciones: { topePedidoMs: 40 } })
  deps.ambitoDelSpace = () => new Promise((resolver) => setTimeout(() => resolver({ departamentos: [{ id: 'd1' }], porFallback: false }), 120))
  const r = await ejecutarBuscar(entrada(), deps)
  assert.equal(r.texto, TEXTO_LENTO)
  await new Promise((resolver) => setTimeout(resolver, 250))
  assert.equal(reg.posteos.length, 0)
  assert.equal(reg.responderArgs, null)
})

test('a responder se le pasa el plazo (plazoMs) ademas del signal', async () => {
  const { deps, reg } = armar({ opciones: { topePedidoMs: 25000, plazoGeminiMs: 21000 } })
  await ejecutarBuscar(entrada(), deps)
  assert.ok(reg.responderArgs.plazoMs > 20000 && reg.responderArgs.plazoMs <= 21000, `plazoMs ${reg.responderArgs.plazoMs}`)
  assert.ok(reg.responderArgs.signal instanceof AbortSignal)
})
