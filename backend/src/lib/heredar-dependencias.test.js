import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heredarDependencias } from './heredar-dependencias.js'

// Base falsa con el circuito real: VTA/OP -> CMV -> Informe, en dos locales.
function baseConCircuito() {
  const asignaciones = []
  const asignar = (id, idTarea, idLocal) => asignaciones.push({ id, id_tarea: idTarea, id_local_ext: idLocal, activa: true })
  for (const l of ['l1', 'l2']) {
    asignar(`vta-${l}`, 'vta', l)
    asignar(`cmv-${l}`, 'cmv', l)
    asignar(`inf-${l}`, 'inf', l)
  }
  const filas = [
    { id_asignacion: 'cmv-l1', id_asignacion_prerequisito: 'vta-l1', activa: true },
    { id_asignacion: 'cmv-l2', id_asignacion_prerequisito: 'vta-l2', activa: true },
    { id_asignacion: 'inf-l1', id_asignacion_prerequisito: 'cmv-l1', activa: true },
    { id_asignacion: 'inf-l2', id_asignacion_prerequisito: 'cmv-l2', activa: true }
  ]
  const porId = (id) => asignaciones.find((a) => a.id === id)
  const db = {
    tareaAsignacion: {
      findMany: async ({ where }) => asignaciones.filter((a) => a.id_tarea === where.id_tarea && a.activa && a.id !== where.NOT?.id),
      findFirst: async ({ where }) => asignaciones.find((a) => a.id_tarea === where.id_tarea && a.id_local_ext === where.id_local_ext && a.activa) || null
    },
    tareaAsignacionDependencia: {
      findMany: async ({ where }) => {
        const activas = filas.filter((f) => f.activa)
        if (!where.OR) return activas
        const espera = new Set(where.OR[0].id_asignacion.in)
        const previa = new Set(where.OR[1].id_asignacion_prerequisito.in)
        return activas
          .filter((f) => espera.has(f.id_asignacion) || previa.has(f.id_asignacion_prerequisito))
          .map((f) => ({ ...f, asignacion: porId(f.id_asignacion), prerequisito: porId(f.id_asignacion_prerequisito) }))
      },
      create: async ({ data }) => {
        if (filas.some((f) => f.id_asignacion === data.id_asignacion && f.id_asignacion_prerequisito === data.id_asignacion_prerequisito)) {
          throw Object.assign(new Error('duplicada'), { code: 'P2002' })
        }
        filas.push({ ...data, activa: true })
      },
      updateMany: async ({ where }) => {
        const f = filas.find((x) => x.id_asignacion === where.id_asignacion && x.id_asignacion_prerequisito === where.id_asignacion_prerequisito && !x.activa)
        if (f) f.activa = true
        return { count: f ? 1 : 0 }
      }
    }
  }
  return { db, asignaciones, filas, asignar }
}

const tiene = (filas, espera, previa) => filas.some((f) => f.activa && f.id_asignacion === espera && f.id_asignacion_prerequisito === previa)

test('un CMV en un local nuevo espera al VTA/OP de ese local y el Informe de ese local lo espera a el', async () => {
  const { db, asignar, filas } = baseConCircuito()
  asignar('vta-l3', 'vta', 'l3')
  asignar('inf-l3', 'inf', 'l3')
  asignar('cmv-l3', 'cmv', 'l3')

  const r = await heredarDependencias(db, { id: 'cmv-l3', id_tarea: 'cmv', id_local_ext: 'l3' })

  assert.equal(r.creadas, 2)
  assert.ok(tiene(filas, 'cmv-l3', 'vta-l3'))
  assert.ok(tiene(filas, 'inf-l3', 'cmv-l3'))
})

test('si el local nuevo no tiene la otra tarea, no inventa nada', async () => {
  const { db, asignar, filas } = baseConCircuito()
  asignar('cmv-l4', 'cmv', 'l4')
  const antes = filas.length

  const r = await heredarDependencias(db, { id: 'cmv-l4', id_tarea: 'cmv', id_local_ext: 'l4' })

  assert.equal(r.creadas, 0)
  assert.equal(filas.length, antes)
})

test('nunca espera al local de otro', async () => {
  const { db, asignar, filas } = baseConCircuito()
  asignar('cmv-l5', 'cmv', 'l5')
  await heredarDependencias(db, { id: 'cmv-l5', id_tarea: 'cmv', id_local_ext: 'l5' })
  assert.ok(!filas.some((f) => f.id_asignacion === 'cmv-l5'))
})

test('una tarea nueva, sin otros locales, no crea esperas', async () => {
  const { db } = baseConCircuito()
  const r = await heredarDependencias(db, { id: 'x-l1', id_tarea: 'nueva', id_local_ext: 'l1' })
  assert.equal(r.creadas, 0)
})

test('una espera vieja inactiva de ese local vuelve a valer', async () => {
  const { db, asignar, filas } = baseConCircuito()
  asignar('vta-l6', 'vta', 'l6')
  asignar('cmv-l6', 'cmv', 'l6')
  filas.push({ id_asignacion: 'cmv-l6', id_asignacion_prerequisito: 'vta-l6', activa: false })

  const r = await heredarDependencias(db, { id: 'cmv-l6', id_tarea: 'cmv', id_local_ext: 'l6' })

  assert.equal(r.creadas, 1)
  assert.ok(tiene(filas, 'cmv-l6', 'vta-l6'))
})

test('no cierra un ciclo', async () => {
  const { db, asignar, filas } = baseConCircuito()
  asignar('vta-l7', 'vta', 'l7')
  asignar('cmv-l7', 'cmv', 'l7')
  // En l7 alguien cargo al reves: el VTA/OP espera al CMV.
  filas.push({ id_asignacion: 'vta-l7', id_asignacion_prerequisito: 'cmv-l7', activa: true })

  const r = await heredarDependencias(db, { id: 'cmv-l7', id_tarea: 'cmv', id_local_ext: 'l7' })

  assert.equal(r.creadas, 0)
  assert.ok(!tiene(filas, 'cmv-l7', 'vta-l7'))
})
