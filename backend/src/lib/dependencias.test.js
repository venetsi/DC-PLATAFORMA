import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VENTANA_DIAS,
  correrDias,
  prerequisitoQueCorresponde,
  dependienteQueCorresponde,
  mapaDependencias,
  liberadasPor,
  prerrequisitosPendientes,
  cadenaDeInstancia
} from './dependencias.js'
import { avisarLiberadas } from './avisos-dependencias.js'
import { SpaceInaccesible } from './chat.js'

const inst = (...fechas) => fechas.map((fecha) => ({ fecha }))

test('el reporte del 3 espera al CMV del 1 (agendas distintas)', () => {
  const p = prerequisitoQueCorresponde(inst('2026-09-01', '2026-10-01'), ['2026-09-03', '2026-10-03'], '2026-10-03')
  assert.equal(p.fecha, '2026-10-01')
})

test('dos tareas diarias: espera a la del mismo dia', () => {
  const dias = ['2026-09-28', '2026-09-29', '2026-09-30']
  assert.equal(prerequisitoQueCorresponde(inst(...dias), dias, '2026-09-29').fecha, '2026-09-29')
})

test('un prerrequisito posterior a la fecha no aplica', () => {
  assert.equal(prerequisitoQueCorresponde(inst('2026-10-05'), ['2026-10-03'], '2026-10-03'), null)
})

test('un atraso viejo, anterior a la fecha anterior de la tarea, no aplica', () => {
  assert.equal(prerequisitoQueCorresponde(inst('2026-08-30'), ['2026-09-03', '2026-10-03'], '2026-10-03'), null)
})

test('diaria que depende de una semanal: solo el dia que le toca a la semanal', () => {
  const diaria = ['2026-09-28', '2026-09-29', '2026-09-30']
  const lunes = inst('2026-09-28')
  assert.equal(prerequisitoQueCorresponde(lunes, diaria, '2026-09-28').fecha, '2026-09-28')
  assert.equal(prerequisitoQueCorresponde(lunes, diaria, '2026-09-29'), null)
})

test('sin fecha anterior, mira hasta VENTANA_DIAS hacia atras', () => {
  const fecha = '2026-10-03'
  assert.equal(prerequisitoQueCorresponde(inst(correrDias(fecha, -(VENTANA_DIAS - 1))), [fecha], fecha)?.fecha, correrDias(fecha, -(VENTANA_DIAS - 1)))
  assert.equal(prerequisitoQueCorresponde(inst(correrDias(fecha, -VENTANA_DIAS)), [fecha], fecha), null)
})

test('la inversa: el CMV del 1 libera al reporte del 3', () => {
  const w = dependienteQueCorresponde(inst('2026-09-03', '2026-10-03'), ['2026-09-01', '2026-10-01'], '2026-10-01')
  assert.equal(w.fecha, '2026-10-03')
})

test('la inversa: si hay un prerrequisito mas nuevo antes, manda ese', () => {
  const reporte = inst('2026-10-03')
  assert.equal(dependienteQueCorresponde(reporte, ['2026-10-01', '2026-10-02'], '2026-10-01'), null)
  assert.equal(dependienteQueCorresponde(reporte, ['2026-10-01', '2026-10-02'], '2026-10-02').fecha, '2026-10-03')
})

test('la inversa: una tarea que espera fuera de la ventana no cuenta', () => {
  assert.equal(dependienteQueCorresponde(inst(correrDias('2026-10-01', VENTANA_DIAS)), ['2026-10-01'], '2026-10-01'), null)
})

// ── Con Calendar y base falsos ───────────────────────────────────────────────

