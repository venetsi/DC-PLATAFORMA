import { randomUUID } from 'node:crypto'
import { asegurarDepartamento } from '../lib/departamentos.js'
import { aSlug } from '../lib/slug.js'

export default async function departamentosRoutes(fastify) {
  // select acotado a proposito -- Departamento tambien guarda kiosko_key y
  // chat_webhook_url (secretos), que no tienen nada que hacer en una
  // respuesta que llega a cualquier usuario logueado (no solo admin).
  fastify.get('/', { preHandler: [fastify.authenticate] }, async () => {
    return fastify.db.departamento.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, slug: true, id_calendar_google: true },
      orderBy: { nombre: 'asc' }
    })
  })

  // Crear un departamento nuevo (Calendar + Group + clave de kiosko reales,
  // ver asegurarDepartamento) -- reservado a admin global. El resto de los
  // departamentos aparecen solos via sync perezoso en /auth/sso o el seed.
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { nombre } = request.body || {}
    if (!nombre?.trim()) return reply.code(400).send({ error: 'nombre requerido' })

    const slug = aSlug(nombre)
    if (!slug) return reply.code(400).send({ error: 'El nombre tiene que tener alguna letra o número' })

    const existente = await fastify.db.departamento.findUnique({ where: { slug } })
    if (existente) return reply.code(409).send({ error: `Ya existe un departamento con slug "${slug}"` })

    const departamento = await asegurarDepartamento(fastify, { id: randomUUID(), nombre: nombre.trim(), slug })
    return reply.code(201).send(departamento)
  })
}
