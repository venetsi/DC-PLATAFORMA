import { test } from 'node:test'
import assert from 'node:assert/strict'
import agendasRoutes from './agendas.js'

// Alta de tareas (POST /api/agendas/tareas y /tareas/:id/alcance) con una base
// en memoria y un Calendar falso que se puede hacer fallar.
function armar({ calendarFalla = () => false } = {}) {
  let n = 0
  const id = (p) => `${p}-${++n}`
  const departamentos = [
    { id: 'cos', nombre: 'Costos', activo: true, id_calendar_google: 'cal-cos' },
    { id: 'aud', nombre: 'Auditoría', activo: true, id_calendar_google: 'cal-aud' }
  ]
  const locales = [{ id: 'l1', nombre: 'ALDOS' }, { id: 'l2', nombre: 'Pipistrello' }]
  const tareas = []
  const asignaciones = []
  const deps = []
  const eventos = []
  const depto = (idD) => departamentos.find((d) => d.id === idD)
  const conIncludes = (a) => a && ({ ...a, tarea: { ...tareas.find((t) => t.id === a.id_tarea), departamento: depto(tareas.find((t) => t.id === a.id_tarea).id_departamento) }, local: locales.find((l) => l.id === a.id_local_ext) || null, compartidas: [] })
  const igualNombre = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

  const db = {
    extUser: { findUnique: async () => ({ id: 'u', email: 'x@dcsmart.app', departamentos: ['cos', 'aud'], roles: { cos: 'OWNER', aud: 'OWNER' } }) },
    extLocal: {
      findMany: async ({ where }) => locales.filter((l) => !where?.id || where.id.in.includes(l.id))
    },
    departamento: { findMany: async () => [] },
    tarea: {
      findFirst: async ({ where }) => {
        const t = tareas.find((x) => x.id_departamento === where.id_departamento && igualNombre(x.nombre, where.nombre.equals))
        return t ? { ...t, departamento: { nombre: depto(t.id_departamento).nombre } } : null
      },
      findUnique: async ({ where }) => tareas.find((t) => t.id === where.id) || null,
      create: async ({ data }) => {
        if (tareas.some((t) => t.id_departamento === data.id_departamento && t.nombre === data.nombre)) throw Object.assign(new Error('dup'), { code: 'P2002' })
        const t = { id: id('t'), activa: true, ...data }
        tareas.push(t)
        return t
      },
      delete: async ({ where }) => { tareas.splice(tareas.findIndex((t) => t.id === where.id), 1) }
    },
    tareaAsignacion: {
      findFirst: async ({ where }) => asignaciones.find((a) => a.id_tarea === where.id_tarea && a.id_local_ext === where.id_local_ext && (where.activa === undefined || a.activa === where.activa)) || null,
      findMany: async ({ where }) => asignaciones.filter((a) => a.id_tarea === where.id_tarea && (where.activa === undefined || a.activa === where.activa) && a.id !== where.NOT?.id),
      findUnique: async ({ where }) => conIncludes(asignaciones.find((a) => a.id === where.id)),
      create: async ({ data }) => { const a = { id: id('a'), activa: true, id_calendar_event: null, ...data }; asignaciones.push(a); return a },
      update: async ({ where, data }) => { const a = asignaciones.find((x) => x.id === where.id); Object.assign(a, data); return a },
      deleteMany: async ({ where }) => { for (let i = asignaciones.length - 1; i >= 0; i--) if (asignaciones[i].id_tarea === where.id_tarea) asignaciones.splice(i, 1) }
    },
    tareaAsignacionDepto: { createMany: async () => {}, deleteMany: async () => {}, updateMany: async () => {} },
    tareaAsignacionDependencia: {
      findMany: async () => [],
      deleteMany: async () => {},
      create: async ({ data }) => deps.push(data),
      updateMany: async () => ({ count: 0 })
    },
    $transaction: async (ops) => Promise.all(ops)
  }
  const gcal = {
    leerInstancia: async () => null,
    crearEventoRecurrente: async ({ extendedProperties }) => {
      if (calendarFalla(extendedProperties)) throw Object.assign(new Error('Backend Error'), { response: { status: 503 } })
      const ev = { id: id('ev'), extendedProperties }
      eventos.push(ev)
      return ev
    }
  }
  const rutas = {}
  const fastify = {
    db, gcal, authenticate: async () => {},
    log: { warn: () => {} },
    get: () => {}, put: () => {}, delete: () => {},
    post: (ruta, _o, handler) => { rutas[ruta] = handler }
  }
  async function llamar(ruta, body, params = {}) {
    let codigo = 200
    const reply = { code: (c) => { codigo = c; return reply }, send: (cuerpo) => cuerpo }
    const r = await rutas[ruta]({ body, params, user: { id: 'u' } }, reply)
    return { codigo, r }
  }
  return { fastify, llamar, tareas, asignaciones, eventos }
}

const AGENDA = { recurrencia_tipo: 'UNICA', recurrencia_config: { fecha: '2030-01-10' }, vigencia_desde: '2030-01-10' }
const alta = (extra) => ({ nombre: 'CMV', id_departamento: 'aud', alcance: { tipo: 'locales', ids_locales: ['l1', 'l2'] }, agenda: AGENDA, ...extra })

test('el mismo nombre en otro departamento se puede crear', async () => {
  const x = armar()
  await agendasRoutes(x.fastify)
  assert.equal((await x.llamar('/tareas', alta({ id_departamento: 'cos' }))).codigo, 201)
  const { codigo, r } = await x.llamar('/tareas', alta())
  assert.equal(codigo, 201)
  assert.equal(r.agendadas, 2)
  assert.equal(x.tareas.length, 2)
})

test('en el mismo departamento, "cmv " choca con "CMV" y ofrece sumarle locales', async () => {
  const x = armar()
  await agendasRoutes(x.fastify)
  await x.llamar('/tareas', alta())
  const { codigo, r } = await x.llamar('/tareas', alta({ nombre: 'cmv ' }))
  assert.equal(codigo, 409)
  assert.equal(r.existente.nombre, 'CMV')
  assert.equal(r.existente.id_departamento, 'aud')
})

test('si Calendar falla en todos los locales no queda nada guardado y el error se entiende', async () => {
  const x = armar({ calendarFalla: () => true })
  await agendasRoutes(x.fastify)
  const { codigo, r } = await x.llamar('/tareas', alta())
  assert.equal(codigo, 502)
  assert.match(r.error, /No se creó "CMV": ALDOS: Google Calendar no respondió/)
  assert.equal(x.tareas.length, 0)
  assert.equal(x.asignaciones.length, 0)
})

test('si falla un solo local, la tarea queda y "Sumar" completa el que faltó', async () => {
  let falla = true
  const x = armar({ calendarFalla: (p) => falla && p.id_local_ext === 'l2' })
  await agendasRoutes(x.fastify)

  const primera = await x.llamar('/tareas', alta())
  assert.equal(primera.codigo, 201)
  assert.equal(primera.r.agendadas, 1)
  assert.deepEqual(primera.r.errores, ['Pipistrello: Google Calendar no respondió'])

  falla = false
  const { r } = await x.llamar('/tareas/:id/alcance', { alcance: { tipo: 'locales', ids_locales: ['l1', 'l2'] }, agenda: AGENDA }, { id: x.tareas[0].id })
  assert.equal(r.ya_existian, 1)
  assert.equal(r.completadas, 1)
  assert.equal(r.agendadas, 1)
  assert.ok(x.asignaciones.every((a) => a.id_calendar_event))
})
