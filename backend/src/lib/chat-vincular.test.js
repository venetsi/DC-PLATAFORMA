import { test } from 'node:test'
import assert from 'node:assert/strict'
import { departamentosDelSpace, vincularDepartamentos } from './chat-comandos.js'

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
      findMany: async ({ where }) => deptos.filter((d) => where.id.in.includes(d.id) && d.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
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
        filas = filas.filter((f) => f.chat_space_name !== where.chat_space_name || (fuera && fuera.includes(f.id_departamento)))
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
