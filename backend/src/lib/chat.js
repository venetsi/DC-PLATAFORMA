// Cliente de Google Chat: postear en un Space y resolver la identidad de quien
// clickea. Sin logica de negocio -- eso vive en routes/chat.js y en el job.
import { getChat } from './chat-auth.js'

// Un 403/404 al postear casi siempre significa que sacaron la app del Space
// (o que el Space se borro). Reintentar eso es tirar cuota al vacio, asi que
// se distingue del resto de los errores para poder limpiar la vinculacion.
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
