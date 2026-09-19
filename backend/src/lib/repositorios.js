// Documentos indexados en Gemini File Search para el comando /buscar del Chat
// App. Cada Repositorio (entidad con nombre propio, ver schema.prisma) tiene
// un store propio (se crea perezoso, en el primer documento -- mismo patron
// que Calendar/Group en asegurarDepartamento, ver lib/departamentos.js). Un
// Repositorio se asigna a cero o mas departamentos (RepositorioDepartamento);
// sin ninguno asignado, es general y lo ve cualquier Space.
//
// El indexado es ASINCRONICO -- confirmado contra los tipos reales del SDK
// instalado (@google/genai@2.23.0, ver node_modules/@google/genai/dist/
// genai.d.ts): uploadToFileSearchStore devuelve una Operation de larga
// duracion (done:false al principio), no exito/error en el momento. Por eso
// el flujo es: (1) subirDocumento inserta la fila PENDIENTE y dispara el
// upload, (2) sin awaitear arranca el polling, (3) cuando la Operation
// reporta done:true la fila pasa a INDEXADO (con gemini_file_id =
// operacion.response.documentName) o ERROR. Mismo idioma fire-and-forget que
// propagarEnBackground en marcar-instancia.js.
import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { load as cargarHtml } from 'cheerio'
import { getDrive } from './drive-auth.js'

const POLL_INTERVALO_MS = 3000
const POLL_MAX_INTENTOS = 40 // ~2 minutos -- de sobra para un txt/md/pdf chico

// El mimeType que se le declara a GEMINI, no el de origen -- para
// DRIVE_SHEET en particular, el CSV exportado de Drive se sube como texto
// plano a proposito: "text/csv" no esta entre los formatos nativos
// documentados de File Search (solo text/plain, text/markdown,
// application/pdf), y un CSV es texto delimitado igual, asi que Gemini lo
// puede leer perfectamente como plano -- sin parseo de columnas especial,
// pero sin riesgo de que lo rechace por tipo no soportado.
const MIME_POR_TIPO = {
  TXT: 'text/plain',
  MD: 'text/markdown',
  PDF: 'application/pdf',
  DRIVE_DOC: 'text/plain',
  DRIVE_SHEET: 'text/plain',
  DRIVE_SLIDE: 'text/plain'
}

async function marcarError(db, log, documentoId, error) {
  await db.repositorioDocumento
    .update({ where: { id: documentoId }, data: { estado: 'ERROR', error: String(error).slice(0, 500) } })
    .catch((err) => log.error?.({ err: err.message, documentoId }, 'repositorios: no se pudo ni siquiera marcar el ERROR'))
}

async function pollHastaIndexado(fastify, documentoId, operacion) {
  const { db, gemini, log } = fastify
  for (let intento = 0; intento < POLL_MAX_INTENTOS; intento++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVALO_MS))
    let actual
    try {
      actual = await gemini.operations.get({ operation: operacion })
    } catch (err) {
      log.error?.({ err: err.message, documentoId }, 'repositorios: fallo el polling de indexado')
      return marcarError(db, log, documentoId, err.message)
    }
    if (!actual.done) continue
    if (actual.error) return marcarError(db, log, documentoId, JSON.stringify(actual.error))
    await db.repositorioDocumento.update({
      where: { id: documentoId },
      data: { estado: 'INDEXADO', gemini_file_id: actual.response?.documentName ?? null }
    })
    return
  }
  return marcarError(db, log, documentoId, 'Se agoto el tiempo de espera del indexado (2 minutos).')
}

// Store de Gemini File Search de un repositorio. Perezoso: si ya tiene uno lo
// devuelve tal cual, si no lo crea y lo persiste -- idempotente igual que
// asegurarDepartamento.
export async function asegurarFileSearchStore(fastify, repositorio) {
  if (repositorio.gemini_file_search_store) return repositorio.gemini_file_search_store
  const store = await fastify.gemini.fileSearchStores.create({
    config: { displayName: `DC-PLATAFORMA — ${repositorio.nombre}` }
  })
  await fastify.db.repositorio.update({
    where: { id: repositorio.id },
    data: { gemini_file_search_store: store.name }
  })
  return store.name
}

