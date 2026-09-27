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
import { resolverEmail, postearEnSpace, actualizarMensaje } from '../lib/chat.js'
import { responderPregunta } from '../lib/gemini-buscar.js'
import { repositoriosVisibles } from '../lib/repositorios.js'
import {
  cardVincular,
  dialogoAsignar,
  dialogoPasar,
  dialogoApuntar,
  dialogoTildar,
  dialogoPago,
  dialogoTildarPagos,
  dialogoVincular,
  cerrarDialogo,
  ACCION_MARCAR,
  ACCION_VINCULAR,
  ACCION_ASIGNAR_SUBMIT,
  ACCION_PASAR_SUBMIT,
  ACCION_NOTA_SUBMIT,
  ACCION_TILDAR_SUBMIT,
  ACCION_PAGO_SUBMIT,
  ACCION_TILDARPAGOS_SUBMIT,
  ACCION_VINCULAR_SUBMIT,
  CAMPO_TAREA,
  CAMPO_PERSONA,
  CAMPO_NOTA_TEXTO,
  CAMPO_TAREAS,
  CAMPO_PAGO,
  CAMPO_TAREA_PAGO,
  CAMPO_PAGOS,
  CAMPO_DEPARTAMENTOS_VINCULAR,
  CAMPO_ACCION
} from '../lib/chat-cards.js'
import { marcarInstanciaYPropagar } from '../lib/marcar-instancia.js'
import { prerrequisitosPendientes } from '../lib/dependencias.js'
import { esAdminGlobal, conPermisos } from '../lib/permisos.js'
import { asegurarMembresiasFrescas, usuarioPorEmail, motivoSinAcceso } from '../lib/membresias.js'
import { construirTarjetaDepartamento, conNotaSuperior } from '../lib/chat-recordatorio.js'
import {
  ejecutarComando,
  resolverComando,
  argumentoDeComando,
  pendientesParaAsignar,
  pendientesParaTildar,
  tomarPorInstanceId,
  pasarPorInstanceId,
  notaPorInstanceId,
  marcarVarias,
  personasActivas,
  puedeOperarEnChat,
  departamentosDelSpace,
  departamentosParaVincular,
  vincularDepartamentos,
  pagosParaVincular,
  vincularPago,
  pendientesParaTildarPagos,
  marcarPagos,
  COMANDO_ASIGNAR,
  COMANDO_DERIVAR,
  COMANDO_APUNTAR,
  COMANDO_TILDAR,
  COMANDO_VINCULAR,
  COMANDO_PAGO,
  COMANDO_TILDARPAGOS,
  COMANDO_BUSCAR,
  ambitoDelSpace
} from '../lib/chat-comandos.js'

// Las dos acciones que devuelve este framework (ver
// hostAppDataAction.chatDataAction en la doc de Workspace Add-ons): crear
// pisa nada, actualizar reemplaza el mensaje sobre el que se clickeo.
// Chat rechaza el mensaje COMPLETO si el texto trae algo que parezca una
// etiqueta HTML desconocida. Paso de verdad: los ejemplos de la ayuda decian
// "/nota <tarea>: <texto>" y Chat contestaba
// "Can't post a reply. Verify the URL format.; invalidContent: <texto>",
// asi que el comando fallaba entero y en el Space solo se veia un error
// generico. La guarda escapa esos angulos en vez de confiar en que nadie
// vuelva a escribir un placeholder asi.
//
// No se tocan TODOS los `<`: Chat soporta <b>, <i>, <u>, <s> y <a href>, y el
// formato nativo (*negrita*, _cursiva_) sigue intacto porque no usa angulos.
//
// Se cambia a corchetes en vez de escapar a &lt;: no esta confirmado que Chat
// interprete entidades HTML, y si no lo hiciera el usuario veria "&lt;tarea&gt;"
// literal. Un corchete se ve bien siempre y ademas es la convencion habitual
// para un placeholder.
const ETIQUETAS_QUE_CHAT_ACEPTA = /^\/?(b|i|u|s|font|a)(\s|$)/i

export function escaparPseudoEtiquetas(texto) {
  if (typeof texto !== 'string') return texto
  return texto.replace(/<([^<>]*)>/g, (completo, dentro) =>
    ETIQUETAS_QUE_CHAT_ACEPTA.test(dentro) ? completo : `[${dentro}]`
  )
}

function mensajeNuevo(message) {
  const seguro = message?.text ? { ...message, text: escaparPseudoEtiquetas(message.text) } : message
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: seguro } } } }
}
function mensajeActualizado(message) {
  return { hostAppDataAction: { chatDataAction: { updateMessageAction: { message } } } }
}

