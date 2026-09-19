// Documentos indexados en Gemini File Search para el comando /buscar del Chat
// App. Cada departamento tiene un store propio (se crea perezoso, en el
// primer documento -- mismo patron que Calendar/Group en
// asegurarDepartamento, ver lib/departamentos.js), mas un store GENERAL
// (GEMINI_STORE_GENERAL_ID, ver plugins/gemini.js) que no pertenece a ningun
// departamento. Sin entidad "Repositorio" separada a proposito: un
// departamento tiene un pool plano de documentos, igual que ya tiene un solo
// Calendar y un solo Group.
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
import { GEMINI_STORE_GENERAL_ID } from '../plugins/gemini.js'

const POLL_INTERVALO_MS = 3000
const POLL_MAX_INTENTOS = 40 // ~2 minutos -- de sobra para un txt/md/pdf chico

const MIME_POR_TIPO = {
  TXT: 'text/plain',
  MD: 'text/markdown',
  PDF: 'application/pdf'
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

// Store de Gemini File Search de un departamento. Perezoso: si ya tiene uno
// lo devuelve tal cual, si no lo crea y lo persiste -- idempotente igual que
// asegurarDepartamento.
export async function asegurarFileSearchStore(fastify, departamento) {
  if (departamento.gemini_file_search_store) return departamento.gemini_file_search_store
  const store = await fastify.gemini.fileSearchStores.create({
    config: { displayName: `DC-PLATAFORMA — ${departamento.nombre}` }
  })
  await fastify.db.departamento.update({
    where: { id: departamento.id },
    data: { gemini_file_search_store: store.name }
  })
  return store.name
}

// Sube un archivo YA ESCRITO EN DISCO (rutaArchivo) al store que corresponda
// segun id_departamento (null = general). No bloquea esperando el indexado --
// ver comentario de arriba. `rutaArchivo` se borra apenas termina la llamada
// de subida (Gemini ya tiene los bytes; el polling posterior no lo necesita).
export async function subirDocumento(fastify, { id_departamento, tipo, nombre, rutaArchivo, origen = null, created_by }) {
  const { db, gemini, log } = fastify

  let storeName = GEMINI_STORE_GENERAL_ID
  if (id_departamento) {
    const departamento = await db.departamento.findUniqueOrThrow({ where: { id: id_departamento } })
    storeName = await asegurarFileSearchStore(fastify, departamento)
  }
  if (!storeName) {
    throw new Error('No hay store general configurado (falta GEMINI_STORE_GENERAL_ID) -- correr scripts/crear-store-general.mjs')
  }

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
    data: { id_departamento, tipo, nombre, origen, gemini_operacion: operacion.name ?? null, estado: 'PENDIENTE', created_by }
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

export async function indexarUrl(fastify, { id_departamento, url, created_by }) {
  const { titulo, texto } = await extraerTextoDeUrl(url)
  if (!texto) throw new Error('No se pudo extraer texto legible de esa URL.')

  const contenido = `# ${titulo}\n\nFuente: ${url}\n\n${texto}`
  const rutaTemporal = path.join(os.tmpdir(), `repo-url-${randomUUID()}.md`)
  await writeFile(rutaTemporal, contenido, 'utf-8')

  return subirDocumento(fastify, {
    id_departamento,
    tipo: 'URL',
    nombre: titulo,
    rutaArchivo: rutaTemporal,
    origen: url,
    created_by
  })
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

// Vacía por completo el pool de un departamento (o el general, pasando null):
// borra el store ENTERO en Gemini (force:true, si no tira si quedan
// documentos) y limpia las filas propias. Pensado para el harness de test y
// para "reiniciar" un departamento desde admin.
export async function vaciarStoreDeDepartamento(fastify, departamento) {
  if (departamento?.gemini_file_search_store) {
    await fastify.gemini.fileSearchStores
      .delete({ name: departamento.gemini_file_search_store, config: { force: true } })
      .catch((err) => {
        fastify.log.warn?.({ err: err.message, departamento: departamento.slug }, 'repositorios: no se pudo borrar el store en Gemini')
      })
    await fastify.db.departamento.update({ where: { id: departamento.id }, data: { gemini_file_search_store: null } })
  }
  await fastify.db.repositorioDocumento.deleteMany({ where: { id_departamento: departamento?.id ?? null } })
}
