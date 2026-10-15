// El job de las 8:00 con la base, Calendar y Chat falsos. Es lo que antes no
// se podia probar: el modulo se ejecutaba solo al importarse.
process.env.AVISOS_NO_EJECUTAR = '1'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { correr } = await import('./avisosChat.js')

// ── Escenario ────────────────────────────────────────────────────────────────

// Martes 6/10/2026, 8:00 en Argentina (modo diario). Para el semanal, se fuerza
// con AVISO_MODO=semanal (la semana es la del 5/10).
const AHORA = new Date('2026-10-06T11:00:00Z')

const depto = (id, nombre, extra = {}) => ({
  id,
  nombre,
  slug: nombre.toLowerCase().replace(/[^a-z]/g, ''),
  activo: true,
  id_calendar_google: `cal-${id}`,
  chat_space_name: `spaces/${id.toUpperCase()}`,
  chat_webhook_url: null,
  ...extra
})

// Una tarea vencida el 1/10 (atrasada), de un local sin nombre en el mapa.
const evento = (id, fecha, extra = {}) => ({
  id: `${id}_${fecha}`,
  summary: `Tarea ${id}`,
  start: { date: fecha },
  end: { date: fecha },
  extendedProperties: { private: { estado: 'PENDIENTE', nombre_tarea: `Tarea ${id}`, asignado_a: `${id}@dcsmart.app`, ...extra } }
})

function armar({ departamentos, eventos = {}, fallanLectura = new Set(), truncan = new Set(), fallanEnvio = new Set(), feriados = ['2026-10-12'], compartidos = [], compartidosTira = false, env = {}, tareasAsignaciones, series = { filas: [], fallidas: 0 } } = {}) {
  const enviados = []
  const listar = async ({ calendarId }) => {
    if (fallanLectura.has(calendarId) || fallanLectura.has('*')) throw Object.assign(new Error('Calendar caido'), { code: 500 })
    const lista = [...(eventos[calendarId] || [])]
    if (truncan.has(calendarId)) Object.defineProperty(lista, 'truncado', { value: true })
    return lista
  }
  const prisma = {
    departamento: { findMany: async ({ where }) => (where?.id_calendar_google ? departamentos : departamentos.map((d) => ({ id: d.id, nombre: d.nombre }))) },
    extLocal: { findMany: async () => [] },
    departamentoCompartidoEnSpace: { findMany: async () => { if (compartidosTira) throw new Error('la base no responde'); return compartidos } },
    tareaAsignacionDependencia: { findMany: async () => [] }
  }
  // Transporte falso: soporta lo que tiene Space; falla las etiquetas pedidas.
  const transporte = {
    soporta: (destino) => Boolean(destino?.chat_space_name),
    async enviar(destino, mensaje) {
      if (fallanEnvio.has(mensaje.etiqueta) || fallanEnvio.has('*')) throw new Error('403 Space inaccesible')
      enviados.push({ etiqueta: mensaje.etiqueta, space: destino.chat_space_name, texto: mensaje.texto })
    }
  }
  const opciones = {
    prisma,
    listar,
    cargarFeriadosFn: async () => feriados,
    crearTransporte: () => transporte,
    ahora: AHORA,
    leerSeries: async () => series,
    env: { AVISO_MODO: 'diario', ...env },
    esperar: async () => {},
    pausaEnvioMs: 0
  }
  return { opciones, enviados }
}

const direccion = depto('dir', 'Dirección', { slug: 'direccion' })
const costos = depto('cos', 'Costos')
const reportes = depto('rep', 'Reportes')
const conAtrasada = (d, extra) => ({ [d.id_calendar_google]: [evento(d.id, '2026-10-01', extra)] })

// ── Fallos de lectura ────────────────────────────────────────────────────────

test('un departamento que no se puede leer NO tumba a los demas, y Direccion se entera', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, direccion, reportes],
    eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) },
    fallanLectura: new Set([reportes.id_calendar_google])
  })
  const r = await correr(opciones)

  assert.deepEqual(r.errores_lectura.map((e) => e.departamento), ['Reportes'])
  assert.equal(enviados.some((m) => m.etiqueta === 'costos'), true, 'Costos recibio su aviso')
  assert.equal(enviados.some((m) => m.etiqueta === 'reportes'), false)
  const aviso = enviados.find((m) => m.etiqueta === 'direccion (advertencia)')
  assert.match(aviso.texto, /No pude leer la agenda de:\n• Reportes: Calendar caido/)
  assert.equal(r.advertencia_a_direccion, 'enviada')
  assert.deepEqual([r.veredicto.falla_total, r.veredicto.hubo_errores], [false, true])
})

