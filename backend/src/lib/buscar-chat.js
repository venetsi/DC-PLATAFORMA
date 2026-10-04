// /buscar: la rama del comando, separada de routes/chat.js para poder probarla.
//
// Que hace: pregunta a Gemini anclado SOLO en los documentos del ambito del
// Space (ver ambitoDelSpace), y deja la respuesta en un mensaje que primero
// dice "Buscando…" y despues se actualiza.
//
// Decisiones que importan (auditoria del 2026-10-04):
//
//  1. SE ESPERA EL RESULTADO DENTRO DEL PEDIDO. Antes se devolvia `{}` enseguida
//     y Gemini corria "por detras": en Cloud Run (CPU solo mientras dura el
//     pedido) ese trabajo quedaba sin CPU y el mensaje podia quedarse para
//     siempre en "Buscando…". Ahora el pedido sigue abierto hasta que se
//     actualiza el mensaje, con topes MEDIDOS DESDE QUE LLEGA EL EVENTO (no
//     desde esta funcion: Chat cuenta sus ~30 s desde que lo manda): todo el
//     pedido, incluido el tramo previo (ambito, repositorios, placeholder), se
//     corta a TOPE_PEDIDO_MS, y a Gemini se le da lo que quede menos un margen
//     para actualizar el mensaje (con un maximo de PLAZO_GEMINI_MS).
//
//  2. TODO texto que se manda por la API REST pasa por escaparPseudoEtiquetas
//     (una respuesta con algo como `<algo>` hacia que Chat rechazara el mensaje
//     entero), y se RECORTA a MAX_CARACTERES (Chat limita el texto a ~4096).
//     Si aun asi la actualizacion falla, se reintenta una vez con un texto corto
//     de rescate: el mensaje nunca deberia quedar en "Buscando…".
//
//  3. SI EL SPACE NO ESTA VINCULADO (o quien pregunta no puede operar ahi) el
//     ambito cae a "sus" departamentos (porFallback). La respuesta se publica
//     en el Space, que puede tener gente de otros equipos: por eso en ese caso
//     se busca SOLO en los documentos generales y se avisa. Excepcion: el chat
//     privado con la app (nadie mas lo ve), donde se usan sus departamentos.
import { escaparPseudoEtiquetas } from './chat-texto.js'

// El tope deja ~5 s de colchon contra los ~30 s de Chat: el reloj de Chat corre
// desde que manda el evento y aca se mide desde que lo recibe esta ruta (no cuenta
// la verificacion del token ni un arranque en frio de Cloud Run).
export const TOPE_PEDIDO_MS = 25_000
export const PLAZO_GEMINI_MS = 21_000
export const MARGEN_ACTUALIZAR_MS = 4_000
export const MAX_CARACTERES = 3_800

export const TEXTO_SIN_PREGUNTA = 'Escribí `/buscar` seguido de tu pregunta. Ejemplo: `/buscar cuál es la política de viáticos`'
export const TEXTO_SIN_DOCUMENTOS = 'No hay documentos cargados todavía para este Space. Pedile a un administrador que cargue algo desde la plataforma.'
export const TEXTO_SIN_GENERALES =
  'Acá no tenés acceso a documentos de un departamento (este Space no está vinculado o no podés operar en él) y no hay documentos generales cargados. Probá desde el Space de tu departamento.'
export const AVISO_SIN_VINCULAR =
  '_Este Space no está vinculado a un departamento (o no podés operar acá): busqué solo en los documentos generales. Para usar también los de tu departamento, preguntá desde su Space._'
export const TEXTO_LENTO = '⏱️ La búsqueda tardó demasiado. Probá de nuevo en un momento, o con una pregunta más corta.'
export const TEXTO_ERROR = '⚠️ No pude responder eso. Probá de nuevo.'
export const TEXTO_NO_INICIO = '⚠️ No pude iniciar la búsqueda. Probá de nuevo.'
const AVISO_RECORTE = '\n\n_…respuesta recortada: probá con una pregunta más puntual._'

