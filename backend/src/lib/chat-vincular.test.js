import { test } from 'node:test'
import assert from 'node:assert/strict'
import { departamentosDelSpace, vincularDepartamentos, departamentosParaVincular, ejecutarComando, esVinculable, TEXTO_SIN_PERMISO_VINCULAR } from './chat-comandos.js'

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
  assert.match(respuesta, /El recordatorio diario de cada uno sigue llegando a su propio Space/)
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
  assert.match(respuesta, /Con \*Auditoría\* se pueden usar los comandos y botones acá/)
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

// ── Manager / Owner de un departamento (2026-10-06) ──────────────────────────
// Vinculan y desvinculan SOLO lo suyo; Dirección y el resto son del administrador.

const gerente = (rol, ...ids) => ({ email: 'g@x', departamentos: ids, roles: Object.fromEntries(ids.map((id) => [id, rol])), esDireccion: false })
const miembro = gerente('MEMBER', 'cos')
const baseDeptos = () => baseFalsa([
  { id: 'cos', nombre: 'Costos', slug: 'costos' },
  { id: 'aud', nombre: 'Auditoría', slug: 'auditoria' },
  { id: 'dir', nombre: 'Dirección', slug: 'direccion' }
])

test('esVinculable: administrador todo; Manager/Owner lo suyo; Miembro nada; Dirección nunca para quien no es administrador', () => {
  const cos = { id: 'cos', slug: 'costos' }
  const dir = { id: 'dir', slug: 'direccion' }
  assert.ok(esVinculable(admin, cos) && esVinculable(admin, dir))
  assert.ok(esVinculable(gerente('MANAGER', 'cos'), cos))
  assert.ok(esVinculable(gerente('OWNER', 'cos'), cos))
  assert.ok(!esVinculable(gerente('OWNER', 'cos'), { id: 'aud', slug: 'auditoria' }))
  assert.ok(!esVinculable(miembro, cos))
  // aunque figure como Owner de un departamento llamado Dirección sin ser Direccion de verdad
  assert.ok(!esVinculable(gerente('OWNER', 'dir'), dir))
})

test('/vincular (formulario): un Owner ve SOLO sus departamentos; un Miembro recibe el aviso de permiso', async () => {
  const db = baseDeptos()
  const r = await departamentosParaVincular(deps(db), { space: 'spaces/X', extUser: gerente('OWNER', 'cos') })
  assert.deepEqual(r.departamentos.map((d) => d.id), ['cos'])
  const m = await departamentosParaVincular(deps(db), { space: 'spaces/X', extUser: miembro })
  assert.equal(m.error, TEXTO_SIN_PERMISO_VINCULAR)
  const a = await departamentosParaVincular(deps(db), { space: 'spaces/X', extUser: admin })
  assert.equal(a.departamentos.length, 3)
})

test('/vincular: un Manager vincula su departamento a un Space', async () => {
  const db = baseDeptos()
  const r = await vincularDepartamentos(deps(db), { space: 'spaces/COSTOS', extUser: gerente('MANAGER', 'cos'), idsDepartamentos: ['cos'] })
  assert.match(r, /queda vinculado a \*Costos\*/)
  assert.equal(db.deptos.find((d) => d.id === 'cos').chat_space_name, 'spaces/COSTOS')
})

test('/vincular: lo tildado que NO es suyo (formulario adulterado, o Dirección) se ignora', async () => {
  const db = baseDeptos()
  const r = await vincularDepartamentos(deps(db), { space: 'spaces/COSTOS', extUser: gerente('OWNER', 'cos'), idsDepartamentos: ['cos', 'aud', 'dir'] })
  assert.match(r, /\*Costos\*/)
  assert.doesNotMatch(r, /Auditoría|Dirección/)
  assert.equal(db.deptos.find((d) => d.id === 'aud').chat_space_name, null)
  assert.equal(db.deptos.find((d) => d.id === 'dir').chat_space_name, null)
})

test('/vincular: lo que el Space ya cubre y no es suyo se conserva; el solo puede agregar o sacar lo suyo', async () => {
  const db = baseFalsa([
    { id: 'cos', nombre: 'Costos', slug: 'costos' },
    { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', chat_space_name: 'spaces/AUD' }
  ])
  const owner = gerente('OWNER', 'cos')
  // Agrega Costos al Space de Auditoría: Auditoría sigue de dueño.
  await vincularDepartamentos(deps(db), { space: 'spaces/AUD', extUser: owner, idsDepartamentos: ['cos'] })
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), ['aud', 'cos'])
  assert.equal(db.deptos.find((d) => d.id === 'aud').chat_space_name, 'spaces/AUD')
  // Destilda Costos: se saca solo Costos, Auditoría sigue.
  await vincularDepartamentos(deps(db), { space: 'spaces/AUD', extUser: owner, idsDepartamentos: [] })
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), ['aud'])
  // El formulario le muestra lo que no puede cambiar.
  const form = await departamentosParaVincular(deps(db), { space: 'spaces/AUD', extUser: owner })
  assert.deepEqual(form.ajenos, ['Auditoría'])
})

test('/vincular: un Miembro no vincula nada aunque mande el formulario', async () => {
  const db = baseDeptos()
  const r = await vincularDepartamentos(deps(db), { space: 'spaces/X', extUser: miembro, idsDepartamentos: ['cos'] })
  assert.equal(r, TEXTO_SIN_PERMISO_VINCULAR)
  assert.equal(db.deptos.find((d) => d.id === 'cos').chat_space_name, null)
})

test('/desvincular: un Manager saca solo SU departamento; el administrador saca todo; un Miembro no puede', async () => {
  const hacer = (db, extUser) => ejecutarComando({ db, log: { info() {}, warn() {}, error() {} } }, { comandoId: 6, texto: '/desvincular', space: 'spaces/AUD', extUser, email: 'x@x' })
  // Manager de Costos en un Space compartido Auditoría (dueño) + Costos
  let db = baseFalsa([{ id: 'cos', nombre: 'Costos', slug: 'costos' }, { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', chat_space_name: 'spaces/AUD' }], [{ chat_space_name: 'spaces/AUD', id_departamento: 'cos' }])
  const r = await hacer(db, gerente('MANAGER', 'cos'))
  assert.match(r, /ya no cubre \*Costos\*/)
  assert.match(r, /Sigue cubriendo \*Auditoría\*/)
  assert.deepEqual((await departamentosDelSpace(db, 'spaces/AUD')).map((d) => d.id), ['aud'])
  // Un Manager de Costos NO puede desvincular un Space que solo cubre Auditoría
  const r2 = await hacer(db, gerente('MANAGER', 'cos'))
  assert.match(r2, /no cubre ninguno de tus departamentos/)
  assert.equal(db.deptos.find((d) => d.id === 'aud').chat_space_name, 'spaces/AUD')
  // El dueño propio: se le saca el vinculo
  db = baseFalsa([{ id: 'cos', nombre: 'Costos', slug: 'costos', chat_space_name: 'spaces/AUD' }])
  await hacer(db, gerente('OWNER', 'cos'))
  assert.equal(db.deptos[0].chat_space_name, null)
  // Miembro
  db = baseFalsa([{ id: 'cos', nombre: 'Costos', slug: 'costos', chat_space_name: 'spaces/AUD' }])
  assert.match(await hacer(db, miembro), /tenés que ser administrador/)
  assert.equal(db.deptos[0].chat_space_name, 'spaces/AUD')
})