test('ningun departamento se puede leer -> falla total (codigo 1: reintentar es seguro), y avisa en el primer intento', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], fallanLectura: new Set(['*']) })
  const r = await correr(opciones)
  assert.equal(r.veredicto.falla_total, true)
  assert.match(r.veredicto.problemas[0], /ningun departamento/)
  assert.equal(r.advertencia_a_direccion, 'enviada')
  assert.equal(enviados.filter((m) => m.etiqueta === 'direccion (advertencia)').length, 1)
})

test('en un REINTENTO de la ejecucion la advertencia no se repite', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], fallanLectura: new Set(['*']), env: { CLOUD_RUN_TASK_ATTEMPT: '2' } })
  const r = await correr(opciones)
  assert.equal(r.veredicto.falla_total, true)
  assert.equal(r.advertencia_a_direccion, 'omitida (reintento)')
  assert.equal(enviados.length, 0)
})

test('una lectura TRUNCADA cuenta como no leida (antes se avisaba a medias)', async () => {
  const { opciones } = armar({ departamentos: [costos, direccion], eventos: conAtrasada(costos), truncan: new Set([costos.id_calendar_google]) })
  const r = await correr(opciones)
  assert.deepEqual(r.errores_lectura.map((e) => e.departamento), ['Costos'])
  assert.match(r.errores_lectura[0].error, /truncada/)
})

test('cero departamentos con calendario NO es un dia tranquilo: falla total', async () => {
  const { opciones } = armar({ departamentos: [] })
  const r = await correr(opciones)
  assert.equal(r.veredicto.falla_total, true)
  assert.match(r.veredicto.problemas[0], /ningun departamento activo/)
})

// ── Fallos de envio ──────────────────────────────────────────────────────────

test('si falla el envio de UNO, los otros salen y es un fallo parcial (codigo 0: un reintento duplicaria)', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, direccion, reportes],
    eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) },
    fallanEnvio: new Set(['costos'])
  })
  const r = await correr(opciones)
  assert.deepEqual(r.fallidos.map((f) => f.etiqueta), ['costos'])
  assert.equal(enviados.some((m) => m.etiqueta === 'reportes'), true)
  assert.deepEqual([r.veredicto.falla_total, r.veredicto.hubo_errores], [false, true])
  const aviso = enviados.find((m) => m.etiqueta === 'direccion (advertencia)')
  assert.match(aviso.texto, /No pude avisar en:\n• costos: 403 Space inaccesible \(¿sacaron la app del Space\?\)/)
})

test('si habia avisos y NO salio ninguno -> falla total', async () => {
  const { opciones } = armar({ departamentos: [costos, reportes], eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) }, fallanEnvio: new Set(['*']) })
  const r = await correr(opciones)
  assert.equal(r.veredicto.falla_total, true)
  assert.match(r.veredicto.problemas[0], /para enviar y no salio ninguno/)
})

test('si ni Direccion se puede avisar, queda dicho (ALERTA en el log y en el resultado)', async () => {
  const { opciones } = armar({
    departamentos: [costos, direccion],
    eventos: conAtrasada(costos),
    fallanLectura: new Set([costos.id_calendar_google]),
    fallanEnvio: new Set(['direccion (advertencia)'])
  })
  const errores = []
  const original = console.error
  console.error = (...a) => errores.push(a.join(' '))
  try {
    const r = await correr(opciones)
    assert.equal(r.advertencia_a_direccion, 'fallo')
  } finally {
    console.error = original
  }
  assert.equal(errores.some((e) => e.includes('ALERTA: no se pudo advertir a Direccion')), true)
})

test('todo bien: nada que advertir y sin errores', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion, reportes], eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) } })
  const r = await correr(opciones)
  assert.deepEqual([r.veredicto.falla_total, r.veredicto.hubo_errores, r.advertencia_a_direccion], [false, false, null])
  assert.deepEqual(enviados.map((m) => m.etiqueta).sort(), ['costos', 'reportes'])
})

