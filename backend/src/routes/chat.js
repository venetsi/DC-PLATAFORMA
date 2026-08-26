// Endpoint que recibe los eventos de Google Chat: la app agregada a un Space,
// y los clicks en los botones de las cards.
//
// Publico por fuerza (Chat no puede mandar nuestro JWT), asi que la unica
// barrera es el token firmado por Google -- ver chat-verificar.js, que es
// fail-closed. Todo lo que llega despues de esa verificacion sigue siendo
// dato del cliente: los `parameters` de una card se re-verifican contra la
// base, nunca se usan para decidir permisos.
//
// FORMATO DEL EVENTO: la app quedo publicada via Google Workspace Marketplace
// SDK (necesario para que apareciera al buscarla en Chat -- ver
// docs/CONFIGURAR-CHAT-APP.md), asi que Google entrega el "common event
// object" de Workspace Add-ons, NO el formato clasico simple {type, space,
// user} de un Chat bot standalone. Confirmado contra logs reales de
// produccion (2026-08-25), no por documentacion sola:
//   { commonEventObject: { hostApp, platform, invokedFunction?, parameters? },
//     authorizationEventObject: { systemIdToken },
//     chat: { user, eventTime, addedToSpacePayload?: { space },
//              removedFromSpacePayload?: { space }, buttonClickedPayload?,
//              messagePayload? } }
// El tipo de evento se infiere por CUAL de esas claves de payload esta
// presente -- no hay un campo "type" directo.
import { verificarPeticionDeChat, ChatNoConfigurado, ChatTokenInvalido } from '../lib/chat-verificar.js'
import { resolverEmail } from '../lib/chat.js'
import { cardVincular, ACCION_MARCAR, ACCION_VINCULAR } from '../lib/chat-cards.js'
import { marcarInstanciaYPropagar } from '../lib/marcar-instancia.js'
import { prerrequisitosPendientes } from '../lib/dependencias.js'
import { esAdminGlobal, puedeGestionarDepartamento } from '../lib/permisos.js'
import { ejecutarComando } from '../lib/chat-comandos.js'

// Las dos acciones que devuelve este framework (ver
// hostAppDataAction.chatDataAction en la doc de Workspace Add-ons): crear
// pisa nada, actualizar reemplaza el mensaje sobre el que se clickeo.
function mensajeNuevo(message) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message } } } }
}
function mensajeActualizado(message) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: { message } } } }
}

// TODO: los rechazos (sin permiso, sin identificar, etc.) quedaban antes como
// mensaje PRIVADO (solo lo veia quien clickeaba, via privateMessageViewer).
// Ese campo es del formato clasico de Chat bot; en el formato de Workspace
// Add-ons no se encontro su equivalente documentado. Por ahora estos mensajes
// salen visibles para todo el Space -- no es grave (no exponen datos
// sensibles, son avisos de "no tenes permiso"/"no pude identificarte"), pero
// es mas ruido del que hacia falta. Retomar cuando aparezca la doc.

export default async function chatRoutes(fastify) {
  fastify.post('/eventos', async (request, reply) => {
    try {
      await verificarPeticionDeChat(request)
    } catch (err) {
      if (err instanceof ChatNoConfigurado) {
        fastify.log.error({ err: err.message }, 'chat: falta CHAT_AUDIENCE')
        return reply.code(503).send({ error: 'Integración de Chat no configurada' })
      }
      if (err instanceof ChatTokenInvalido) {
        fastify.log.warn({ err: err.message }, 'chat: token rechazado')
        return reply.code(401).send({ error: 'No autorizado' })
      }
      throw err
    }

    return manejarEvento(fastify, request.body || {})
  })
}

