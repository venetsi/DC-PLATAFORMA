import { randomUUID } from 'node:crypto'
import { asegurarDepartamento } from '../lib/departamentos.js'
import { aSlug } from '../lib/slug.js'
import { sincronizarMembresias } from '../lib/membresias.js'
import { usuarioActual, puede } from '../lib/permisos.js'

export default async function departamentosRoutes(fastify) {
  // select acotado a proposito -- Departamento tambien guarda kiosko_key y
  // chat_webhook_url (secretos), que no tienen nada que hacer en una
  // respuesta que llega a cualquier usuario logueado (no solo admin).
  // chat_webhook_url se trae solo para derivar tiene_webhook (booleano) y se
  // descarta antes de responder -- el valor crudo nunca sale de acá, ni para
  // admin (mismo criterio que el PATCH de notificaciones, mas abajo).
  fastify.get('/', { preHandler: [fastify.authenticate] }, async () => {
    const departamentos = await fastify.db.departamento.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        slug: true,
        id_calendar_google: true,
        chat_space_name: true,
        chat_webhook_url: true,
        dias_aviso_departamento: true,
        dias_aviso_direccion: true,
        email_group_google: true,
        membresia_sync_ok_at: true,
        membresia_sync_error: true,
        _count: { select: { membresias: true } }
      },
      orderBy: { nombre: 'asc' }
    })
    return departamentos.map(({ chat_webhook_url, ...d }) => ({ ...d, tiene_webhook: Boolean(chat_webhook_url) }))
  })

  // Relee ya mismo los Google Groups depto-* (normalmente se refresca solo cada
  // ~15 min). `forzar` aplica aunque un grupo haya perdido mas de la mitad.
  fastify.post('/membresias/sincronizar', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request) => {
    return sincronizarMembresias(fastify, { forzar: request.query.forzar === 'true' })
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

  // Configuracion de avisos: el webhook de Chat y los dos umbrales de
  // escalamiento (ver lib/escalamiento.js). Existe para no tener que cargarlos
  // por SQL a mano contra la base compartida con produccion.
  fastify.patch(
    '/:id/notificaciones',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      // Los avisos de un departamento los configura un OWNER de su grupo (o
      // Direccion/admin, que cuentan como OWNER en todos).
      if (!puede(await usuarioActual(fastify, request), 'administrar', request.params.id)) {
        return reply.code(403).send({ error: 'Los avisos del departamento los configura un OWNER de su grupo' })
      }
      const body = request.body || {}
      const datos = {}

      if ('chat_webhook_url' in body) {
        const url = body.chat_webhook_url
        if (url === null || url === '') {
          datos.chat_webhook_url = null
        } else {
          // Solo webhooks de Chat: sin esto, un valor mal pegado haria que el
          // job postee las tareas internas del departamento a cualquier host.
          let host
          try {
            host = new URL(String(url)).host
          } catch {
            return reply.code(400).send({ error: 'chat_webhook_url no es una URL válida' })
          }
          if (host !== 'chat.googleapis.com') {
            return reply.code(400).send({ error: 'El webhook tiene que ser de chat.googleapis.com' })
          }
          datos.chat_webhook_url = String(url)
        }
      }

      for (const campo of ['dias_aviso_departamento', 'dias_aviso_direccion']) {
        if (!(campo in body)) continue
        const valor = body[campo]
        if (valor === null || valor === '') {
          datos[campo] = null // volver al default global de entorno
          continue
        }
        const n = Number.parseInt(valor, 10)
        if (!Number.isFinite(n) || n < 0 || n > 365) {
          return reply.code(400).send({ error: `${campo} tiene que ser un entero entre 0 y 365` })
        }
        datos[campo] = n
      }

      if (!Object.keys(datos).length) return reply.code(400).send({ error: 'No hay nada que actualizar' })

      const existente = await fastify.db.departamento.findUnique({ where: { id: request.params.id } })
      if (!existente) return reply.code(404).send({ error: 'Departamento no encontrado' })

      const actualizado = await fastify.db.departamento.update({
        where: { id: request.params.id },
        data: datos,
        // El webhook NUNCA vuelve en la respuesta -- es un secreto: quien lo
        // tiene puede postear en el Space. Se devuelve solo si esta cargado.
        select: {
          id: true,
          nombre: true,
          slug: true,
          dias_aviso_departamento: true,
          dias_aviso_direccion: true,
          chat_webhook_url: true
        }
      })
      return { ...actualizado, chat_webhook_url: undefined, tiene_webhook: Boolean(actualizado.chat_webhook_url) }
    }
  )
}