test('feriados sin cargar: se dice (los dias de atraso se cuentan de mas)', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], eventos: conAtrasada(costos), feriados: [] })
  const r = await correr(opciones)
  assert.equal(r.feriados_cargados, false)
  assert.equal(r.veredicto.hubo_errores, true)
  assert.match(enviados.find((m) => m.etiqueta === 'direccion (advertencia)').texto, /No pude cargar los feriados/)
})

// ── Resumen de los lunes ─────────────────────────────────────────────────────

const lunes = { AVISO_MODO: 'semanal' }

test('semanal: un departamento sin leer se dice aparte en el resumen a Direccion, y el % no se presenta como global', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, direccion, reportes],
    eventos: conAtrasada(costos),
    fallanLectura: new Set([reportes.id_calendar_google]),
    env: lunes
  })
  const r = await correr(opciones)
  const resumen = enviados.find((m) => m.etiqueta === 'direccion (resumen semanal)')
  assert.match(resumen.texto, /⚠️ \*No pude leer la agenda de:\* Reportes\. Faltan en este resumen\./)
  assert.deepEqual(r.errores_lectura.map((e) => e.departamento), ['Reportes'])
})

test('semanal: un departamento con tareas y SIN Space se lista (antes figuraba como "omitido" y nadie se enteraba)', async () => {
  const sinSpace = depto('ope', 'Operaciones', { chat_space_name: null })
  const { opciones, enviados } = armar({
    departamentos: [sinSpace, direccion],
    eventos: conAtrasada(sinSpace),
    env: lunes
  })
  const r = await correr(opciones)
  assert.deepEqual(r.sin_canal, ['Operaciones'])
  assert.match(enviados.find((m) => m.etiqueta === 'direccion (resumen semanal)').texto, /sin Space donde recibir avisos:\* Operaciones/)
})

test('semanal: un Space combinado cubre al departamento sin Space propio, asi que no se lista como sin canal', async () => {
  const sinSpace = depto('ope', 'Operaciones', { chat_space_name: null })
  const { opciones, enviados } = armar({
    departamentos: [sinSpace, costos, direccion],
    eventos: { ...conAtrasada(sinSpace), ...conAtrasada(costos) },
    compartidos: [{ chat_space_name: 'spaces/MIX', id_departamento: 'ope' }, { chat_space_name: 'spaces/MIX', id_departamento: 'cos' }],
    env: lunes
  })
  const r = await correr(opciones)
  assert.deepEqual(r.sin_canal, [])
  assert.equal(enviados.some((m) => m.space === 'spaces/MIX'), true, 'el Space combinado recibio su tarjeta')
})

test('semanal: si fallan los Spaces combinados, el resto sale y queda como error de armado', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], eventos: conAtrasada(costos), compartidosTira: true, env: lunes })
  const r = await correr(opciones)
  assert.deepEqual(r.errores_armado.map((e) => e.departamento), ['Spaces combinados'])
  assert.equal(enviados.some((m) => m.etiqueta === 'costos (semanal)'), true)
  assert.match(enviados.find((m) => m.etiqueta === 'direccion (advertencia)').texto, /No pude armar el aviso de:\n• Spaces combinados: la base no responde/)
})

test('semanal: si fallan TODOS los departamentos no se manda un resumen vacio a Direccion', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], fallanLectura: new Set(['*']), env: lunes })
  await correr(opciones)
  assert.equal(enviados.some((m) => m.etiqueta === 'direccion (resumen semanal)'), false)
})

// ── Series por terminar ──────────────────────────────────────────────────────

const serie = (dias, extra = {}) => ({ tarea: 'P&L', departamento: 'Reportes', local: 'TITA', fin: new Date(Date.UTC(2026, 9, 6 + dias)).toISOString().slice(0, 10), ...extra })

test('series por terminar: a diario solo si a alguna le quedan 7 dias o menos', async () => {
  const lejos = armar({ departamentos: [direccion], series: { filas: [serie(20)], fallidas: 0 } })
  const r1 = await correr(lejos.opciones)
  assert.equal(r1.series_por_terminar, 1)
  assert.equal(lejos.enviados.filter((m) => /por terminar/.test(m.etiqueta)).length, 0)

  const cerca = armar({ departamentos: [direccion], series: { filas: [serie(5)], fallidas: 0 } })
  await correr(cerca.opciones)
  const m = cerca.enviados.find((x) => /por terminar/.test(x.etiqueta))
  assert.match(m.texto, /P&L.*Reportes.*termina en 5 días/)
  assert.match(m.texto, /reagendar la secuencia/)
})