// Rechazos de un CLICK (sin permiso, sin identificar, ya no aplica, etc.)
// salen privados: solo los ve quien clickeo, via privateMessageViewer del
// recurso Message de la Chat API -- ese campo no es especifico del bot
// clasico, es del recurso `message` en si, y `message` es lo mismo que se
// envuelve en createMessageAction aca, asi que aplica igual.
// `usuario.name` es el `users/<id>` que ya trae todo evento de Chat
// (chatEvent.user), asi que no hace falta haber resuelto el email todavia.
// Si por algun motivo no vino `usuario.name`, sale publico como fallback: es
// mejor que un click se pierda visible a que se pierda en silencio.
//
// Los rechazos de un COMANDO DE BARRA (/tomar, /pasar, etc.) siguen publicos
// a proposito -- decision explicita del usuario: un comando lo escribe una
// persona a la vista de todos, tiene sentido que la respuesta tambien lo sea.
function mensajePrivado(usuario, texto) {
  const base = { text: texto }
  if (usuario?.name) base.privateMessageViewer = { name: usuario.name }
  return mensajeNuevo(base)
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
    select: { id: true, nombre: true, slug: true },
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
  // El texto llega completo, con la barra incluida ("/atrasadas", "/derivar X
  // a Y") -- confirmado contra un comando real en produccion. Se pasa a
  // ejecutarComando porque el NOMBRE manda sobre el appCommandId: ese id lo
  // elige a mano quien configura la app y un numero cruzado hacia que /ayuda
  // contestara "Atrasadas".
  const texto = chatEvent.appCommandPayload?.message?.text || ''

  fastify.log.info({ comandoId, texto, space }, 'chat: comando recibido')

  const email = await resolverEmail({ user: usuario, db: fastify.db, log: fastify.log })
  if (!email) {
    return mensajeNuevo({ text: '⚠️ No pude identificarte. Entrá a la plataforma.' })
  }
  asegurarMembresiasFrescas(fastify)
  const extUser = await conPermisos(fastify.db, await usuarioPorEmail(fastify.db, email, { nombre: usuario?.displayName }))
  if (!extUser?.activo) {
    fastify.log.info({ email, existe: !!extUser }, 'chat: usuario sin acceso')
    return mensajeNuevo({ text: motivoSinAcceso(extUser, email) })
  }

  // /asignar, /derivar y /apuntar responden con un DIALOGO, no con un mensaje:
  // es una estructura distinta (action.navigations) y va sin el envoltorio de
  // chatDataAction. Los tres arrancan igual (misma lista de pendientes), asi
  // que comparten la resolucion -- solo cambia que card arma cada uno.
  const comando = resolverComando({ comandoId, texto })
  if (comando === COMANDO_ASIGNAR || comando === COMANDO_DERIVAR || comando === COMANDO_APUNTAR) {
    const { departamento, departamentos, pendientes, porFallback, modoTodo, error } = await pendientesParaAsignar(fastify, { space, extUser })
    if (error) return mensajeNuevo({ text: error })
    fastify.log.info(
      { comando, departamento: departamento.slug, pendientes: pendientes.length, porFallback, modoTodo },
      'chat: abriendo diálogo'
    )
    if (comando === COMANDO_ASIGNAR) return dialogoAsignar(pendientes, { departamento, departamentos, porFallback, modoTodo })
    if (comando === COMANDO_APUNTAR) return dialogoApuntar(pendientes, { departamento, departamentos, porFallback, modoTodo })
    const personas = await personasActivas(fastify)
    return dialogoPasar(pendientes, personas, { departamento, departamentos, porFallback, modoTodo })
  }

  // /tildar tambien es un dialogo, pero con su propia lista (ordenada por
  // atraso, no por fecha) y su propio resumen del dia -- por eso no comparte
  // el bloque de arriba con pendientesParaAsignar.
  if (comando === COMANDO_TILDAR) {
    const { departamento, departamentos, pendientes, porFallback, modoTodo, resumen, error } = await pendientesParaTildar(fastify, { space, extUser })
    if (error) return mensajeNuevo({ text: error })
    fastify.log.info(
      { departamento: departamento.slug, pendientes: pendientes.length, porFallback, modoTodo },
      'chat: abriendo diálogo (tildar)'
    )
    return dialogoTildar(pendientes, { departamento, departamentos, porFallback, modoTodo, resumen })
  }

  // /pago y /tildarpagos: un Pago no tiene departamento, asi que estos dos NO
  // pasan por resolverDepartamento -- van directo a lib/pagos.js (via
  // chat-comandos.js) por local o por el email de quien pregunta.
  if (comando === COMANDO_PAGO) {
    const { local, pendientes, tareas, personas, error } = await pagosParaVincular(fastify, { argumento: argumentoDeComando(texto) })
    if (error) return mensajeNuevo({ text: error })
    fastify.log.info({ local: local.nombre, pendientes: pendientes.length }, 'chat: abriendo diálogo (pago)')
    return dialogoPago(pendientes, tareas, personas, { local })
  }
  if (comando === COMANDO_TILDARPAGOS) {
    const pendientes = await pendientesParaTildarPagos(fastify, { email })
    fastify.log.info({ pendientes: pendientes.length }, 'chat: abriendo diálogo (tildarpagos)')
    return dialogoTildarPagos(pendientes)
  }

  // /vincular tambien es un dialogo (checkbox de departamentos), no un
  // comando de texto -- reemplaza al /vincular original y a /compartir +
  // /descompartir por completo (ver dialogoVincular/vincularDepartamentos).
  if (comando === COMANDO_VINCULAR) {
    const { departamentos, actuales, error } = await departamentosParaVincular(fastify, { space, extUser })
    if (error) return mensajeNuevo({ text: error })
    fastify.log.info({ space, departamentos: departamentos.length, actuales: actuales.size }, 'chat: abriendo diálogo (vincular)')
    return dialogoVincular(departamentos, { actuales })
  }

  // /buscar pregunta algo y Gemini responde anclado SOLO en los documentos
  // del ambito de este Space (general + los departamentos que cubra, ver
  // ambitoDelSpace). NO devuelve texto en la respuesta del webhook -- una
  // consulta a Gemini puede tardar mas que los ~30s que da Chat para
  // responder. Se postea un placeholder por afuera (misma API que usa el job
  // de avisos) y se actualiza en background al terminar -- mismo idioma
  // fire-and-forget que propagarEnBackground en marcar-instancia.js.
  if (comando === COMANDO_BUSCAR) {
    const pregunta = argumentoDeComando(texto)
    if (!pregunta) {
      return mensajeNuevo({ text: 'Escribí `/buscar` seguido de tu pregunta. Ejemplo: `/buscar cuál es la política de viáticos`' })
    }

    const { departamentos } = await ambitoDelSpace(fastify.db, { space, extUser })
    const repositorios = await repositoriosVisibles(fastify.db, departamentos.map((d) => d.id))
    const storeNames = repositorios.map((r) => r.gemini_file_search_store).filter(Boolean)
    if (!storeNames.length) {
      return mensajeNuevo({ text: 'No hay documentos cargados todavía para este Space. Pedile a un administrador que cargue algo desde la plataforma.' })
    }

    let mensaje
    try {
      mensaje = await postearEnSpace(space, { text: '🔎 Buscando…' })
    } catch (err) {
      fastify.log.error({ err: err.message }, 'chat: no se pudo postear el placeholder de /buscar')
      return mensajeNuevo({ text: '⚠️ No pude iniciar la búsqueda. Probá de nuevo.' })
    }

    responderPregunta(fastify, { pregunta, storeNames })
      .then((texto) => actualizarMensaje(mensaje.name, { text: texto }))
      .catch((err) => {
        fastify.log.error({ err: err.message }, 'chat: falló /buscar')
        return actualizarMensaje(mensaje.name, { text: '⚠️ No pude responder eso. Probá de nuevo.' })
      })
      .catch((err) => fastify.log.error({ err: err.message }, 'chat: no se pudo ni actualizar el placeholder de /buscar'))

    return {}
  }

  const respuesta = await ejecutarComando(fastify, { comandoId, texto, space, extUser, email })
  return mensajeNuevo({ text: respuesta })
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
  const usuario = chatEvent.user
  const params = normalizarParametros(common.parameters)

  // La accion viene en los PARAMETROS, no en invokedFunction.
  //
  // En este framework `action.function` es la URL del endpoint (ver
  // chat-cards.js), asi que no puede llevar el nombre de la accion. Y el
  // payload real de un click NO trae commonEventObject.invokedFunction --
  // verificado sobre el body crudo de un click que si llego. Antes se leia de
  // ahi, quedaba undefined, y el handler caia en un `return {}` que Chat
  // reportaba como "la respuesta no es valida": el sintoma que se investigo
  // durante toda la fase.
  //
  // Se deja invokedFunction como respaldo por si en algun evento si viniera.
  const funcion = params[CAMPO_ACCION] || common.invokedFunction

  const email = await resolverEmail({ user: usuario, db: fastify.db, log: fastify.log })
  if (!email) {
    return mensajePrivado(usuario, '⚠️ No pude identificarte. Entrá a la plataforma para marcar la tarea.')
  }

  asegurarMembresiasFrescas(fastify)
  const extUser = await conPermisos(fastify.db, await usuarioPorEmail(fastify.db, email, { nombre: usuario?.displayName }))
  if (!extUser?.activo) {
    fastify.log.info({ email, existe: !!extUser }, 'chat: usuario sin acceso')
    return mensajePrivado(usuario, motivoSinAcceso(extUser, email))
  }

  // El space de un click de boton viaje dentro del propio payload (mismo
  // patron que addedToSpacePayload/removedFromSpacePayload), no como
  // hermano de `user` -- confirmado por los otros dos eventos reales.
  const space = chatEvent.buttonClickedPayload?.space?.name || chatEvent.space?.name

  // Envio de un dialogo (/asignar, /derivar, /apuntar). Llega por este mismo
  // camino, con isDialogEvent/dialogEventType=SUBMIT_DIALOG, y los valores del
  // formulario en commonEventObject.formInputs.
  if (funcion === ACCION_ASIGNAR_SUBMIT) {
    const instanceId = leerCampoDelFormulario(common, CAMPO_TAREA)
    fastify.log.info(
      { instanceId, esDialogo: chatEvent.buttonClickedPayload?.isDialogEvent },
      'chat: envío de diálogo recibido (asignar)'
    )
    const texto = await tomarPorInstanceId(fastify, { space, extUser, email, instanceId })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_PASAR_SUBMIT) {
    const instanceId = leerCampoDelFormulario(common, CAMPO_TAREA)
    const emailDestino = leerCampoDelFormulario(common, CAMPO_PERSONA)
    fastify.log.info({ instanceId, emailDestino }, 'chat: envío de diálogo recibido (derivar)')
    const texto = await pasarPorInstanceId(fastify, { space, extUser, email, instanceId, emailDestino })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_NOTA_SUBMIT) {
    const instanceId = leerCampoDelFormulario(common, CAMPO_TAREA)
    const nota = leerCampoDelFormulario(common, CAMPO_NOTA_TEXTO)
    fastify.log.info({ instanceId }, 'chat: envío de diálogo recibido (apuntar)')
    const texto = await notaPorInstanceId(fastify, { space, extUser, email, instanceId, nota })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_TILDAR_SUBMIT) {
    const instanceIds = leerCampoMultipleDelFormulario(common, CAMPO_TAREAS)
    fastify.log.info({ cantidad: instanceIds.length }, 'chat: envío de diálogo recibido (tildar)')
    const texto = await marcarVarias(fastify, { space, extUser, email, instanceIds })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_PAGO_SUBMIT) {
    const idPago = leerCampoDelFormulario(common, CAMPO_PAGO)
    const idTarea = leerCampoDelFormulario(common, CAMPO_TAREA_PAGO)
    const asignadoA = leerCampoDelFormulario(common, CAMPO_PERSONA)
    fastify.log.info({ idPago, idTarea, asignadoA }, 'chat: envío de diálogo recibido (pago)')
    const texto = await vincularPago(fastify, { email, idPago, idTarea, asignadoA })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_TILDARPAGOS_SUBMIT) {
    const ids = leerCampoMultipleDelFormulario(common, CAMPO_PAGOS)
    fastify.log.info({ cantidad: ids.length }, 'chat: envío de diálogo recibido (tildarpagos)')
    const texto = await marcarPagos(fastify, { email, ids })
    return cerrarDialogo(texto)
  }
  if (funcion === ACCION_VINCULAR_SUBMIT) {
    const idsDepartamentos = leerCampoMultipleDelFormulario(common, CAMPO_DEPARTAMENTOS_VINCULAR)
    fastify.log.info({ cantidad: idsDepartamentos.length }, 'chat: envío de diálogo recibido (vincular)')
    const texto = await vincularDepartamentos(fastify, { space, extUser, idsDepartamentos })
    return cerrarDialogo(texto)
  }

  if (funcion === ACCION_VINCULAR) return vincular(fastify, space, { extUser, usuario, params })
  if (funcion === ACCION_MARCAR) return marcar(fastify, space, { extUser, email, usuario, params })
  return {}
}

