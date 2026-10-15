import { test } from 'node:test'
import assert from 'node:assert/strict'
import { departamentosDelSpace, vincularDepartamentos, departamentosParaVincular, ejecutarComando, puedeAgregarDepartamento, puedeQuitarDepartamento, TEXTO_SIN_DEPARTAMENTOS_PARA_VINCULAR } from './chat-comandos.js'

// Base falsa con lo justo que usan /vincular y departamentosDelSpace.
function baseFalsa(departamentos, compartidos = []) {
  const deptos = departamentos.map((d) => ({ activo: true, chat_space_name: null, ...d }))
  let filas = [...compartidos]
  const porId = (id) => deptos.find((d) => d.id === id)
  return {
    deptos,
    filas: () => filas,
    departamento: {
      findUnique: async ({ where }) => deptos.find((d) => d.chat_space_name === where.chat_space_name) || null,
      findMany: async ({ where }) => deptos.filter((d) => (!where.id?.in || where.id.in.includes(d.id)) && d.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      update: async ({ where, data }) => Object.assign(porId(where.id), data)
    },
    departamentoCompartidoEnSpace: {
      findMany: async ({ where }) => filas
        .filter((f) => f.chat_space_name === where.chat_space_name && porId(f.id_departamento)?.activo)
        .map((f) => ({ ...f, departamento: porId(f.id_departamento) }))
        .sort((a, b) => a.departamento.nombre.localeCompare(b.departamento.nombre)),
      findFirst: async ({ where }) => filas.find((f) => f.chat_space_name === where.chat_space_name && f.id_departamento === where.id_departamento) || null,
      create: async ({ data }) => { filas.push(data); return data },
      deleteMany: async ({ where }) => {
        const antes = filas.length
        const fuera = where.id_departamento?.notIn
        const sacar = where.id_departamento?.in
        filas = filas.filter((f) => f.chat_space_name !== where.chat_space_name || (fuera && fuera.includes(f.id_departamento)) || (sacar && !sacar.includes(f.id_departamento)))
        return { count: antes - filas.length }
      }
    }
  }
}
const admin = { es_admin_global: true }
const deps = (db) => ({ db, log: { info() {} } })

test('/vincular: departamentos que ya tienen su Space quedan como compartidos y el Space queda sin dueño', async () => {
  const db = baseFalsa([
    { id: 'aud', nombre: 'Auditoría', chat_space_name: 'spaces/AUD' },
    { id: 'rep', nombre: 'Reportes', chat_space_name: 'spaces/INF' }
  ])
  const respuesta = await vincularDepartamentos(deps(db), { space: 'spaces/MIX', extUser: admin, idsDepartamentos: ['aud', 'rep'] })
  assert.match(respuesta, /^✅ Listo\. Este Space queda vinculado a \*Auditoría\*, \*Reportes\*\./)
  assert.match(respuesta, /Es un Space combinado/)
  assert.match(respuesta, /Cada uno sigue recibiendo lo suyo también en su propio Space/)
  // Nadie perdio su Space propio.
  assert.equal(db.deptos.find((d) => d.id === 'aud').chat_space_name, 'spaces/AUD')
  assert.equal(db.deptos.find((d) => d.id === 'rep').chat_space_name, 'spaces/INF')
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/MIX')).map((d) => d.id), ['aud', 'rep'])
})

test('/vincular: si uno de los tildados no tiene Space, ese pasa a ser el dueño', async () => {
  const db = baseFalsa([
    { id: 'aud', nombre: 'Auditoría', chat_space_name: 'spaces/AUD' },
    { id: 'cos', nombre: 'Costos' }
  ])
  const respuesta = await vincularDepartamentos(deps(db), { space: 'spaces/MIX', extUser: admin, idsDepartamentos: ['aud', 'cos'] })
  assert.match(respuesta, /El recordatorio diario y el resumen de los lunes de \*Costos\* llegan acá/)
  assert.match(respuesta, /También llegan acá los avisos de \*Auditoría\*/)
  assert.equal(db.deptos.find((d) => d.id === 'cos').chat_space_name, 'spaces/MIX')
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/MIX')).map((d) => d.id), ['cos', 'aud'])
})

test('/vincular: sin tildes, un Space combinado sin dueño queda sin nada', async () => {
  const db = baseFalsa([{ id: 'aud', nombre: 'Auditoría', chat_space_name: 'spaces/AUD' }], [{ chat_space_name: 'spaces/MIX', id_departamento: 'aud' }])
  const respuesta = await vincularDepartamentos(deps(db), { space: 'spaces/MIX', extUser: admin, idsDepartamentos: [] })
  assert.match(respuesta, /ya no cubre ningún departamento/)
  assert.deepEqual(await departamentosDelSpace(db, 'spaces/MIX'), [])
  assert.equal(db.deptos[0].chat_space_name, 'spaces/AUD')
})

// ── Vincular sin bloquear a nadie (2026-10-08) ────────────────────────────────
// AGREGAR un departamento a un Space: cualquier persona activa, salvo Dirección.
// SACARLO: administrador o Manager/Owner de ese departamento.

const persona = (rol, ...ids) => ({ email: 'g@x', departamentos: ids, roles: Object.fromEntries(ids.map((id) => [id, rol])), esDireccion: false })
const miembro = persona('MEMBER', 'cos')
const baseDeptos = () => baseFalsa([
  { id: 'cos', nombre: 'Costos', slug: 'costos' },
  { id: 'aud', nombre: 'Auditoría', slug: 'auditoria' },
  { id: 'dir', nombre: 'Dirección', slug: 'direccion' }
])

test('puedeAgregar / puedeQuitar: cualquiera agrega y saca cualquier departamento, menos Dirección (solo administradores)', () => {
  const cos = { id: 'cos', slug: 'costos' }
  const aud = { id: 'aud', slug: 'auditoria' }
  const dir = { id: 'dir', slug: 'direccion' }
  assert.ok(puedeAgregarDepartamento(admin, dir) && puedeQuitarDepartamento(admin, dir))
  for (const u of [miembro, persona('MANAGER', 'cos'), persona('OWNER', 'aud'), persona('MEMBER')]) {
    assert.ok(puedeAgregarDepartamento(u, cos) && puedeAgregarDepartamento(u, aud))
    assert.ok(puedeQuitarDepartamento(u, cos) && puedeQuitarDepartamento(u, aud))
    assert.ok(!puedeAgregarDepartamento(u, dir) && !puedeQuitarDepartamento(u, dir))
  }
  assert.ok(!puedeAgregarDepartamento(persona('OWNER', 'dir'), dir))
})

test('/vincular (formulario): cualquier persona ve todos los departamentos menos Dirección; el administrador, todos', async () => {
  const db = baseDeptos()
  const m = await departamentosParaVincular(deps(db), { space: 'spaces/X', extUser: miembro })
  assert.deepEqual(m.departamentos.map((d) => d.id), ['aud', 'cos'])
  assert.equal(m.error, undefined)
  const a = await departamentosParaVincular(deps(db), { space: 'spaces/X', extUser: admin })
  assert.equal(a.departamentos.length, 3)
  const vacio = await departamentosParaVincular(deps(baseFalsa([])), { space: 'spaces/X', extUser: miembro })
  assert.equal(vacio.error, TEXTO_SIN_DEPARTAMENTOS_PARA_VINCULAR)
})

test('/vincular: un Miembro vincula cualquier departamento a un Space', async () => {
  const db = baseDeptos()
  const r = await vincularDepartamentos(deps(db), { space: 'spaces/INFORMES', extUser: miembro, idsDepartamentos: ['aud', 'cos'] })
  assert.match(r, /queda vinculado a \*Auditoría\*, \*Costos\*/)
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/INFORMES')).map((d) => d.id), ['aud', 'cos'])
})

test('/vincular: Dirección no se vincula sin ser administrador, aunque el formulario la mande', async () => {
  const db = baseDeptos()
  const r = await vincularDepartamentos(deps(db), { space: 'spaces/COSTOS', extUser: persona('OWNER', 'cos'), idsDepartamentos: ['cos', 'dir'] })
  assert.match(r, /\*Costos\*/)
  assert.doesNotMatch(r, /Dirección/)
  assert.equal(db.deptos.find((d) => d.id === 'dir').chat_space_name, null)
  // El administrador si puede.
  await vincularDepartamentos(deps(db), { space: 'spaces/DIR', extUser: admin, idsDepartamentos: ['dir'] })
  assert.equal(db.deptos.find((d) => d.id === 'dir').chat_space_name, 'spaces/DIR')
})

test('/vincular: cualquiera destilda y saca un departamento; Dirección se conserva (solo la saca un administrador)', async () => {
  const db = baseFalsa([
    { id: 'cos', nombre: 'Costos', slug: 'costos' },
    { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', chat_space_name: 'spaces/AUD' },
    { id: 'dir', nombre: 'Dirección', slug: 'direccion' }
  ], [{ chat_space_name: 'spaces/AUD', id_departamento: 'cos' }, { chat_space_name: 'spaces/AUD', id_departamento: 'dir' }])
  // Un Miembro destilda todo: salen Costos y Auditoría; Dirección se conserva.
  await vincularDepartamentos(deps(db), { space: 'spaces/AUD', extUser: miembro, idsDepartamentos: [] })
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), ['dir'])
  const form = await departamentosParaVincular(deps(db), { space: 'spaces/AUD', extUser: miembro })
  assert.deepEqual(form.ajenos, ['Dirección'])
  // El administrador si la saca.
  await vincularDepartamentos(deps(db), { space: 'spaces/AUD', extUser: admin, idsDepartamentos: [] })
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), [])
})

test('/desvincular: cualquiera saca los departamentos del Space salvo Dirección, que solo saca un administrador', async () => {
  const hacer = (db, extUser) => ejecutarComando({ db, log: { info() {}, warn() {}, error() {} } }, { comandoId: 6, texto: '/desvincular', space: 'spaces/AUD', extUser, email: 'x@x' })
  let db = baseFalsa([{ id: 'cos', nombre: 'Costos', slug: 'costos' }, { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', chat_space_name: 'spaces/AUD' }, { id: 'dir', nombre: 'Dirección', slug: 'direccion' }],
    [{ chat_space_name: 'spaces/AUD', id_departamento: 'cos' }, { chat_space_name: 'spaces/AUD', id_departamento: 'dir' }])
  const r = await hacer(db, miembro)
  assert.match(r, /ya no cubre \*Auditoría\*, \*Costos\*/)
  assert.match(r, /Sigue cubriendo \*Dirección\*, que solo un administrador puede sacar/)
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), ['dir'])
  assert.match(await hacer(db, miembro), /ningún departamento que puedas sacar/)
  await hacer(db, admin)
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), [])
})
