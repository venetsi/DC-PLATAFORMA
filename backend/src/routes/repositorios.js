// Administracion de los documentos que /buscar (Chat) puede consultar via
// Gemini File Search. Todo admin-only, mismo patron que
// routes/departamentos.js (fastify.requireAdminGlobal).
import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import multipart from '@fastify/multipart'
import { subirDocumento, indexarUrl, eliminarDocumento } from '../lib/repositorios.js'

const EXTENSION_A_TIPO = { '.txt': 'TXT', '.md': 'MD', '.pdf': 'PDF' }

// null/"" o el literal "general" -> el pool general (id_departamento NULL).
// Cualquier otro valor se toma como el id del departamento.
function resolverScope(valor) {
  if (!valor || valor === 'general') return null
  return valor
}

export default async function repositoriosRoutes(fastify) {
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

  fastify.get('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request) => {
    const id_departamento = resolverScope(request.query.id_departamento)
    return fastify.db.repositorioDocumento.findMany({
      where: { id_departamento },
      orderBy: { created_at: 'desc' }
    })
  })

  fastify.post('/subir', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No se recibió ningún archivo' })

    const ext = path.extname(data.filename || '').toLowerCase()
    const tipo = EXTENSION_A_TIPO[ext]
    if (!tipo) return reply.code(400).send({ error: `Tipo de archivo no soportado (${ext || 'sin extensión'}) -- solo .txt, .md o .pdf` })

    const id_departamento = resolverScope(data.fields?.id_departamento?.value)
    const nombre = data.fields?.nombre?.value?.trim() || data.filename

    const rutaTemporal = path.join(os.tmpdir(), `repo-subida-${randomUUID()}${ext}`)
    try {
      await writeFile(rutaTemporal, await data.toBuffer())
      const documento = await subirDocumento(fastify, {
        id_departamento,
        tipo,
        nombre,
        rutaArchivo: rutaTemporal,
        created_by: request.user.id
      })
      return reply.code(201).send(documento)
    } catch (err) {
      await unlink(rutaTemporal).catch(() => {})
      fastify.log.error({ err: err.message }, 'repositorios: falló la subida')
      return reply.code(500).send({ error: 'No se pudo subir el archivo. Probá de nuevo.' })
    }
  })

  fastify.post('/url', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { url } = request.body || {}
    if (!url?.trim()) return reply.code(400).send({ error: 'url requerida' })
    try {
      new URL(url)
    } catch {
      return reply.code(400).send({ error: 'url no es válida' })
    }

    const id_departamento = resolverScope(request.body?.id_departamento)
    try {
      const documento = await indexarUrl(fastify, { id_departamento, url: url.trim(), created_by: request.user.id })
      return reply.code(201).send(documento)
    } catch (err) {
      fastify.log.error({ err: err.message, url }, 'repositorios: falló la ingesta de URL')
      return reply.code(422).send({ error: err.message })
    }
  })

  // Google Drive (Docs/Sheets/Slides): requiere el scope drive.readonly por
  // domain-wide delegation, que todavía no está otorgado -- ver "Fase 2" en
  // el plan de esta feature. El botón del frontend queda deshabilitado hasta
  // entonces; este endpoint responde 501 explícito en vez de simular éxito.
  fastify.post('/drive', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Carga desde Google Drive todavía no disponible (falta el permiso drive.readonly en la consola de Workspace).' })
  })

  fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const documento = await fastify.db.repositorioDocumento.findUnique({ where: { id: request.params.id } })
    if (!documento) return reply.code(404).send({ error: 'No encontrado' })
    await eliminarDocumento(fastify, documento)
    return reply.code(204).send()
  })
}