// El SDK de Gemini tira APIUserAbortError (nuestro AbortController) o
// APIConnectionTimeoutError (su propio timeout); se reconocen por nombre para no
// depender de la clase exacta.
export function esPorTiempo(err) {
  const nombre = `${err?.name || ''} ${err?.constructor?.name || ''}`
  return /abort|timeout/i.test(nombre) || err?.code === 'ETIMEDOUT'
}

// Algunas librerias rechazan con null/undefined o con un string: un catch que
// hace err.message no puede tirar a su vez.
const mensajeDe = (err) => err?.message ?? String(err)

// El chat privado entre una persona y la app (no es un Space de equipo). Los
// campos son los del recurso Space de la Chat API (spaceType / singleUserBotDm)
// y el `type: 'DM'` del formato viejo de eventos.
export function esMensajeDirecto(space) {
  return space?.spaceType === 'DIRECT_MESSAGE' || space?.type === 'DM' || space?.singleUserBotDm === true
}

// Corta en un salto de linea cercano al limite, sin dejar el texto a medias.
export function recortar(texto, max = MAX_CARACTERES) {
  if (texto.length <= max) return texto
  const hasta = max - AVISO_RECORTE.length
  const salto = texto.lastIndexOf('\n', hasta)
  return `${texto.slice(0, salto > hasta / 2 ? salto : hasta).trimEnd()}${AVISO_RECORTE}`
}

