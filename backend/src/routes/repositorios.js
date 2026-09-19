// Administracion de los repositorios de documentos que /buscar (Chat) puede
// consultar via Gemini File Search. Todo admin-only, mismo patron que
// routes/departamentos.js (fastify.requireAdminGlobal).
import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import multipart from '@fastify/multipart'
import {
  crearRepositorio,
  actualizarDepartamentosDeRepositorio,
  subirDocumento,
  indexarUrl,
  sincronizarCarpetaDrive,
  eliminarDocumento,
  eliminarRepositorio
} from '../lib/repositorios.js'

const EXTENSION_A_TIPO = { '.txt': 'TXT', '.md': 'MD', '.pdf': 'PDF' }

// Acepta tanto una URL completa de Drive ("https://drive.google.com/drive/
// folders/<id>...") como el id pelado, para no obligar al admin a extraerlo
// a mano.
function extraerIdDeCarpeta(valor) {
  const match = String(valor || '').match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : String(valor || '').trim()
}

export default async function repositoriosRoutes(fastify) {
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

  fastify.get('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async () => {
    return fastify.db.repositorio.findMany({
      where: { activo: true },
      include: {
        departamentos: { include: { departamento: { select: { id: true, nombre: true } } } },
        _count: { select: { documentos: true } }
      },
      orderBy: { nombre: 'asc' }
    })
  })

  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { nombre, tipo, driveFolder, idsDepartamentos } = request.body || {}
    if (!nombre?.trim()) return reply.code(400).send({ error: 'nombre requerido' })
    if (!['MANUAL', 'DRIVE_FOLDER'].includes(tipo)) return reply.code(400).send({ error: 'tipo inválido' })

    let driveFolderId = null
    if (tipo === 'DRIVE_FOLDER') {
      driveFolderId = extraerIdDeCarpeta(driveFolder)
      if (!driveFolderId) return reply.code(400).send({ error: 'Falta el link o el id de la carpeta de Drive' })
    }

    const repositorio = await crearRepositorio(fastify, {
      nombre: nombre.trim(),
      tipo,
      driveFolderId,
      idsDepartamentos: Array.isArray(idsDepartamentos) ? idsDepartamentos : [],
      created_by: request.user.id
    })
    return reply.code(201).send(repositorio)
  })

  fastify.patch('/:id/departamentos', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const { idsDepartamentos } = request.body || {}
    if (!Array.isArray(idsDepartamentos)) return reply.code(400).send({ error: 'idsDepartamentos tiene que ser un array' })

    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })

    await actualizarDepartamentosDeRepositorio(fastify, { id_repositorio: repositorio.id, idsDepartamentos })
    return reply.code(204).send()
  })

  fastify.get('/:id/documentos', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })
    return fastify.db.repositorioDocumento.findMany({
      where: { id_repositorio: repositorio.id },
      orderBy: { created_at: 'desc' }
    })
  })

  fastify.post('/:id/subir', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })
    if (repositorio.tipo !== 'MANUAL') return reply.code(400).send({ error: 'Este repositorio es de carpeta de Drive -- usá "Resincronizar" en vez de subir archivos sueltos.' })

    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No se recibió ningún archivo' })

    const ext = path.extname(data.filename || '').toLowerCase()
    const tipo = EXTENSION_A_TIPO[ext]
    if (!tipo) return reply.code(400).send({ error: `Tipo de archivo no soportado (${ext || 'sin extensión'}) -- solo .txt, .md o .pdf` })

    const nombre = data.fields?.nombre?.value?.trim() || data.filename
    const rutaTemporal = path.join(os.tmpdir(), `repo-subida-${randomUUID()}${ext}`)
    try {
      await writeFile(rutaTemporal, await data.toBuffer())
      const documento = await subirDocumento(fastify, {
        id_repositorio: repositorio.id,
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

  fastify.post('/:id/url', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })
    if (repositorio.tipo !== 'MANUAL') return reply.code(400).send({ error: 'Este repositorio es de carpeta de Drive -- las URL sueltas van en un repositorio manual.' })

    const { url } = request.body || {}
    if (!url?.trim()) return reply.code(400).send({ error: 'url requerida' })
    try {
      new URL(url)
    } catch {
      return reply.code(400).send({ error: 'url no es válida' })
    }

    try {
      const documento = await indexarUrl(fastify, { id_repositorio: repositorio.id, url: url.trim(), created_by: request.user.id })
      return reply.code(201).send(documento)
    } catch (err) {
      fastify.log.error({ err: err.message, url }, 'repositorios: falló la ingesta de URL')
      return reply.code(422).send({ error: err.message })
    }
  })

  fastify.post('/:id/sincronizar', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })
    try {
      const resultado = await sincronizarCarpetaDrive(fastify, repositorio)
      return resultado
    } catch (err) {
      fastify.log.error({ err: err.message, repositorio: repositorio.nombre }, 'repositorios: falló la sincronización de Drive')
      return reply.code(422).send({ error: err.message })
    }
  })

  fastify.delete('/documentos/:id', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const documento = await fastify.db.repositorioDocumento.findUnique({ where: { id: request.params.id } })
    if (!documento) return reply.code(404).send({ error: 'No encontrado' })
    await eliminarDocumento(fastify, documento)
    return reply.code(204).send()
  })

  fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.requireAdminGlobal] }, async (request, reply) => {
    const repositorio = await fastify.db.repositorio.findUnique({ where: { id: request.params.id } })
    if (!repositorio) return reply.code(404).send({ error: 'No encontrado' })
    await eliminarRepositorio(fastify, repositorio)
    return reply.code(204).send()
  })
}