function escenario() {
  const depto = (id, nombre) => ({ id, nombre, id_calendar_google: `cal-${id}` })
  const tesoreria = depto('tes', 'Tesorería')
  const auditoria = depto('aud', 'Auditoría')
  const costos = depto('cos', 'Costos')
  const asignacion = (id, nombre, departamento) => ({
    id,
    activa: true,
    id_calendar_event: `ev-${id}`,
    tarea: { nombre, activa: true, departamento },
    local: { nombre: 'TIAMO' }
  })
  const cmv = asignacion('cmv', 'CMV', costos)
  const cierre = asignacion('cierre', 'Cierre de caja', tesoreria)
  const reporte = asignacion('reporte', 'Reporte de ventas', auditoria)

  // reporte espera a cierre y a cmv; cierre espera a cmv.
  const filas = [
    { id: 'd1', id_asignacion: 'reporte', id_asignacion_prerequisito: 'cierre', activa: true, created_at: 1 },
    { id: 'd2', id_asignacion: 'reporte', id_asignacion_prerequisito: 'cmv', activa: true, created_at: 2 },
    { id: 'd3', id_asignacion: 'cierre', id_asignacion_prerequisito: 'cmv', activa: true, created_at: 3 }
  ]
  const porId = { cmv, cierre, reporte }
  for (const a of Object.values(porId)) {
    a.dependencias = filas.filter((f) => f.id_asignacion === a.id).map((f) => ({ ...f, prerequisito: porId[f.id_asignacion_prerequisito] }))
  }

  const estados = {} // `${id}|${fecha}` -> props extra
  const eventos = {
    cmv: ['2026-10-01'],
    cierre: ['2026-10-02'],
    reporte: ['2026-09-03', '2026-10-03']
  }
  const aEvento = (id, fecha) => ({
    id: `${id}_${fecha}`,
    start: { date: fecha },
    extendedProperties: { private: { id_asignacion: id, asignado_a: `${id}@dcsmart.app`, ...estados[`${id}|${fecha}`] } }
  })

  // Como Calendar: un pedido trae TODO el calendario del departamento.
  // `fallan`: calendarIds cuya lectura tira error (un 429/5xx de Calendar).
  // `truncan`: los que devuelven la lectura marcada como truncada.
  let lecturas = 0
  const fallan = new Set()
  const truncan = new Set()
  const gcal = {
    async listarInstancias({ calendarId }) {
      lecturas++
      if (fallan.has(calendarId)) throw Object.assign(new Error('Calendar no responde'), { code: 503 })
      const lista = Object.values(porId)
        .filter((a) => a.tarea.departamento.id_calendar_google === calendarId)
        .flatMap((a) => (eventos[a.id] || []).map((fecha) => aEvento(a.id, fecha)))
      if (truncan.has(calendarId)) Object.defineProperty(lista, 'truncado', { value: true })
      return lista
    }
  }

  const coincide = (fila, where) => {
    if (where.activa !== undefined && fila.activa !== where.activa) return false
    if (typeof where.id_asignacion === 'string' && fila.id_asignacion !== where.id_asignacion) return false
    if (typeof where.id_asignacion_prerequisito === 'string' && fila.id_asignacion_prerequisito !== where.id_asignacion_prerequisito) return false
    if (where.OR) {
      return where.OR.some((o) =>
        (o.id_asignacion?.in || []).includes(fila.id_asignacion) ||
        (o.id_asignacion_prerequisito?.in || []).includes(fila.id_asignacion_prerequisito))
    }
    return true
  }
  const db = {
    tareaAsignacionDependencia: {
      async findMany({ where }) {
        return filas.filter((f) => coincide(f, where)).map((f) => ({
          ...f,
          asignacion: porId[f.id_asignacion],
          prerequisito: porId[f.id_asignacion_prerequisito]
        }))
      }
    },
    tareaAsignacion: {
      async findUnique({ where }) { return porId[where.id] || null }
    }
  }
  const log = { warn() {}, info() {} }
  return { deps: { db, gcal, log }, estados, eventos, aEvento, filas, fallan, truncan, porId, lecturas: () => lecturas }
}

test('mapa: el reporte espera, el cierre frena al reporte', async () => {
  const { deps, aEvento } = escenario()
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03'), aEvento('cierre', '2026-10-02')] })

  const reporte = mapa.get('reporte|2026-10-03')
  assert.deepEqual(reporte.espera.map((p) => p.nombre_tarea).sort(), ['CMV', 'Cierre de caja'])
  assert.equal(reporte.listas, undefined)

  const cierre = mapa.get('cierre|2026-10-02')
  assert.deepEqual(cierre.la_espera.map((a) => a.nombre_tarea), ['Reporte de ventas'])
  assert.deepEqual(cierre.espera.map((p) => p.nombre_tarea), ['CMV'])
})

test('mapa: con todo hecho, el reporte queda "lista"', async () => {
  const { deps, estados, aEvento } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA', realizada_por: 'mgomez@dcsmart.app' }
  estados['cierre|2026-10-02'] = { estado: 'NO_APLICA', no_aplica_por: 'lruiz@dcsmart.app' }
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  const reporte = mapa.get('reporte|2026-10-03')
  assert.equal(reporte.espera, undefined)
  assert.deepEqual(reporte.listas.map((p) => p.estado).sort(), ['no_aplica', 'realizada'])
})