// Repositorios visibles para un Space que cubre `idsDepartamentos` (dueño +
// compartidos, o los 11 en "modo todo" -- lo que ya resuelva ambitoDeChat):
// los generales (sin ninguna fila en RepositorioDepartamento) MAS los
// asignados a cualquiera de esos departamentos.
export async function repositoriosVisibles(db, idsDepartamentos) {
  return db.repositorio.findMany({
    where: {
      activo: true,
      OR: [{ departamentos: { none: {} } }, { departamentos: { some: { id_departamento: { in: idsDepartamentos } } } }]
    }
  })
}

export async function crearRepositorio(fastify, { nombre, tipo, driveFolderId, idsDepartamentos = [], created_by }) {
  const repositorio = await fastify.db.repositorio.create({
    data: {
      nombre,
      tipo,
      drive_folder_id: tipo === 'DRIVE_FOLDER' ? driveFolderId : null,
      created_by
    }
  })
  for (const id_departamento of idsDepartamentos) {
    await fastify.db.repositorioDepartamento.create({ data: { id_repositorio: repositorio.id, id_departamento } })
  }
  return repositorio
}

// Recalcula ENTERA la asignacion de departamentos de un repositorio a partir
// de lo tildado en el formulario -- mismo criterio "esto es lo que hay ahora"
// que vincularDepartamentos en chat-comandos.js, no un alta de a una.
export async function actualizarDepartamentosDeRepositorio(fastify, { id_repositorio, idsDepartamentos }) {
  const { db } = fastify
  const actuales = await db.repositorioDepartamento.findMany({ where: { id_repositorio } })
  const idsActuales = new Set(actuales.map((a) => a.id_departamento))
  const idsNuevos = new Set(idsDepartamentos)

  const aBorrar = actuales.filter((a) => !idsNuevos.has(a.id_departamento))
  if (aBorrar.length) {
    await db.repositorioDepartamento.deleteMany({ where: { id: { in: aBorrar.map((a) => a.id) } } })
  }
  for (const id_departamento of idsNuevos) {
    if (!idsActuales.has(id_departamento)) {
      await db.repositorioDepartamento.create({ data: { id_repositorio, id_departamento } })
    }
  }
}

// Sube un archivo YA ESCRITO EN DISCO (rutaArchivo) al store del repositorio.
// No bloquea esperando el indexado -- ver comentario de arriba. `rutaArchivo`
// se borra apenas termina la llamada de subida (Gemini ya tiene los bytes; el
// polling posterior no lo necesita).
export async function subirDocumento(fastify, { id_repositorio, tipo, nombre, rutaArchivo, origen = null, created_by }) {
  const { db, gemini, log } = fastify

  const repositorio = await db.repositorio.findUniqueOrThrow({ where: { id: id_repositorio } })
  const storeName = await asegurarFileSearchStore(fastify, repositorio)

  let operacion
  try {
    operacion = await gemini.fileSearchStores.uploadToFileSearchStore({
      fileSearchStoreName: storeName,
      file: rutaArchivo,
      config: { mimeType: MIME_POR_TIPO[tipo], displayName: nombre }
    })
  } finally {
    await unlink(rutaArchivo).catch(() => {})
  }

  const documento = await db.repositorioDocumento.create({
    data: { id_repositorio, tipo, nombre, origen, gemini_operacion: operacion.name ?? null, estado: 'PENDIENTE', created_by }
  })

  pollHastaIndexado(fastify, documento.id, operacion).catch((err) =>
    log.error?.({ err: err.message, documentoId: documento.id }, 'repositorios: polling fallo sin capturar')
  )

  return documento
}

// Ingesta de URL: Gemini File Search no rastrea URLs, solo sube archivos --
// se fetchea la pagina, se extrae el texto legible con cheerio (nunca con
// regex sobre HTML: cualquier <script>/<style> que se cuele ensucia en
// silencio el texto indexado) y se sube como un .md sintetico.
const MAX_BYTES_URL = 5 * 1024 * 1024
const TIMEOUT_URL_MS = 10000
const MAX_CHARS_TEXTO = 200000

