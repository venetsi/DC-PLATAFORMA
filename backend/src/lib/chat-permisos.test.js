// Quien VE y quien MODIFICA en Chat (2026-10-08):
//   - VER: cualquier persona activa ve las tareas de los departamentos del Space.
//   - MODIFICAR (marcar, tomar, pasar, anotar): solo quien es del departamento de
//     la tarea. Excepcion: un Space que cubre Dirección (ahi cualquiera opera todo).
import test from 'node:test'
import assert from 'node:assert/strict'
import { puede, departamentosCon } from './permisos.js'
import {
  ejecutarComando, puedeModificarTarea, avisoSoloDelDepartamento, tomarPorInstanceId, notaPorInstanceId,
  pasarPorInstanceId, marcarVarias, pendientesParaAsignar, pendientesParaTildar
} from './chat-comandos.js'

process.env.MEMBRESIA_FUENTE = 'groups'

const persona = (nombre, rol, ...ids) => ({ email: `${nombre}@x.com`, nombre, activo: true, departamentos: ids, roles: Object.fromEntries(ids.map((id) => [id, rol])), esDireccion: false })
const ana = persona('ana', 'MEMBER', 'cos') // Miembro de Costos
const beto = persona('beto', 'MEMBER', 'aud') // Miembro de Auditoría
const cris = persona('cris', 'MEMBER') // activa, sin departamento
const admin = { email: 'adm@x.com', activo: true, es_admin_global: true }

