// Cache de solo lectura de dcsmart.locales -- se puebla via el ticket SSO
// (Fase 7-8) o a mano en desarrollo. Nunca CRUD real: dcsmart es la fuente
// de verdad.
export default async function localesRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async () => {
    return fastify.db.extLocal.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } })
  })
}
