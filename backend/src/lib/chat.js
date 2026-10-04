// Cliente de Google Chat: postear en un Space y resolver la identidad de quien
// clickea. Sin logica de negocio -- eso vive en routes/chat.js y en el job.
import { getChat } from './chat-auth.js'

// Un 403/404 al postear casi siempre significa que sacaron la app del Space
// (o que el Space se borro). Reintentar eso es tirar cuota al vacio, asi que
// se distingue del resto de los errores para informarlo con un mensaje claro.
// NO se desvincula aca: la baja de verdad la da el evento REMOVED_FROM_SPACE
// (routes/chat.js#manejarRemovido); un 403 puntual no alcanza.
export class SpaceInaccesible extends Error {
  constructor(mensaje, codigo) {
    super(mensaje)
    this.codigo = codigo
  }
}

function traducirError(err) {
  const codigo = err.code || err.response?.status
  if (codigo === 403 || codigo === 404) {
    return new SpaceInaccesible(err.errors?.[0]?.message || err.message, codigo)
  }
  return err
}

// `cuerpo` es { text } o { cardsV2 }, tal como los arma chat-cards.js.
export async function postearEnSpace(space, cuerpo) {
  const chat = await getChat()
  try {
    const { data } = await chat.spaces.messages.create({ parent: space, requestBody: cuerpo })
    return data
  } catch (err) {
    throw traducirError(err)
  }
}

// Nombre visible de cada Space (el que se ve en Chat). Un Space que no se puede
// leer (sacaron la app, Chat tarda) simplemente no aparece en el resultado: quien
// llama muestra el codigo en su lugar. Se guarda 10 minutos para no repetir la
// consulta en cada /spaces, y la espera total esta acotada porque Chat corta a
// los 30 s.
const cacheNombres = new Map()
const VIDA_NOMBRES_MS = 10 * 60 * 1000

export async function nombresDeSpaces(spaces, { esperaMaxMs = 8000, ahora = Date.now() } = {}) {
  const nombres = new Map()
  const pendientes = []
  for (const space of new Set(spaces)) {
    const guardado = cacheNombres.get(space)
    if (guardado && ahora - guardado.en < VIDA_NOMBRES_MS) nombres.set(space, guardado.nombre)
    else pendientes.push(space)
  }
  if (!pendientes.length) return nombres
  const chat = await getChat()
  const pedir = Promise.allSettled(pendientes.map(async (space) => {
    const { data } = await chat.spaces.get({ name: space })
    if (data?.displayName) {
      cacheNombres.set(space, { nombre: data.displayName, en: ahora })
      nombres.set(space, data.displayName)
    }
  }))
  await Promise.race([pedir, new Promise((resolver) => setTimeout(resolver, esperaMaxMs))])
  return nombres
}

// Reemplaza el mensaje en su lugar (la card se actualiza donde esta, en vez de
// apilar uno nuevo por cada click).
export async function actualizarMensaje(name, cuerpo) {
  const chat = await getChat()
  const campos = Object.keys(cuerpo).join(',')
  try {
    const { data } = await chat.spaces.messages.update({ name, updateMask: campos, requestBody: cuerpo })
    return data
  } catch (err) {
    throw traducirError(err)
  }
}

// La conversacion privada entre la persona y la app, o null si no existe.
// `chatUserName` es `users/<id>`: con la cuenta de la app, Chat NO acepta el
// email como alias (probado: 403 "Service account authentication doesn't
// support ... email aliases"), asi que hace falta el id.
export async function buscarMensajeDirecto(chatUserName) {
  const chat = await getChat()
  try {
    const { data } = await chat.spaces.findDirectMessage({ name: chatUserName })
    return data?.name || null
  } catch (err) {
    const codigo = err.code || err.response?.status
    if (codigo === 404) return null
    throw err
  }
}