// Despacho separado del handler HTTP a proposito: asi la logica (vincular,
// marcar, permisos) se puede ejercitar con payloads sinteticos sin tener que
// abrir un bypass en la verificacion del token, que es lo unico que protege
// este endpoint. Mismo criterio que marcar-instancia.js.
//
// `body` es el request body COMPLETO (con commonEventObject/chat), no solo
// el sub-objeto `chat` -- las dos partes hacen falta (una trae el evento en
// si, la otra trae invokedFunction/parameters de los clicks).
export async function manejarEvento(fastify, body) {
  const chatEvent = body.chat || {}
  const common = body.commonEventObject || {}

  // Diagnostico temporal para el caso de click en boton, que todavia no se
  // probo contra produccion -- sacar despues de confirmar el shape real de
  // buttonClickedPayload y de common.parameters.
  if (chatEvent.buttonClickedPayload) {
    fastify.log.info({ bodyCrudo: JSON.stringify(body).slice(0, 2000) }, 'chat: click recibido (diagnostico)')
  }

  if (chatEvent.addedToSpacePayload) return manejarAgregado(fastify, chatEvent.addedToSpacePayload)
  if (chatEvent.removedFromSpacePayload) return manejarRemovido(fastify, chatEvent.removedFromSpacePayload)
  if (chatEvent.appCommandPayload) return manejarComando(fastify, chatEvent)
  if (chatEvent.buttonClickedPayload) return manejarClick(fastify, chatEvent, common)
  if (chatEvent.messagePayload) {
    return mensajeNuevo({
      text: 'Te aviso todas las mañanas con las tareas del departamento. Para el detalle completo, entrá a la plataforma.'
    })
  }
  return {}
}

// La app entra a un Space -> ofrecer vincularlo a un departamento. Esto
// reemplaza cargar chat_space_name por SQL a mano: el admin crea el Space,
// agrega el Group depto-<slug>@ y la app, y elige de una lista.
async function manejarAgregado(fastify, payload) {
  const space = payload.space?.name
  if (!space) {
    fastify.log.warn({ payload }, 'chat: ADDED_TO_SPACE sin space.name')
    return {}
  }

  const yaVinculado = await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
  if (yaVinculado) {
    return mensajeNuevo({ text: `👋 Este Space ya está vinculado a *${yaVinculado.nombre}*.` })
  }

  const disponibles = await fastify.db.departamento.findMany({
    where: { activo: true, chat_space_name: null },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' }
  })
  fastify.log.info({ space, disponibles: disponibles.length }, 'chat: enviando tarjeta de vinculación')
  return mensajeNuevo(cardVincular(disponibles))
}

// Sacaron la app del Space: la vinculacion queda muerta y hay que limpiarla,
// o el job seguiria intentando postear ahi todos los dias contra un 403.
async function manejarRemovido(fastify, payload) {
  const space = payload.space?.name
  if (!space) return {}
  const { count } = await fastify.db.departamento.updateMany({
    where: { chat_space_name: space },
    data: { chat_space_name: null }
  })
  if (count) fastify.log.info({ space }, 'chat: space desvinculado al sacar la app')
  return {}
}

// Comando de barra (/hoy, /atrasadas, /mias, /ayuda). Camino independiente del
// de los botones: llega como appCommandPayload, no como buttonClickedPayload.
async function manejarComando(fastify, chatEvent) {
  const comandoId = chatEvent.appCommandPayload?.appCommandMetadata?.appCommandId
  const usuario = chatEvent.user
  const space = chatEvent.appCommandPayload?.space?.name || chatEvent.space?.name

  // Se loguea el payload del comando entero a proposito: hace falta confirmar
  // COMO llega el argumento (el texto despues de "/derivar X a Y") antes de
  // construir un comando que lo use -- no esta documentado, igual que el resto
  // del shape de este framework. Sacar cuando quede confirmado.
  fastify.log.info(
    { comandoId, space, payloadCrudo: JSON.stringify(chatEvent.appCommandPayload || {}).slice(0, 1200) },
    'chat: comando recibido'
  )

  const email = await resolverEmail({ user: usuario, db: fastify.db, log: fastify.log })
  if (!email) {
    return mensajeNuevo({ text: '⚠️ No pude identificarte. Entrá a la plataforma.' })
  }
  const extUser = await fastify.db.extUser.findUnique({ where: { email } })
  if (!extUser?.activo) {
    return mensajeNuevo({ text: '⚠️ Tu usuario no está activo en la plataforma.' })
  }

  const texto = await ejecutarComando(fastify, { comandoId, space, extUser, email })
  return mensajeNuevo({ text: texto })
}

// `common.parameters` viene de Action.setParameters -- en la doc de Apps
// Script llega como mapa plano {clave: valor}, pero se normaliza tambien el
// caso de array [{key,value}] por si este framework lo entrega asi (no hay
// confirmacion 100% de un click real todavia, ver el log de diagnostico).
function normalizarParametros(parametros) {
  if (!parametros) return {}
  if (Array.isArray(parametros)) {
    return Object.fromEntries(parametros.map((p) => [p.key, p.value]))
  }
  return parametros
}

