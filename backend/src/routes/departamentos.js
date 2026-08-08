export default async function departamentosRoutes(fastify) {
  // Lista cacheada -- el catalogo real de departamentos vive en dcsmart
  // (Fase 8) o se siembra a mano (prisma/seed.js) mientras tanto. Esta ruta
  // nunca crea departamentos: eso pasa via sync perezoso en /auth/sso o el seed.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async () => {
    return fastify.db.departamento.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } })
  })
}
