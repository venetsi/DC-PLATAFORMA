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

  let lecturas = 0
  const gcal = {
    async listarInstancias({ propiedades }) {
      lecturas++
      const id = propiedades.id_asignacion
      return (eventos[id] || []).map((fecha) => aEvento(id, fecha))
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
  return { deps: { db, gcal, log }, estados, eventos, aEvento, filas, lecturas: () => lecturas }
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