test('mapa: lee cada calendario una sola vez, no una por asignacion', async () => {
  const { deps, aEvento, lecturas } = escenario()
  await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03'), aEvento('cierre', '2026-10-02'), aEvento('cmv', '2026-10-01')] })
  // Tres asignaciones en tres departamentos: tres lecturas, no una por instancia ni por dependencia.
  assert.equal(lecturas(), 3)
})

test('mapa: sin dependencias cargadas no llama a Calendar', async () => {
  const { deps, filas, aEvento, lecturas } = escenario()
  filas.length = 0
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  assert.equal(mapa.size, 0)
  assert.equal(lecturas(), 0)
})

test('liberadas: marcar el cierre con el CMV pendiente no libera al reporte', async () => {
  const { deps } = escenario()
  const { liberadas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'lruiz@dcsmart.app' })
  assert.equal(liberadas.length, 0)
})

test('liberadas: marcar el ultimo que faltaba libera al reporte (aunque Calendar todavia no lo muestre)', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  const { prerequisito, liberadas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'lruiz@dcsmart.app' })
  assert.equal(prerequisito.nombre_tarea, 'Cierre de caja')
  assert.deepEqual(liberadas.map((l) => [l.nombre_tarea, l.fecha, l.responsable]), [['Reporte de ventas', '2026-10-03', 'reporte@dcsmart.app']])
})

test('liberadas: si el reporte ya estaba hecho, no hay nada que avisar', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  estados['reporte|2026-10-03'] = { estado: 'REALIZADA' }
  const { liberadas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(liberadas.length, 0)
})

test('pendientes al marcar: devuelve lo que falta con la forma de siempre', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  const pendientes = await prerrequisitosPendientes(deps, { idAsignacion: 'reporte', fechaISO: '2026-10-03' })
  assert.deepEqual(pendientes.map((p) => [p.tipo, p.nombre_tarea, p.departamento]), [['prerrequisito_pendiente', 'Cierre de caja', 'Tesorería']])
})

test('cadena: sube por el cierre hasta el CMV y muestra quien espera', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA', realizada_por: 'mgomez@dcsmart.app', realizada_en: '2026-10-01T12:15:00Z' }
  const { antes } = await cadenaDeInstancia(deps, { idAsignacion: 'reporte', fechaISO: '2026-10-03' })
  const cierre = antes.find((n) => n.nombre_tarea === 'Cierre de caja')
  assert.equal(cierre.estado === 'pendiente' || cierre.estado === 'vencida', true)
  assert.deepEqual(cierre.previos.map((n) => [n.nombre_tarea, n.estado, n.hecha_por]), [['CMV', 'realizada', 'mgomez@dcsmart.app']])

  const { despues } = await cadenaDeInstancia(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.deepEqual(despues.map((n) => [n.nombre_tarea, n.fecha]), [['Reporte de ventas', '2026-10-03']])
})

// ── Fallar cerrado: un error de lectura NO es "todo listo" ───────────────────

test('liberadas: si no se pudo leer la agenda del OTRO prerrequisito, no se avisa (antes salia un "Ya podés hacerla" falso)', async () => {
  const { deps, fallan } = escenario()
  // El CMV sigue pendiente, pero su calendario (Costos) no responde. Antes se
  // leia como "no tiene instancia" -> "no espera nada" -> aviso falso.
  fallan.add('cal-cos')
  const { liberadas, incompletas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'lruiz@dcsmart.app' })
  assert.equal(liberadas.length, 0)
  assert.deepEqual(incompletas.map((i) => [i.nombre_tarea, i.faltan_verificar]), [['Reporte de ventas', ['CMV']]])
})