test('series por terminar: los lunes (semanal) se avisa aunque falten 20 dias', async () => {
  const { opciones, enviados } = armar({ departamentos: [direccion], env: { AVISO_MODO: 'semanal' }, series: { filas: [serie(20)], fallidas: 0 } })
  await correr(opciones)
  assert.equal(enviados.filter((m) => /por terminar/.test(m.etiqueta)).length, 1)
})

test('series por terminar: si no se pueden leer, Direccion se entera en vez de callar', async () => {
  const { opciones } = armar({ departamentos: [direccion], series: { filas: [], fallidas: 3 } })
  const r = await correr(opciones)
  assert.ok(r.errores_armado?.some?.((e) => /Series por terminar/.test(e.departamento)) || JSON.stringify(r).includes('Series por terminar'))
})

// ── Spaces que cubren varios departamentos (2026-10-15) ──────────────────────
// Un Space vinculado a varios departamentos recibe lo de TODOS: el recordatorio
// diario, el resumen del lunes y, mas abajo, el aviso de tareas liberadas.

test('diario: un Space propio con otro departamento vinculado recibe los avisos de los dos', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, reportes, direccion],
    eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) },
    compartidos: [{ chat_space_name: costos.chat_space_name, id_departamento: 'rep' }]
  })
  await correr(opciones)
  const enSpaceDeCostos = enviados.filter((m) => m.space === costos.chat_space_name).map((m) => m.etiqueta)
  assert.ok(enSpaceDeCostos.includes('costos') && enSpaceDeCostos.some((e) => e.startsWith('reportes')), enSpaceDeCostos.join(' | '))
  assert.equal(enviados.some((m) => m.etiqueta === 'reportes' && m.space === reportes.chat_space_name), true, 'Reportes sigue recibiendo en su Space')
})

test('diario: un Space combinado sin dueño recibe el recordatorio de cada departamento que cubre', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, reportes, direccion],
    eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) },
    compartidos: [{ chat_space_name: 'spaces/MIX', id_departamento: 'cos' }, { chat_space_name: 'spaces/MIX', id_departamento: 'rep' }]
  })
  await correr(opciones)
  assert.equal(enviados.filter((m) => m.space === 'spaces/MIX').length, 2)
  // Y cada uno conserva el de su Space propio.
  assert.equal(enviados.some((m) => m.etiqueta === 'costos' && m.space === costos.chat_space_name), true)
})

test('diario: sin Spaces compartidos todo sale como antes', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, reportes, direccion], eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) } })
  await correr(opciones)
  assert.equal(enviados.filter((m) => m.etiqueta === 'costos' || m.etiqueta === 'reportes').length, 2)
})

test('semanal: un Space propio con otro departamento recibe UNA tarjeta con los dos, y el dueño no la recibe repetida', async () => {
  const { opciones, enviados } = armar({
    departamentos: [costos, reportes, direccion],
    eventos: { ...conAtrasada(costos), ...conAtrasada(reportes) },
    compartidos: [{ chat_space_name: costos.chat_space_name, id_departamento: 'rep' }],
    env: { AVISO_MODO: 'semanal' }
  })
  await correr(opciones)
  const enSpaceDeCostos = enviados.filter((m) => m.space === costos.chat_space_name)
  assert.equal(enSpaceDeCostos.length, 1, enSpaceDeCostos.map((m) => m.etiqueta).join(' | '))
  assert.match(enSpaceDeCostos[0].etiqueta, /combinado/)
  assert.equal(enviados.some((m) => m.etiqueta === 'costos (semanal)'), false)
  assert.equal(enviados.some((m) => m.etiqueta === 'reportes (semanal)'), true, 'Reportes recibe su tarjeta en su Space')
})

test('semanal: un Space propio sin otros departamentos recibe su tarjeta de siempre', async () => {
  const { opciones, enviados } = armar({ departamentos: [costos, direccion], eventos: conAtrasada(costos), env: { AVISO_MODO: 'semanal' } })
  await correr(opciones)
  assert.equal(enviados.some((m) => m.etiqueta === 'costos (semanal)'), true)
})
