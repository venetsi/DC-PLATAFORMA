// Lee CumplimientoDiario (snapshot escrito por el job diario) -- nunca
// recalcula agregando eventos de Calendar en vivo, ver docs/superpowers.
export default async function reportesRoutes(fastify) {
  fastify.get('/cumplimiento', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, desde, hasta } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    const esAdmin = usuario?.email === 'admin@dcsmart.app'
    if (!esAdmin && usuario?.id_departamento !== idDepartamento) {
      return reply.code(403).send({ error: 'No tenes acceso a este departamento' })
    }

    const snapshots = await fastify.db.cumplimientoDiario.findMany({
      where: {
        id_departamento: idDepartamento,
        fecha: {
          gte: desde ? new Date(desde) : undefined,
          lte: hasta ? new Date(hasta) : undefined
        }
      },
      orderBy: { fecha: 'asc' }
    })

    const totales = snapshots.reduce(
      (acc, s) => ({ total: acc.total + s.total_tareas, realizadas: acc.realizadas + s.realizadas }),
      { total: 0, realizadas: 0 }
    )
    const porcentajeCumplimiento = totales.total > 0 ? Math.round((totales.realizadas / totales.total) * 100) : null

    return { snapshots, porcentajeCumplimiento }
  })
}
