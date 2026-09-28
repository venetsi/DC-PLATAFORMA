import { test } from 'node:test'
import assert from 'node:assert/strict'
import dependenciasRoutes from './dependencias.js'

// "En todos los locales" con una base falsa: cada local espera al mismo local
// de la otra tarea, y lo que no tiene par o cerraria un ciclo se informa.
test('lote: crea por local, informa lo que no tiene par y lo que cerraria un ciclo', async () => {
  const local = (id) => ({ id, nombre: id.toUpperCase() })
  const asignacion = (id, idTarea, idLocal) => ({
    id, id_tarea: idTarea, id_local_ext: idLocal, activa: true,
    local: idLocal ? local(idLocal) : null,
    tarea: { id: idTarea, nombre: idTarea, id_departamento: 'aud', departamento: { nombre: 'Auditoría' } }
  })
  const asignaciones = [
    asignacion('rep-l1', 'reporte', 'l1'), asignacion('rep-l2', 'reporte', 'l2'),
    asignacion('rep-l3', 'reporte', 'l3'), asignacion('rep-emp', 'reporte', null),
    asignacion('cmv-l1', 'cmv', 'l1'), asignacion('cmv-l2', 'cmv', 'l2'), asignacion('cmv-emp', 'cmv', null)
  ]
  const filas = [
    { id_asignacion: 'rep-l2', id_asignacion_prerequisito: 'cmv-l2', activa: true }, // ya estaba
    { id_asignacion: 'cmv-l1', id_asignacion_prerequisito: 'rep-l1', activa: true } // cerraria un ciclo
  ]
  const db = {
    extUser: { findUnique: async () => ({ id: 'u', email: 'owner@dcsmart.app', departamentos: ['aud'], roles: { aud: 'OWNER' } }) },
    tareaAsignacion: {
      findUnique: async ({ where }) => asignaciones.find((a) => a.id === where.id) || null,
      findMany: async ({ where }) => asignaciones.filter((a) => a.id_tarea === where.id_tarea && a.activa)
    },
    tareaAsignacionDependencia: {
      findMany: async () => filas.filter((f) => f.activa),
      create: async ({ data }) => {
        if (filas.some((f) => f.id_asignacion === data.id_asignacion && f.id_asignacion_prerequisito === data.id_asignacion_prerequisito)) {
          throw Object.assign(new Error('duplicada'), { code: 'P2002' })
        }
        filas.push({ ...data, activa: true })
        return { id: 'nueva', ...data }
      },
      updateMany: async () => ({ count: 0 })
    }
  }
  const rutas = {}
  const fastify = {
    db,
    authenticate: async () => {},
    get: () => {}, delete: () => {},
    post: (ruta, _opciones, handler) => { rutas[ruta] = handler }
  }
  await dependenciasRoutes(fastify)

  let codigo = 200
  const reply = { code: (c) => { codigo = c; return reply }, send: (cuerpo) => cuerpo }
  const r = await rutas['/lote']({ body: { id_asignacion: 'rep-l3', id_tarea_prerequisito: 'cmv' }, user: { id: 'u' } }, reply)

  assert.equal(codigo, 201)
  assert.deepEqual(r, { creadas: 1, ya_existian: 1, sin_par: ['L3'], ciclos: ['L1'] })
  assert.ok(filas.some((f) => f.id_asignacion === 'rep-emp' && f.id_asignacion_prerequisito === 'cmv-emp'))
})
