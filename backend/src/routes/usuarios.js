// Cache de solo lectura de dcsmart.users -- se usa para elegir el responsable
// nominal de una asignacion (TareaAsignacion.asignado_a). Nunca CRUD: dcsmart
// es la fuente de verdad, esto se puebla desde el ticket SSO (ver auth.js).
export default async function usuariosRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento } = request.query
    // select acotado: es_admin_global no tiene nada que hacer en un
    // desplegable de "quien es responsable de esta tarea".
    return fastify.db.extUser.findMany({
      where: { activo: true, ...(departamento ? { id_departamento: departamento } : {}) },
      select: { id: true, email: true, nombre: true, id_departamento: true },
      orderBy: { nombre: 'asc' }
    })
  })
}