async function extraerTextoDeUrl(url) {
  const controlador = new AbortController()
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_URL_MS)
  let respuesta
  try {
    respuesta = await fetch(url, { signal: controlador.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timeout)
  }
  if (!respuesta.ok) throw new Error(`La URL respondió ${respuesta.status}.`)
  const tipoContenido = respuesta.headers.get('content-type') || ''
  if (!tipoContenido.includes('text/html')) {
    throw new Error(`Tipo de contenido no soportado (${tipoContenido || 'desconocido'}) -- solo páginas HTML.`)
  }
  const buffer = await respuesta.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES_URL) throw new Error('La página supera el tamaño máximo soportado (5MB).')

  const $ = cargarHtml(Buffer.from(buffer).toString('utf-8'))
  $('script,style,noscript,nav,footer,header,aside,form,iframe').remove()
  const contenedor = $('main, article, [role=main]').first()
  const texto = (contenedor.length ? contenedor : $('body')).text().replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_TEXTO)
  const titulo = $('title').first().text().trim() || url
  return { titulo, texto }
}

export async function indexarUrl(fastify, { id_repositorio, url, created_by }) {
  const { titulo, texto } = await extraerTextoDeUrl(url)
  if (!texto) throw new Error('No se pudo extraer texto legible de esa URL.')

  const contenido = `# ${titulo}\n\nFuente: ${url}\n\n${texto}`
  const rutaTemporal = path.join(os.tmpdir(), `repo-url-${randomUUID()}.md`)
  await writeFile(rutaTemporal, contenido, 'utf-8')

  return subirDocumento(fastify, {
    id_repositorio,
    tipo: 'URL',
    nombre: titulo,
    rutaArchivo: rutaTemporal,
    origen: url,
    created_by
  })
}

// --- Carpeta de Google Drive como repositorio ------------------------------
//
// Non-recursiva a proposito (v1): subcarpetas se listan pero se saltean, no
// se bajan sus archivos. Sync manual via boton "Resincronizar", no push
// automatico -- Drive push notifications exigirian un canal + endpoint
// publico de renovacion, infraestructura nueva que no hace falta para el
// caso real (un puñado de manuales que se actualizan de vez en cuando).
//
// Idempotente por archivo: antes de importar un archivo de Drive se chequea
// si ya existe un RepositorioDocumento con ese `origen` (el fileId) en este
// repositorio -- si ya esta, se saltea. No hay deteccion de "el archivo
// CAMBIO desde la ultima sync" en v1: para eso habria que comparar
// modifiedTime y volver a subir/reemplazar, documentado como limitacion.
const EXPORTABLES = {
  'application/vnd.google-apps.document': { tipo: 'DRIVE_DOC', mimeType: 'text/plain' },
  'application/vnd.google-apps.presentation': { tipo: 'DRIVE_SLIDE', mimeType: 'text/plain' },
  'application/vnd.google-apps.spreadsheet': { tipo: 'DRIVE_SHEET', mimeType: 'text/csv' }
}
const DESCARGABLES = { 'text/plain': 'TXT', 'text/markdown': 'MD', 'application/pdf': 'PDF' }