// formInputs viene como { campo: { stringInputs: { value: [...] } } }.
function leerCampoDelFormulario(common, campo) {
  return common?.formInputs?.[campo]?.stringInputs?.value?.[0] || null
}

// El checkbox de /tildar puede volver con VARIOS values marcados -- a
// diferencia de leerCampoDelFormulario, aca no se toma solo el primero.
function leerCampoMultipleDelFormulario(common, campo) {
  return common?.formInputs?.[campo]?.stringInputs?.value || []
}

async function vincular(fastify, space, { extUser, usuario, params }) {
  if (!esAdminGlobal(extUser)) {
    return mensajePrivado(usuario, '⚠️ Solo un administrador puede vincular este Space a un departamento.')
  }
  const idDepartamento = params.idDepartamento
  if (!space || !idDepartamento) return {}

  const departamento = await fastify.db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento) return mensajePrivado(usuario, '⚠️ Ese departamento ya no existe.')

  const ocupado = await fastify.db.departamento.findUnique({ where: { chat_space_name: space } })
  if (ocupado) return mensajePrivado(usuario, `Este Space ya está vinculado a *${ocupado.nombre}*.`)

  await fastify.db.departamento.update({ where: { id: idDepartamento }, data: { chat_space_name: space } })
  fastify.log.info({ space, departamento: departamento.slug }, 'chat: space vinculado')

  return mensajeActualizado({
    text: `✅ Listo. Este Space queda vinculado a *${departamento.nombre}*: acá van a llegar los recordatorios diarios.`
  })
}