// Devuelve { texto } si hay que contestar YA con un mensaje por el webhook, o
// { texto: null } si ya se resolvio todo por la API (el webhook devuelve `{}`).
// No tira por un fallo de Gemini, de Chat ni de la base: todo se convierte en un
// mensaje legible.
export async function ejecutarBuscar(
  { pregunta, space, extUser, esMensajeDirecto: dm = false, inicioPedido },
  {
    db,
    log = console,
    ambitoDelSpace,
    repositoriosVisibles,
    postear,
    actualizar,
    responder,
    topePedidoMs = TOPE_PEDIDO_MS,
    plazoGeminiMs = PLAZO_GEMINI_MS,
    margenActualizarMs = MARGEN_ACTUALIZAR_MS,
    ahora = () => Date.now()
  }
) {
  const inicio = inicioPedido ?? ahora()
  const transcurrido = () => ahora() - inicio
  const medir = (estado, extra = {}) => log.info?.({ buscar: { estado, duracion_ms: transcurrido(), ...extra } }, 'chat: /buscar terminado')

  pregunta = String(pregunta ?? '').trim()
  if (!pregunta) return { texto: TEXTO_SIN_PREGUNTA }

  const ctx = { mensaje: null }

  const interno = async () => {
    const { departamentos, porFallback } = await ambitoDelSpace(db, { space, extUser })
    // Sin vincular: ids vacios = solo los repositorios generales (los que no
    // estan asignados a ningun departamento). En un chat privado la respuesta
    // la ve solo quien pregunta, asi que ahi se usan sus departamentos.
    const soloGenerales = !dm && (Boolean(porFallback) || departamentos.length === 0)
    const ids = soloGenerales ? [] : departamentos.map((d) => d.id)
    const repositorios = await repositoriosVisibles(db, ids)
    if (ctx.cancelado) return { texto: null } // el tope ya vencio: el webhook contesto, no se empieza nada nuevo
    const storeNames = repositorios.map((r) => r.gemini_file_search_store).filter(Boolean)
    if (!storeNames.length) {
      medir('sin_documentos', { solo_generales: soloGenerales })
      return { texto: soloGenerales ? TEXTO_SIN_GENERALES : TEXTO_SIN_DOCUMENTOS }
    }

    try {
      ctx.mensaje = await postear(space, { text: '🔎 Buscando…' })
      // Sin el nombre del mensaje no hay como actualizarlo despues.
      if (!ctx.mensaje?.name) throw new Error('Chat no devolvió el nombre del mensaje')
    } catch (err) {
      ctx.mensaje = null
      log.error?.({ err: mensajeDe(err) }, 'chat: no se pudo postear el placeholder de /buscar')
      medir('sin_placeholder')
      return { texto: TEXTO_NO_INICIO }
    }

    // El tope vencio mientras se posteaba (Chat lento): el webhook ya dijo "tardo
    // demasiado". Se deja ese mismo texto en el placeholder, sin consultar a Gemini
    // (sino quedaria un segundo mensaje fantasma tras haber contestado).
    if (ctx.cancelado) {
      try {
        await actualizar(ctx.mensaje.name, { text: escaparPseudoEtiquetas(TEXTO_LENTO) })
      } catch (err) {
        log.error?.({ err: mensajeDe(err) }, 'chat: no se pudo cerrar el placeholder tardío de /buscar')
      }
      return { texto: null }
    }

    // A Gemini se le da lo que quede del pedido menos un margen para actualizar.
    const plazoMs = Math.max(Math.min(1_000, plazoGeminiMs), Math.min(plazoGeminiMs, topePedidoMs - transcurrido() - margenActualizarMs))
    const control = new AbortController()
    ctx.control = control
    const corte = setTimeout(() => control.abort(), plazoMs)
    let estado = 'ok'
    let texto
    try {
      // El corte no depende de que el SDK coopere con el signal: si `responder`
      // lo ignora, esta promesa igual rechaza al cumplirse el plazo.
      const cortado = new Promise((_, rechazar) => {
        control.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('Se agotó el plazo de la búsqueda'), { name: 'AbortError' })), { once: true })
      })
      cortado.catch(() => {})
      texto = await Promise.race([responder({ pregunta, storeNames, signal: control.signal, plazoMs }), cortado])
      texto = String(texto ?? '').trim()
      if (!texto) throw new Error('Gemini devolvió una respuesta vacía')
      if (soloGenerales) texto = `${recortar(texto, MAX_CARACTERES - AVISO_SIN_VINCULAR.length - 2)}\n\n${AVISO_SIN_VINCULAR}`
      else texto = recortar(texto)
    } catch (err) {
      estado = esPorTiempo(err) ? 'tiempo' : 'error'
      log.error?.({ err: mensajeDe(err), tipo: estado }, 'chat: falló /buscar')
      texto = estado === 'tiempo' ? TEXTO_LENTO : TEXTO_ERROR
    } finally {
      clearTimeout(corte)
    }

    try {
      await actualizar(ctx.mensaje.name, { text: escaparPseudoEtiquetas(texto) })
    } catch (err) {
      log.error?.({ err: mensajeDe(err) }, 'chat: no se pudo actualizar el mensaje de /buscar')
      estado = `${estado}+reintento`
      // Una vez mas con un texto corto y seguro (la causa mas probable es el
      // contenido: largo o con formato que Chat rechaza). Sin esto el mensaje
      // quedaria para siempre en "Buscando…".
      try {
        await actualizar(ctx.mensaje.name, { text: escaparPseudoEtiquetas(TEXTO_ERROR) })
      } catch (err2) {
        estado = `${estado}+sin_actualizar`
        log.error?.({ err: mensajeDe(err2) }, 'chat: tampoco se pudo dejar el texto de rescate de /buscar')
      }
    }
    medir(estado, { solo_generales: soloGenerales, documentos: storeNames.length })
    return { texto: null }
  }

  // Tope del pedido ENTERO (incluye ambito, repositorios y placeholder, que
  // antes no tenian ningun limite): el webhook contesta a tiempo pase lo que pase.
  let temporizador
  const limite = new Promise((resolver) => {
    temporizador = setTimeout(() => resolver('limite'), Math.max(0, topePedidoMs - transcurrido()))
  })
  try {
    const r = await Promise.race([
      interno().catch((err) => {
        log.error?.({ err: mensajeDe(err) }, 'chat: falló /buscar antes de poder responder')
        return { texto: ctx.mensaje ? null : TEXTO_ERROR }
      }),
      limite
    ])
    if (r !== 'limite') return r
    ctx.cancelado = true // lo que todavia no empezo, ya no empieza
    ctx.control?.abort()
    log.warn?.({ duracion_ms: transcurrido(), con_placeholder: Boolean(ctx.mensaje) }, 'chat: /buscar pasó el tope del pedido; se responde igual')
    // Con placeholder ya posteado, el trabajo sigue por su cuenta y lo actualiza;
    // sin placeholder, la persona no ve nada: se le avisa.
    return { texto: ctx.mensaje ? null : TEXTO_LENTO }
  } finally {
    clearTimeout(temporizador)
  }
}