async function manejarClick(fastify, chatEvent, common) {
  const funcion = common.invokedFunction
  const usuario = chatEvent.user
  const params = normalizarParametros(common.parameters)

  const email = await resolverEmail({ user: usuario, db: fastify.db, log: fastify.log })
  if (!email) {
    return mensajeNuevo({ text: '⚠️ No pude identificarte. Entrá a la plataforma para marcar la tarea.' })
  }

  const extUser = await fastify.db.extUser.findUnique({ where: { email } })
  if (!extUser?.activo) {
    return mensajeNuevo({ text: '⚠️ Tu usuario no está activo en la plataforma.' })
  }

  // El space de un click de boton viaje dentro del propio payload (mismo
  // patron que addedToSpacePayload/removedFromSpacePayload), no como
  // hermano de `user` -- confirmado por los otros dos eventos reales.
  const space = chatEvent.buttonClickedPayload?.space?.name || chatEvent.space?.name

  if (funcion === ACCION_VINCULAR) return vincular(fastify, space, { extUser, usuario, params })
  if (funcion === ACCION_MARCAR) return marcar(fastify, space, { extUser, email, usuario, params })
  return {}
}

async function vincular(fastify, space, { extUser, params }) {
  if (!esAdminGlobal(extUser)) {
    return mensajeNuevo({ text: '⚠️ Solo un administrador puede vincular este Space a un departamento.' })
  }
  const idDepartamento = params.idDepartamento
  if (!space || !idDepartamento) return {}

  const departamento = await fastify.db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento) return mensajeNuevo({ text: '⚠️ Ese departamento ya no existe.' })

  const ocupado = await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
  if (ocupado) return mensajeNuevo({ text: `Este Space ya está vinculado a *${ocupado.nombre}*.` })

  await fastify.db.departamento.update({ where: { id: idDepartamento }, data: { chat_space_name: space } })
  fastify.log.info({ space, departamento: departamento.slug }, 'chat: space vinculado')

  return mensajeActualizado({
    text: `✅ Listo. Este Space queda vinculado a *${departamento.nombre}*: acá van a llegar los recordatorios diarios.`
  })
}

async function marcar(fastify, space, { extUser, email, params }) {
  // El departamento sale del SPACE, no de los parametros de la card: es el
  // unico dato de este request que el cliente no eligio.
  const departamento = space
    ? await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
    : null
  if (!departamento?.id_calendar_google) {
    return mensajeNuevo({ text: '⚠️ Este Space no está vinculado a ningún departamento.' })
  }

  // Un Space es semi-publico dentro de la organizacion: que alguien lo vea no
  // significa que pueda cerrar tareas de ese departamento.
  if (!puedeGestionarDepartamento(extUser, departamento.id)) {
    return mensajeNuevo({ text: `⚠️ No tenés permiso para marcar tareas de ${departamento.nombre}.` })
  }

  const instanceId = params.instanceId
  if (!instanceId) return mensajeNuevo({ text: '⚠️ No pude identificar la tarea.' })

  try {
    const { evento: instancia, yaEstaba, avisos } = await marcarInstanciaYPropagar(fastify, {
      calendarId: departamento.id_calendar_google,
      instanceId,
      emailUsuario: email,
      evaluarAvisos: ({ idAsignacion, fechaISO }) =>
        prerrequisitosPendientes(fastify, { idAsignacion, fechaISO }),
      // Chat corta a los 30 s y withBackoff puede dormir hasta 30 s solo ante
      // un 429: se responde apenas termina el marcado principal.
      propagarEnBackground: true
    })

    const titulo = instancia?.extendedProperties?.private?.nombre_tarea || instancia?.summary || 'La tarea'
    if (yaEstaba) {
      const quien = instancia?.extendedProperties?.private?.realizada_por
      return mensajeNuevo({ text: `✓ *${titulo}* ya estaba marcada${quien ? ` por ${quien}` : ''}.` })
    }

    const sufijo = avisos.length
      ? `\n⚠️ Ojo: todavía no ${avisos.length === 1 ? 'está hecha' : 'están hechas'} ` +
        avisos.map((a) => `*${a.nombre_tarea}* (${a.departamento})`).join(', ') + '.'
      : ''
    return mensajeNuevo({ text: `✅ *${titulo}* marcada por ${email}.${sufijo}` })
  } catch (err) {
    fastify.log.error({ err: err.message, instanceId }, 'chat: fallo el marcado')
    return mensajeNuevo({ text: '⚠️ No pude marcarla. Probá desde la plataforma.' })
  }
}