async function importarArchivoDrive(fastify, { drive, archivo, id_repositorio, created_by }) {
  const yaExiste = await fastify.db.repositorioDocumento.findFirst({
    where: { id_repositorio, origen: archivo.id }
  })
  if (yaExiste) return { saltado: true }

  const exportable = EXPORTABLES[archivo.mimeType]
  const tipoDescargable = DESCARGABLES[archivo.mimeType]
  if (!exportable && !tipoDescargable) return { saltado: true, motivo: `tipo no soportado (${archivo.mimeType})` }

  const ext = exportable ? '.txt' : `.${tipoDescargable.toLowerCase()}`
  const rutaTemporal = path.join(os.tmpdir(), `repo-drive-${randomUUID()}${ext}`)

  if (exportable) {
    const { data } = await drive.files.export(
      { fileId: archivo.id, mimeType: exportable.mimeType },
      { responseType: 'text' }
    )
    await writeFile(rutaTemporal, data, 'utf-8')
    await subirDocumento(fastify, {
      id_repositorio, tipo: exportable.tipo, nombre: archivo.name, rutaArchivo: rutaTemporal, origen: archivo.id, created_by
    })
  } else {
    const { data } = await drive.files.get(
      { fileId: archivo.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    )
    await writeFile(rutaTemporal, Buffer.from(data))
    await subirDocumento(fastify, {
      id_repositorio, tipo: tipoDescargable, nombre: archivo.name, rutaArchivo: rutaTemporal, origen: archivo.id, created_by
    })
  }
  return { saltado: false }
}

export async function sincronizarCarpetaDrive(fastify, repositorio) {
  if (repositorio.tipo !== 'DRIVE_FOLDER' || !repositorio.drive_folder_id) {
    throw new Error('Este repositorio no está vinculado a una carpeta de Drive.')
  }
  const drive = await getDrive()
  // supportsAllDrives + includeItemsFromAllDrives: SIN esto, la API de Drive
  // v3 solo busca en "Mi unidad" del usuario impersonado e ignora por
  // completo las Unidades compartidas (Shared Drives) de las que es
  // miembro -- devuelve 0 resultados en silencio, sin ningun error que lo
  // delate. Confirmado en produccion (2026-09-19): la carpeta real que se
  // probo es justamente una Unidad compartida.
  const { data } = await drive.files.list({
    q: `'${repositorio.drive_folder_id}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  })
  const archivos = data.files || []

  let importados = 0
  let salteados = 0
  const errores = []
  for (const archivo of archivos) {
    if (archivo.mimeType === 'application/vnd.google-apps.folder') { salteados++; continue }
    try {
      const resultado = await importarArchivoDrive(fastify, { drive, archivo, id_repositorio: repositorio.id, created_by: 'drive-sync' })
      if (resultado.saltado) salteados++
      else importados++
    } catch (err) {
      fastify.log.error?.({ err: err.message, archivo: archivo.name }, 'repositorios: falló importar un archivo de Drive')
      errores.push({ archivo: archivo.name, error: err.message })
    }
  }

  await fastify.db.repositorio.update({ where: { id: repositorio.id }, data: { ultimo_sync: new Date() } })
  return { total: archivos.length, importados, salteados, errores }
}

// Borra un documento suelto: primero en Gemini (si ya llegó a indexarse),
// despues la fila propia. Si el borrado en Gemini falla igual se borra la
// fila -- no dejar un documento "fantasma" en la pantalla de admin por un
// error transitorio del lado de Google.
export async function eliminarDocumento(fastify, documento) {
  if (documento.gemini_file_id) {
    await fastify.gemini.fileSearchStores.documents
      .delete({ name: documento.gemini_file_id, config: { force: true } })
      .catch((err) => {
        fastify.log.warn?.({ err: err.message, documentoId: documento.id }, 'repositorios: no se pudo borrar el documento en Gemini (se borra igual de la base)')
      })
  }
  await fastify.db.repositorioDocumento.delete({ where: { id: documento.id } })
}

// Borra un repositorio ENTERO: el store en Gemini (force:true, si no tira si
// quedan documentos), las filas de asignacion a departamentos, sus
// documentos, y el repositorio en si.
export async function eliminarRepositorio(fastify, repositorio) {
  const { db } = fastify
  if (repositorio.gemini_file_search_store) {
    await fastify.gemini.fileSearchStores
      .delete({ name: repositorio.gemini_file_search_store, config: { force: true } })
      .catch((err) => {
        fastify.log.warn?.({ err: err.message, repositorio: repositorio.nombre }, 'repositorios: no se pudo borrar el store en Gemini')
      })
  }
  await db.repositorioDepartamento.deleteMany({ where: { id_repositorio: repositorio.id } })
  await db.repositorioDocumento.deleteMany({ where: { id_repositorio: repositorio.id } })
  await db.repositorio.delete({ where: { id: repositorio.id } })
}
