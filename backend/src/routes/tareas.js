import { usuarioActual, puedeGestionarDepartamento, esAdminGlobal } from '../lib/permisos.js'

// CRUD del catalogo de Tarea (nombre + departamento fijo). Admin global
// gestiona cualquier departamento; un usuario de departamento gestiona
// solo el propio -- y ninguno de los dos puede desactivarla salvo admin
// (ver el chequeo de `activa` en PATCH).
export default async function tareasRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento } = request.query
    return fastify.db.tarea.findMany({
      where: { activa: true, ...(departamento ? { id_departamento: departamento } : {}) },
      orderBy: { nombre: 'asc' }
    })
  })

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { nombre, id_departamento, descripcion } = request.body || {}
    if (!nombre || !id_departamento) {
      return reply.code(400).send({ error: 'nombre e id_departamento son requeridos' })
    }

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés crear tareas de tu propio departamento' })
    }

    const tarea = await fastify.db.tarea.create({ data: { nombre, id_departamento, descripcion } })
    return reply.code(201).send(tarea)
  })

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const existente = await fastify.db.tarea.findUnique({ where: { id: request.params.id } })
    if (!existente) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puedeGestionarDepartamento(usuario, existente.id_departamento)) {
      return reply.code(403).send({ error: 'Solo podés editar tareas de tu propio departamento' })
    }

    const { nombre, descripcion, activa } = request.body || {}
    // Desactivar (la unica forma de "borrar", ver convencion activo en vez
    // de hard-delete) queda reservado a admin global -- un usuario de
    // departamento puede crear/editar, no borrar.
    if (activa !== undefined && !esAdminGlobal(usuario)) {
      return reply.code(403).send({ error: 'Solo un admin global puede desactivar una tarea' })
    }

    return fastify.db.tarea.update({
      where: { id: request.params.id },
      data: { nombre, descripcion, ...(activa !== undefined ? { activa } : {}) }
    })
  })
}