const COS = { id: 'cos', nombre: 'Costos', slug: 'costos', activo: true, id_calendar_google: 'cal-cos', chat_space_name: null }
const AUD = { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', activo: true, id_calendar_google: 'cal-aud', chat_space_name: null }
const DIR = { id: 'dir', nombre: 'Dirección', slug: 'direccion', activo: true, id_calendar_google: 'cal-dir', chat_space_name: null }

const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const evento = (id, nombre) => ({
  id,
  summary: nombre,
  start: { date: manana },
  end: { date: manana },
  extendedProperties: { private: { nombre_tarea: nombre, estado: 'PENDIENTE' } }
})

// Un Space que cubre Auditoría (dueño) + Costos (compartido); o solo Dirección.
function armar({ departamentos = [AUD, COS], space = 'spaces/MIX', dueño = AUD } = {}) {
  const ds = departamentos.map((d) => ({ ...d, chat_space_name: d === dueño ? space : null }))
  const compartidos = ds.filter((d) => d !== ds.find((x) => x.id === dueño.id)).map((d) => ({ chat_space_name: space, id_departamento: d.id }))
  const escrituras = []
  const gcal = {
    listarInstancias: async ({ calendarId }) => (calendarId === 'cal-cos' ? [evento('ev-cos', 'Cierre de costos')] : calendarId === 'cal-aud' ? [evento('ev-aud', 'Arqueo')] : [evento('ev-dir', 'Revisión')]),
    leerInstancia: async ({ calendarId, instanceId }) => (calendarId === 'cal-cos' ? evento(instanceId, 'Cierre de costos') : evento(instanceId, 'Arqueo')),
    marcarInstancia: async (a) => { escrituras.push(a); return {} },
    buscarInstanciaPorFecha: async () => null
  }
  const db = {
    departamento: {
      findUnique: async ({ where }) => (where.chat_space_name ? ds.find((d) => d.chat_space_name === where.chat_space_name) || null : ds.find((d) => d.id === where.id) || null),
      findMany: async ({ where }) => ds.filter((d) => d.activo && (!where?.id?.in || where.id.in.includes(d.id)))
    },
    departamentoCompartidoEnSpace: {
      findMany: async ({ where }) => compartidos.filter((f) => f.chat_space_name === where.chat_space_name).map((f) => ({ ...f, departamento: ds.find((d) => d.id === f.id_departamento) }))
    },
    extLocal: { findMany: async () => [] },
    extUser: { findUnique: async ({ where }) => ({ email: where.email, nombre: 'Persona', activo: true }) },
    membresiaDepartamento: { findMany: async () => [] },
    tareaAsignacionDependencia: { findMany: async () => [] }
  }
  return { db, gcal, escrituras, space }
}
const correr = (ctx, texto, extUser) => ejecutarComando({ db: ctx.db, gcal: ctx.gcal, log: { info() {}, warn() {}, error() {} } }, { comandoId: 0, texto, space: ctx.space, extUser, email: extUser.email })

// ── Las reglas, a nivel de funcion ───────────────────────────────────────────

test('VER es de toda la organizacion: cualquier persona activa ve cualquier departamento', () => {
  for (const u of [ana, beto, cris, admin]) {
    assert.ok(puede(u, 'ver', 'cos') && puede(u, 'ver', 'aud') && puede(u, 'ver', 'dir'), u.email)
  }
  assert.equal(puede(null, 'ver', 'cos'), false)
  assert.equal(departamentosCon(ana, 'ver'), null, 'null = todos los departamentos')
})

test('MODIFICAR (marcar y editar) es solo de quien es del departamento: cualquier rol del departamento, nadie de afuera', () => {
  for (const accion of ['marcar', 'editar']) {
    assert.ok(puede(ana, accion, 'cos'), `${accion}: un Miembro del departamento`)
    assert.ok(puede(persona('m', 'MANAGER', 'cos'), accion, 'cos'))
    assert.ok(!puede(beto, accion, 'cos'), `${accion}: alguien de otro departamento`)
    assert.ok(!puede(cris, accion, 'cos'), `${accion}: alguien sin departamento`)
    assert.ok(puede(admin, accion, 'cos'))
  }
})

test('lo irreversible sigue siendo del Owner y los reportes del Manager', () => {
  assert.ok(!puede(ana, 'administrar', 'cos') && puede(persona('o', 'OWNER', 'cos'), 'administrar', 'cos'))
  assert.ok(!puede(ana, 'reportes', 'cos') && puede(persona('m', 'MANAGER', 'cos'), 'reportes', 'cos'))
})

test('puedeModificarTarea: del departamento si; de otro no; el Space de Dirección es la excepcion', () => {
  assert.ok(puedeModificarTarea(ana, COS, [AUD, COS]))
  assert.ok(!puedeModificarTarea(beto, COS, [AUD, COS]))
  assert.ok(!puedeModificarTarea(cris, COS, [AUD, COS]))
  // Excepcion: un Space que cubre Dirección -- cualquier persona activa opera todo.
  assert.ok(puedeModificarTarea(cris, COS, [DIR, COS]))
  assert.ok(puedeModificarTarea(beto, DIR, [DIR]))
  assert.ok(!puedeModificarTarea(null, COS, []))
})

// ── Comandos de texto, de punta a punta ──────────────────────────────────────

test('/tomar: Ana (de Costos) toma la tarea de Costos; Beto (de Auditoría) solo la ve', async () => {
  const ctx = armar()
  const ok = await correr(ctx, '/tomar cierre de costos', ana)
  assert.match(ok, /queda a tu nombre/)
  assert.equal(ctx.escrituras.length, 1)
  assert.equal(ctx.escrituras[0].calendarId, 'cal-cos')

  const ctx2 = armar()
  const no = await correr(ctx2, '/tomar cierre de costos', beto)
  assert.equal(no, avisoSoloDelDepartamento(COS))
  assert.equal(ctx2.escrituras.length, 0, 'no se escribio nada en Calendar')
})

test('/nota y /pasar: tampoco las puede hacer alguien de otro departamento', async () => {
  const ctx = armar()
  assert.equal(await correr(ctx, '/nota cierre de costos: hola', beto), avisoSoloDelDepartamento(COS))
  assert.equal(await correr(ctx, '/pasar cierre de costos: ana@x.com', beto), avisoSoloDelDepartamento(COS))
  assert.equal(ctx.escrituras.length, 0)
  assert.match(await correr(ctx, '/nota cierre de costos: hola', ana), /Anotado/)
  assert.equal(ctx.escrituras.length, 1)
})

test('/marcar: alguien de otro departamento no la marca', async () => {
  const ctx = armar()
  assert.equal(await correr(ctx, '/marcar cierre de costos', beto), avisoSoloDelDepartamento(COS))
  assert.equal(ctx.escrituras.length, 0)
})

test('VER: Beto y Cris (de otro departamento / sin departamento) ven las tareas del Space con /hoy y /atrasadas', async () => {
  for (const u of [beto, cris]) {
    const r = await correr(armar(), '/hoy', u)
    assert.doesNotMatch(r, /no tiene departamento asignado/)
    assert.match(r, /Cierre de costos|Arqueo|no hay|Nada|🎉|pendiente/i, `/hoy de ${u.email}: ${r.slice(0, 80)}`)
  }
  const detalle = await correr(armar(), '/tarea cierre de costos', cris)
  assert.match(detalle, /Cierre de costos/)
})

test('el Space de Dirección es la excepcion: cualquier persona activa opera todo desde ahí', async () => {
  const ctx = armar({ departamentos: [DIR, COS], space: 'spaces/DIR', dueño: DIR })
  const r = await correr(ctx, '/tomar cierre de costos', cris)
  assert.match(r, /queda a tu nombre/)
  assert.equal(ctx.escrituras.length, 1)
})

// ── Dialogos y tarjetas ──────────────────────────────────────────────────────

const codificar = (idDepto, idEvento) => `${idDepto}::${idEvento}`

test('dialogos (por id): tomar, pasar y anotar respetan el departamento de la tarea', async () => {
  const ctx = armar()
  const deps = { db: ctx.db, gcal: ctx.gcal, log: { info() {}, warn() {}, error() {} } }
  const valor = codificar('cos', 'ev-cos')
  assert.equal(await tomarPorInstanceId(deps, { space: ctx.space, extUser: beto, email: beto.email, instanceId: valor }), avisoSoloDelDepartamento(COS))
  assert.equal(await notaPorInstanceId(deps, { space: ctx.space, extUser: beto, email: beto.email, instanceId: valor, nota: 'x' }), avisoSoloDelDepartamento(COS))
  assert.equal(await pasarPorInstanceId(deps, { space: ctx.space, extUser: beto, email: beto.email, instanceId: valor, emailDestino: ana.email }), avisoSoloDelDepartamento(COS))
  assert.equal(ctx.escrituras.length, 0)
  assert.match(await tomarPorInstanceId(deps, { space: ctx.space, extUser: ana, email: ana.email, instanceId: valor }), /queda a tu nombre/)
  assert.equal(ctx.escrituras.length, 1)
})

test('/tildar (marcarVarias): solo marca las de su departamento y dice cuales no pudo', async () => {
  const ctx = armar()
  const deps = { db: ctx.db, gcal: ctx.gcal, log: { info() {}, warn() {}, error() {} } }
  const r = await marcarVarias(deps, { space: ctx.space, extUser: beto, email: beto.email, instanceIds: [codificar('cos', 'ev-cos')] })
  assert.match(r, /No se pudieron marcar/)
  assert.match(r, /solo las personas de ese departamento/)
  assert.equal(ctx.escrituras.length, 0)
})

test('los dialogos solo listan lo que la persona puede modificar', async () => {
  const ctx = armar()
  const deps = { db: ctx.db, gcal: ctx.gcal }
  const deAna = await pendientesParaAsignar(deps, { space: ctx.space, extUser: ana })
  assert.deepEqual(deAna.pendientes.map((p) => p.instanceId), [codificar('cos', 'ev-cos')])
  const deBeto = await pendientesParaAsignar(deps, { space: ctx.space, extUser: beto })
  assert.deepEqual(deBeto.pendientes.map((p) => p.instanceId), [codificar('aud', 'ev-aud')])
  const deCris = await pendientesParaAsignar(deps, { space: ctx.space, extUser: cris })
  assert.deepEqual(deCris.pendientes, [])
  const admin2 = await pendientesParaAsignar(deps, { space: ctx.space, extUser: admin })
  assert.equal(admin2.pendientes.length, 2)
  const t = await pendientesParaTildar(deps, { space: ctx.space, extUser: ana })
  assert.ok(t.pendientes.every((p) => p.instanceId.startsWith('cos::')))
})