// Si el Directory ya contesto que no tiene permiso, no se vuelve a preguntar
// en esta instancia del servicio: hoy admin.directory.user.readonly NO esta
// autorizado (401 unauthorized_client) y cada intento seria una llamada perdida.
// Cuando se autorice, alcanza con que el servicio arranque de nuevo.
let directorySinPermiso = false

// `users/<id>` de una persona para escribirle en privado. Primero el que quedo
// guardado cuando uso la app; si no hay, el Directory (que devuelve el mismo
// id). null = hoy no se le puede escribir.
// `soloLectura`: no escribe el id en la base (la simulacion AVISO_DRY_RUN no
// tiene que dejar rastro).
export async function idDeChatPorEmail({ db, email, log = console, soloLectura = false }) {
  const limpio = String(email || '').toLowerCase().trim()
  if (!limpio) return null
  const guardado = await db.extUser.findFirst({
    where: { email: { equals: limpio, mode: 'insensitive' }, chat_user_name: { not: null } },
    select: { chat_user_name: true }
  })
  if (guardado?.chat_user_name) return guardado.chat_user_name
  if (directorySinPermiso) return null

  try {
    const { getDirectoryUsuarios } = await import('./directory-auth.js')
    const directory = await getDirectoryUsuarios()
    const { data } = await directory.users.get({ userKey: limpio, fields: 'id' })
    if (!data?.id) return null
    const chatUserName = `users/${data.id}`
    if (!soloLectura) {
      await db.extUser
        .updateMany({ where: { email: { equals: limpio, mode: 'insensitive' } }, data: { chat_user_name: chatUserName } })
        .catch(() => {})
    }
    return chatUserName
  } catch (err) {
    const codigo = err.code || err.response?.status
    if (codigo === 401 || codigo === 403 || /unauthorized_client/.test(err.message || '')) {
      directorySinPermiso = true
      log.info?.('chat: el Directory no tiene permiso de lectura de usuarios; los avisos privados salen solo para quien ya uso la app')
    } else if (codigo !== 404) {
      log.warn?.({ err: err.message }, 'chat: no se pudo resolver el id de Chat')
    }
    return null
  }
}

// El email de quien clickea viene en el payload de interaccion, pero NO esta
// documentado en el recurso REST User, asi que no se puede depender de el.
// Cuando falta, `users/<id>` es el id de Directory y se resuelve por ahi.
//
// Requiere admin.directory.user.readonly en directory-auth.js; si eso falla,
// devuelve null y el receptor rechaza el click en vez de asumir una identidad.
export async function resolverEmail({ user, db, log = console }) {
  const chatUserName = user?.name || null
  const emailDirecto = user?.email ? String(user.email).toLowerCase().trim() : null

  if (emailDirecto) {
    // Se cachea la identidad de Chat para no depender del campo no documentado
    // la proxima vez. `updateMany` y no `update`: si la persona no esta en
    // ExtUser todavia, no hay nada que cachear y no debe tirar.
    if (chatUserName) {
      await db.extUser
        .updateMany({ where: { email: emailDirecto }, data: { chat_user_name: chatUserName } })
        .catch((err) => log.warn?.({ err: err.message }, 'no se pudo cachear chat_user_name'))
    }
    return emailDirecto
  }

  if (!chatUserName) return null

  const cacheado = await db.extUser.findUnique({ where: { chat_user_name: chatUserName } })
  if (cacheado) return cacheado.email

  try {
    const { getDirectoryUsuarios } = await import('./directory-auth.js')
    const directory = await getDirectoryUsuarios()
    const idDirectory = chatUserName.split('/').pop()
    const { data } = await directory.users.get({ userKey: idDirectory })
    const email = String(data.primaryEmail || '').toLowerCase().trim()
    if (!email) return null
    await db.extUser
      .updateMany({ where: { email }, data: { chat_user_name: chatUserName } })
      .catch(() => {})
    return email
  } catch (err) {
    log.warn?.({ err: err.message, chatUserName }, 'no se pudo resolver el email de Chat')
    return null
  }
}