test('liberadas: si no se pudo leer la agenda de la tarea que espera, tampoco se avisa', async () => {
  const { deps, estados, fallan } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  fallan.add('cal-aud')
  const { liberadas, incompletas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(liberadas.length, 0)
  assert.equal(incompletas.length, 1)
})

test('liberadas: una lectura TRUNCADA tambien cuenta como fallo', async () => {
  const { deps, estados, truncan } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  truncan.add('cal-cos')
  const { liberadas, incompletas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(liberadas.length, 0)
  assert.equal(incompletas.length, 1)
})

test('liberadas: con todo legible sigue avisando (el arreglo no apaga el aviso)', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  const { liberadas, incompletas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(liberadas.length, 1)
  assert.equal(incompletas.length, 0)
})

test('mapa: con una agenda sin leer NO se muestra "lista" (un ✅ podria esconder un paso pendiente)', async () => {
  const { deps, estados, fallan, aEvento } = escenario()
  estados['cierre|2026-10-02'] = { estado: 'NO_APLICA' }
  fallan.add('cal-cos') // el CMV no se puede leer
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  const reporte = mapa.get('reporte|2026-10-03')
  assert.equal(reporte?.listas, undefined)
  assert.equal(reporte?.espera, undefined)
})

test('mapa: lo que si se pudo leer sigue mostrandose aunque otra agenda falle', async () => {
  const { deps, fallan, aEvento } = escenario()
  fallan.add('cal-cos')
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  // El cierre (Tesoreria) se leyo bien y esta pendiente: eso se sigue diciendo.
  assert.deepEqual(mapa.get('reporte|2026-10-03').espera.map((p) => p.nombre_tarea), ['Cierre de caja'])
})

// ── El aviso de Chat con la base y Calendar falsos ──────────────────────────

test('aviso: sin Space se cuenta como sin_space (antes se perdia sin rastro)', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'reporte@dcsmart.app' })
  assert.deepEqual([r.liberadas, r.sin_space, r.spaces, r.fallidos], [1, 1, 0, 0])
})

test('aviso: en simulacion NO cuenta como enviado (antes inflaba "spaces")', async () => {
  const { deps, estados, porId } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  porId.reporte.tarea.departamento.chat_space_name = 'spaces/AUD'
  process.env.AVISO_DRY_RUN = '1'
  try {
    const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'reporte@dcsmart.app' })
    assert.deepEqual([r.simulados, r.spaces, r.sin_space], [1, 0, 0])
  } finally {
    delete process.env.AVISO_DRY_RUN
  }
})

test('aviso: si no se pudo confirmar por un fallo de lectura, lo dice (sin_confirmar) y no avisa', async () => {
  const { deps, fallan, porId } = escenario()
  fallan.add('cal-cos')
  porId.reporte.tarea.departamento.chat_space_name = 'spaces/AUD'
  process.env.AVISO_DRY_RUN = '1'
  try {
    const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'lruiz@dcsmart.app' })
    assert.deepEqual([r.sin_confirmar, r.liberadas, r.simulados, r.spaces], [1, 0, 0, 0])
  } finally {
    delete process.env.AVISO_DRY_RUN
  }
})

// ── Mas fallar cerrado ───────────────────────────────────────────────────────

test('mapa: si la agenda de la PROPIA tarea no se pudo leer, sus prerrequisitos no se muestran "listos" contra un tramo equivocado', async () => {
  const { deps, estados, fallan, aEvento } = escenario()
  estados['cierre|2026-10-02'] = { estado: 'NO_APLICA' }
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  fallan.add('cal-aud') // la agenda del reporte: fija el tramo en el que se busca cada prerrequisito
  const mapa = await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  assert.equal(mapa.get('reporte|2026-10-03')?.listas, undefined)
})

test('mapa: con la agenda de la tarea sin leer NO se dice a quien frena (antes salia una etiqueta "frena a..." falsa)', async () => {
  const { deps, eventos, fallan, aEvento } = escenario()
  eventos.cierre = ['2026-10-01', '2026-10-02']
  const instancias = [aEvento('cierre', '2026-10-01'), aEvento('cierre', '2026-10-02')]
  const sano = await mapaDependencias(deps, { instancias })
  assert.equal(sano.get('cierre|2026-10-01')?.la_espera, undefined) // el del 2 es el que de verdad frena al reporte
  assert.ok(sano.get('cierre|2026-10-02').la_espera)

  fallan.add('cal-tes')
  const roto = await mapaDependencias(deps, { instancias })
  assert.equal(roto.get('cierre|2026-10-01')?.la_espera, undefined)
  assert.equal(roto.get('cierre|2026-10-02')?.la_espera, undefined)
})

test('un error transitorio de Calendar se reintenta UNA vez (antes se perdia el aviso para siempre)', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  const original = deps.gcal.listarInstancias
  let intentos = 0
  deps.gcal.listarInstancias = async (a) => {
    if (a.calendarId === 'cal-cos' && intentos++ === 0) throw Object.assign(new Error('503 un momento'), { code: 503 })
    return original(a)
  }
  deps.esperaReintentoMs = 0
  const { liberadas, incompletas } = await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(liberadas.length, 1)
  assert.equal(incompletas.length, 0)
  assert.equal(intentos, 2) // fallo una vez y la segunda anduvo
})

