// Endpoint que recibe los eventos de Google Chat: la app agregada a un Space,
// y los clicks en los botones de las cards.
//
// Publico por fuerza (Chat no puede mandar nuestro JWT), asi que la unica
// barrera es el token firmado por Google -- ver chat-verificar.js, que es
// fail-closed. Todo lo que llega despues de esa verificacion sigue siendo
// dato del cliente: los `parameters` de una card se re-verifican contra la
// base, nunca se usan para decidir permisos.
import { verificarPeticionDeChat, ChatNoConfigurado, ChatTokenInvalido } from '../lib/chat-verificar.js'
import { resolverEmail } from '../lib/chat.js'
import { cardVincular, ACCION_MARCAR, ACCION_VINCULAR } from '../lib/chat-cards.js'
import { marcarInstanciaYPropagar } from '../lib/marcar-instancia.js'
import { prerrequisitosPendientes } from '../lib/dependencias.js'
import { esAdminGlobal, puedeGestionarDepartamento } from '../lib/permisos.js'

// Chat soporta mensajes privados dentro de un Space: es lo que corresponde
// para un rechazo o un error, que no le interesan al resto del equipo.
function privado(usuario, texto) {
  return { actionResponse: { type: 'NEW_MESSAGE' }, privateMessageViewer: usuario, text: texto }
}

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
export async function manejarEvento(fastify, evento) {
  switch (evento.type) {
    case 'ADDED_TO_SPACE':
      return manejarAgregado(fastify, evento)
    case 'REMOVED_FROM_SPACE':
      return manejarRemovido(fastify, evento)
    case 'CARD_CLICKED':
      return manejarClick(fastify, evento)
    case 'MESSAGE':
      return { text: 'Te aviso todas las mañanas con las tareas del departamento. Para el detalle completo, entrá a la plataforma.' }
    default:
      return {}
  }
}

// La app entra a un Space -> ofrecer vincularlo a un departamento. Esto
// reemplaza cargar chat_space_name por SQL a mano: el admin crea el Space,
// agrega el Group depto-<slug>@ y la app, y elige de una lista.
async function manejarAgregado(fastify, evento) {
  const space = evento.space?.name
  if (!space) return {}

  const yaVinculado = await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
  if (yaVinculado) {
    return { text: `👋 Este Space ya está vinculado a *${yaVinculado.nombre}*.` }
  }

  const disponibles = await fastify.db.departamento.findMany({
    where: { activo: true, chat_space_name: null },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' }
  })
  return cardVincular(disponibles)
}

// Sacaron la app del Space: la vinculacion queda muerta y hay que limpiarla,
// o el job seguiria intentando postear ahi todos los dias contra un 403.
async function manejarRemovido(fastify, evento) {
  const space = evento.space?.name
  if (!space) return {}
  const { count } = await fastify.db.departamento.updateMany({
    where: { chat_space_name: space },
    data: { chat_space_name: null }
  })
  if (count) fastify.log.info({ space }, 'chat: space desvinculado al sacar la app')
  return {}
}

async function manejarClick(fastify, evento) {
  const funcion = evento.action?.actionMethodName || evento.common?.invokedFunction
  const usuario = evento.user

  const email = await resolverEmail({ user: usuario, db: fastify.db, log: fastify.log })
  if (!email) {
    return privado(usuario, '⚠️ No pude identificarte. Entrá a la plataforma para marcar la tarea.')
  }

  const extUser = await fastify.db.extUser.findUnique({ where: { email } })
  if (!extUser?.activo) {
    return privado(usuario, '⚠️ Tu usuario no está activo en la plataforma.')
  }

  // Los parametros vienen del cliente. Se leen, pero nada de lo que decidan
  // permisos sale de aca -- el departamento se resuelve por el Space.
  const params = Object.fromEntries(
    (evento.common?.parameters ? Object.entries(evento.common.parameters) : []).map(([k, v]) => [k, v])
  )

  if (funcion === ACCION_VINCULAR) return vincular(fastify, evento, { extUser, usuario, params })
  if (funcion === ACCION_MARCAR) return marcar(fastify, evento, { extUser, email, usuario, params })
  return {}
}

async function vincular(fastify, evento, { extUser, usuario, params }) {
  if (!esAdminGlobal(extUser)) {
    return privado(usuario, '⚠️ Solo un administrador puede vincular este Space a un departamento.')
  }
  const space = evento.space?.name
  const idDepartamento = params.idDepartamento
  if (!space || !idDepartamento) return {}

  const departamento = await fastify.db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento) return privado(usuario, '⚠️ Ese departamento ya no existe.')

  const ocupado = await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
  if (ocupado) return { text: `Este Space ya está vinculado a *${ocupado.nombre}*.` }

  await fastify.db.departamento.update({ where: { id: idDepartamento }, data: { chat_space_name: space } })
  fastify.log.info({ space, departamento: departamento.slug }, 'chat: space vinculado')

  return {
    actionResponse: { type: 'UPDATE_MESSAGE' },
    text: `✅ Listo. Este Space queda vinculado a *${departamento.nombre}*: acá van a llegar los recordatorios diarios.`
  }
}

async function marcar(fastify, evento, { extUser, email, usuario, params }) {
  const space = evento.space?.name
  // El departamento sale del SPACE, no de los parametros de la card: es el
  // unico dato de este request que el cliente no eligio.
  const departamento = space
    ? await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
    : null
  if (!departamento?.id_calendar_google) {
    return privado(usuario, '⚠️ Este Space no está vinculado a ningún departamento.')
  }

  // Un Space es semi-publico dentro de la organizacion: que alguien lo vea no
  // significa que pueda cerrar tareas de ese departamento.
  if (!puedeGestionarDepartamento(extUser, departamento.id)) {
    return privado(usuario, `⚠️ No tenés permiso para marcar tareas de ${departamento.nombre}.`)
  }

  const instanceId = params.instanceId
  if (!instanceId) return privado(usuario, '⚠️ No pude identificar la tarea.')

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
      return privado(usuario, `✓ *${titulo}* ya estaba marcada${quien ? ` por ${quien}` : ''}.`)
    }

    const sufijo = avisos.length
      ? `\n⚠️ Ojo: todavía no ${avisos.length === 1 ? 'está hecha' : 'están hechas'} ` +
        avisos.map((a) => `*${a.nombre_tarea}* (${a.departamento})`).join(', ') + '.'
      : ''
    return { text: `✅ *${titulo}* marcada por ${email}.${sufijo}` }
  } catch (err) {
    fastify.log.error({ err: err.message, instanceId }, 'chat: fallo el marcado')
    return privado(usuario, '⚠️ No pude marcarla. Probá desde la plataforma.')
  }
}