async function marcar(fastify, space, { extUser, email, usuario, params }) {
  // El departamento sale del SPACE, no de los parametros de la card: es el
  // unico dato de este request que el cliente no eligio. departamentosDelSpace
  // trae el dueño MAS los compartidos (/compartir) -- el primero es el dueño,
  // que es contra el que se marca la tarea (su calendario).
  const ambito = space ? await departamentosDelSpace(fastify.db, space) : []
  const departamento = ambito[0] ?? null
  if (!departamento?.id_calendar_google) {
    return mensajePrivado(usuario, '⚠️ Este Space no está vinculado a ningún departamento.')
  }

  // Un Space es semi-publico dentro de la organizacion: que alguien lo vea no
  // significa que pueda cerrar tareas de ese departamento. Excepto el Space de
  // Dirección, y los Spaces compartidos con /compartir: ahi el control de
  // acceso es la membresia del Space en si (ver puedeOperarEnChat), no
  // pertenecer puntualmente al departamento dueño.
  if (!puedeOperarEnChat(extUser, ambito)) {
    return mensajePrivado(usuario, `⚠️ No tenés permiso para marcar tareas de ${departamento.nombre}.`)
  }

  const instanceId = params.instanceId
  if (!instanceId) return mensajePrivado(usuario, '⚠️ No pude identificar la tarea.')

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
      // No hubo cambio de estado -- no vale la pena reconstruir la card por
      // esto, y tampoco es un aviso que le sirva a todo el Space.
      const quien = instancia?.extendedProperties?.private?.realizada_por
      return mensajePrivado(usuario, `✓ *${titulo}* ya estaba marcada${quien ? ` por ${quien}` : ''}.`)
    }

    const sufijo = avisos.length
      ? `\n⚠️ Ojo: todavía no ${avisos.length === 1 ? 'está hecha' : 'están hechas'} ` +
        avisos.map((a) => `*${a.nombre_tarea}* (${a.departamento})`).join(', ') + '.'
      : ''
    // Escapado igual que en mensajeNuevo: el titulo/email vienen de datos ya
    // cargados por un admin, no de un placeholder libre, pero no cuesta nada
    // aplicar la misma guarda para el widget de texto de la card.
    const nota = escaparPseudoEtiquetas(`✅ *${titulo}* marcada por ${email}.${sufijo}`)

    // Se actualiza la card EN SU LUGAR (misma tarjeta, no un mensaje nuevo):
    // el boton que se acaba de clickear ya no aplica -- la tarea esta hecha
    // -- asi que dejarlo invita a un segundo click sobre algo ya resuelto.
    // Si la reconstruccion fallara (Calendar caido, etc.), un mensaje de
    // texto simple es preferible a que el click entero termine en error.
    try {
      const tarjeta = await construirTarjetaDepartamento(fastify, departamento)
      return mensajeActualizado(conNotaSuperior(tarjeta, nota))
    } catch (err) {
      fastify.log.error({ err: err.message, instanceId }, 'chat: no se pudo reconstruir la tarjeta')
      return mensajeNuevo({ text: nota })
    }
  } catch (err) {
    fastify.log.error({ err: err.message, instanceId }, 'chat: fallo el marcado')
    return mensajePrivado(usuario, '⚠️ No pude marcarla. Probá desde la plataforma.')
  }
}