test('una lectura TRUNCADA no se reintenta (daria lo mismo)', async () => {
  const { deps, truncan } = escenario()
  truncan.add('cal-cos')
  deps.esperaReintentoMs = 0
  let lecturasCos = 0
  const original = deps.gcal.listarInstancias
  deps.gcal.listarInstancias = async (a) => { if (a.calendarId === 'cal-cos') lecturasCos++; return original(a) }
  await liberadasPor(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02' })
  assert.equal(lecturasCos, 1)
})

test('la lectura de dependencias pide hasta 40 paginas (una truncada apaga las dependencias del departamento)', async () => {
  const { deps, aEvento } = escenario()
  const pedidos = []
  const original = deps.gcal.listarInstancias
  deps.gcal.listarInstancias = async (a) => { pedidos.push(a.maxPaginas); return original(a) }
  await mapaDependencias(deps, { instancias: [aEvento('reporte', '2026-10-03')] })
  assert.ok(pedidos.length > 0)
  assert.deepEqual([...new Set(pedidos)], [40])
})

test('cadena: con una agenda sin leer se marca incompleta (antes salia vacia, como si no hubiera dependencias)', async () => {
  const { deps, fallan } = escenario()
  const sana = await cadenaDeInstancia(deps, { idAsignacion: 'reporte', fechaISO: '2026-10-03' })
  assert.equal(sana.incompleta, undefined)
  fallan.add('cal-cos')
  const rota = await cadenaDeInstancia(deps, { idAsignacion: 'reporte', fechaISO: '2026-10-03' })
  assert.equal(rota.incompleta, true)
})

// ── El aviso de Chat con un Space que rechaza ────────────────────────────────

test('aviso: un 403 al postear NO desvincula el Space (queda como fallido y se informa)', async () => {
  const { deps, estados, porId } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  porId.reporte.tarea.departamento.chat_space_name = 'spaces/AUD'
  const llamadasADesvincular = []
  deps.db.departamento = { updateMany: async (a) => { llamadasADesvincular.push(a); return { count: 1 } } }
  deps.chat = {
    SpaceInaccesible,
    postearEnSpace: async () => { throw new SpaceInaccesible('Requested entity was not found.', 404) },
    idDeChatPorEmail: async () => null,
    buscarMensajeDirecto: async () => null
  }
  delete process.env.AVISO_DRY_RUN
  const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'reporte@dcsmart.app' })
  assert.deepEqual([r.liberadas, r.spaces, r.fallidos], [1, 0, 1])
  assert.equal(llamadasADesvincular.length, 0, 'no se toco chat_space_name')
})

test('aviso: sale en el Space propio y en cada otro Space donde el departamento esta vinculado', async () => {
  const { deps, estados, porId } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  porId.reporte.tarea.departamento.chat_space_name = 'spaces/AUD'
  deps.db.departamentoCompartidoEnSpace = { findMany: async () => [{ chat_space_name: 'spaces/MIX' }, { chat_space_name: 'spaces/AUD' }] }
  const posteos = []
  deps.chat = { postearEnSpace: async (space) => { posteos.push(space) }, idDeChatPorEmail: async () => null, buscarMensajeDirecto: async () => null }
  delete process.env.AVISO_DRY_RUN
  const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'reporte@dcsmart.app' })
  assert.deepEqual(posteos.sort(), ['spaces/AUD', 'spaces/MIX'])
  assert.deepEqual([r.spaces, r.sin_space, r.fallidos], [2, 0, 0])
})

test('aviso: un departamento sin Space propio pero vinculado a uno compartido igual recibe el aviso', async () => {
  const { deps, estados } = escenario()
  estados['cmv|2026-10-01'] = { estado: 'REALIZADA' }
  deps.db.departamentoCompartidoEnSpace = { findMany: async () => [{ chat_space_name: 'spaces/MIX' }] }
  const posteos = []
  deps.chat = { postearEnSpace: async (space) => { posteos.push(space) }, idDeChatPorEmail: async () => null, buscarMensajeDirecto: async () => null }
  delete process.env.AVISO_DRY_RUN
  const r = await avisarLiberadas(deps, { idAsignacion: 'cierre', fechaISO: '2026-10-02', emailUsuario: 'reporte@dcsmart.app' })
  assert.deepEqual(posteos, ['spaces/MIX'])
  assert.deepEqual([r.spaces, r.sin_space], [1, 0])
})
