// CRUD del catalogo de Tarea (nombre + departamento fijo). Solo admin global
// -- ver server.js `requireAdminGlobal` (dev: DEV_ADMIN_EMAIL, Fase 8: rol
// super_admin/dcsmart real via ticket).
export default async function tareasRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento } = request.query
    return fastify.db.tarea.findMany({
      where: { activa: true, ...(departamento ? { id_departamento: departamento } : {}) },
      orderBy: { nombre: 'asc' }
    })
  })

  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { nombre, id_departamento, descripcion } = request.body || {}
    if (!nombre || !id_departamento) {
      return reply.code(400).send({ error: 'nombre e id_departamento son requeridos' })
    }
    const tarea = await fastify.db.tarea.create({ data: { nombre, id_departamento, descripcion } })
    return reply.code(201).send(tarea)
  })

  fastify.patch('/:id', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request) => {
    const { nombre, descripcion, activa } = request.body || {}
    return fastify.db.tarea.update({
      where: { id: request.params.id },
      data: { nombre, descripcion, activa }
    })
  })
}
