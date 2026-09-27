// Comandos de barra (/hoy, /atrasadas, /mias) para operar la agenda desde Chat.
//
// IMPORTANTE: un comando llega como `chat.appCommandPayload`, que es un
// mecanismo DISTINTO del click en el boton de una card
// (`chat.buttonClickedPayload`). Vale la pena saberlo porque al momento de
// escribir esto los clicks de botones no llegaban al endpoint y los comandos
// son un camino independiente -- si uno anda y el otro no, el problema esta en
// el ruteo de acciones de cards, no en la app.
//
// Los IDs son numericos y los asigna QUIEN CONFIGURA la app en la consola de
// Chat API (seccion "Comandos"): hay que usar los mismos numeros de aca.
import { hoyEnArgentina, clasificarInstancia, diasHabilesVencida, estaHecha } from './vencimiento.js'
import { lineaDeTarea } from './mensajes-chat.js'
import { esAdminGlobal, puede, conPermisos, departamentosDe } from './permisos.js'
import { SLUG_DIRECCION } from './direccion.js'
import { marcarInstanciaYPropagar } from './marcar-instancia.js'
import { prerrequisitosPendientes } from './dependencias.js'
import { pagosRecientesDeLocal, pagoPorId, formatearMonto } from './pagos.js'

// Minusculas y sin acentos, para comparar lo que alguien escribio a mano
// ("/Mías", "Auditoría") contra un slug. Un solo lugar para no repetir el
// rango de diacriticos en cada comparacion.
function sinAcentos(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

// Mismo criterio que routes/instancias.js: los emails se comparan siempre en
// minusculas (el ticket SSO puede traerlos con mayusculas).
function normalizarEmail(email) {
  return String(email || '').toLowerCase().trim()
}

// IDs "canonicos", que se usan solo como fallback: lo que manda es el NOMBRE
// del comando, que viene en el texto del mensaje. Se prioriza el nombre porque
// el ID lo elige a mano quien configura la app en la consola, y un numero mal
// puesto hacia que /ayuda contestara "Atrasadas" -- paso de verdad.
export const COMANDO_HOY = 1
export const COMANDO_ATRASADAS = 2
export const COMANDO_MIAS = 3
export const COMANDO_AYUDA = 4
// /vincular abre un DIALOGO (checkbox) para elegir que departamentos cubre
// este Space -- no un argumento de texto. Reusa el MISMO comando para el
// primer vinculo y para agregar/sacar compartidos despues (decision explicita
// del usuario 2026-08-27: un solo comando, no /vincular + /compartir +
// /descompartir por separado). Requiere reconfigurar el comando #5 en la
// consola de Chat de "barra" a "barra + Diálogo" -- ver CONFIGURAR-CHAT-APP.md.
export const COMANDO_VINCULAR = 5
export const COMANDO_DESVINCULAR = 6
export const COMANDO_TOMAR = 7
export const COMANDO_PASAR = 8
export const COMANDO_NOTA = 9
// /asignar abre un DIALOGO (formulario modal) para elegir la tarea de una lista
// en vez de escribir su nombre. FUNCIONA: el envio del formulario llega como
// buttonClickedPayload con formInputs -- verificado en produccion 2026-08-26,
// una vez corregido que action.function tiene que ser la URL del endpoint.
export const COMANDO_ASIGNAR = 10

// /derivar y /apuntar son la version en dialogo de /pasar y /nota: eligen la
// tarea (y la persona, o escriben la nota) de un formulario en vez de texto.
// Comandos NUEVOS a proposito -- no se reconfiguro /pasar ni /nota como
// "barra + Dialogo" para no arriesgar el comando de barra ya probado en
// produccion (no esta confirmado que siga aceptando texto plano una vez
// reconfigurado asi).
export const COMANDO_DERIVAR = 16
export const COMANDO_APUNTAR = 17

// Marca una tarea como hecha por texto, sin pasar por el boton de la tarjeta
// del recordatorio -- ese boton solo existe si la tarea aparece en el aviso
// del dia, y /tomar, /pasar y /nota deliberadamente NO marcan nada (ver sus
// comentarios). Reusa marcarInstanciaYPropagar, el mismo helper del click de
// boton: mismo chequeo de "ya estaba", misma propagacion a departamentos
// compartidos, mismos avisos de prerrequisito pendiente.
export const COMANDO_MARCAR = 18

// Version en dialogo de /marcar, pero de VARIAS de una: un checkbox por tarea
// (no un radio button como /asignar, /derivar, /apuntar) ordenadas por
// atraso, con el semaforo del dia arriba -- mismo criterio que el kiosko
// (routes/tv.js#estado_general). Comando nuevo, mismo motivo que /derivar y
// /apuntar: no arriesgar /marcar, que ya esta probado en produccion.
export const COMANDO_TILDAR = 19

// Seguimiento de Pagos de dcsmart -- DELIBERADAMENTE fuera del modelo
// Tarea/TareaAsignacion/Calendar (ver PagoSeguimiento en schema.prisma: un
// pago es un registro de una sola vez de otro sistema, no algo que recurra).
// Por eso NO pasan por resolverDepartamento/modoTodo como el resto de los
// comandos de este archivo -- un Pago no tiene departamento, solo local.
export const COMANDO_PAGO = 20 // dialogo: vincular un pago a una tarea y/o persona
export const COMANDO_MISPAGOS = 21 // texto: mis pagos con seguimiento pendiente
export const COMANDO_TILDARPAGOS = 22 // dialogo: marcar varios como resueltos

// Comandos de status. Los que NO llevan parametro conviene darlos de alta como
// "Comando rapido" en la consola (se ejecutan con un click desde el menu, sin
// escribir); los que llevan parametro tienen que ser "Comando de barra".
//
// OJO con los rapidos: al no escribirse, el payload probablemente NO trae
// `message.text`, asi que la resolucion por nombre no aplica y manda el
// appCommandId. Para ESOS el numero de la consola tiene que coincidir con el
// de aca -- para los de barra da igual.
export const COMANDO_TAREA = 11
export const COMANDO_LOCAL = 12
export const COMANDO_RESUMEN = 13
export const COMANDO_EQUIPO = 14
export const COMANDO_DEPARTAMENTOS = 15

// Pregunta anclada en los documentos que cubre este Space (general + los
// departamentos que resuelva ambitoDelSpace), respondida por Gemini File
// Search. NO pasa por el dispatch generico de ejecutarComando/HANDLERS de
// abajo -- se especial-casea en manejarComando (routes/chat.js), porque una
// consulta a Gemini puede tardar mas que los ~30s que da Chat para responder
// (ver el comentario ahi). Requiere reconfigurar el comando en la consola de
// Chat de "barra" a "barra" simple (no dialogo) -- ver CONFIGURAR-CHAT-APP.md.
export const COMANDO_BUSCAR = 23

const POR_NOMBRE = {
  hoy: COMANDO_HOY,
  tareas: COMANDO_HOY,
  atrasadas: COMANDO_ATRASADAS,
  vencidas: COMANDO_ATRASADAS,
  mias: COMANDO_MIAS,
  ayuda: COMANDO_AYUDA,
  help: COMANDO_AYUDA,
  vincular: COMANDO_VINCULAR,
  desvincular: COMANDO_DESVINCULAR,
  marcar: COMANDO_MARCAR,
  hecha: COMANDO_MARCAR,
  tildar: COMANDO_TILDAR,
  pago: COMANDO_PAGO,
  mispagos: COMANDO_MISPAGOS,
  tildarpagos: COMANDO_TILDARPAGOS,
  tomar: COMANDO_TOMAR,
  pasar: COMANDO_PASAR,
  nota: COMANDO_NOTA,
  comentar: COMANDO_NOTA,
  asignar: COMANDO_ASIGNAR,
  derivar: COMANDO_DERIVAR,
  apuntar: COMANDO_APUNTAR,
  tarea: COMANDO_TAREA,
  detalle: COMANDO_TAREA,
  local: COMANDO_LOCAL,
  grupo: COMANDO_LOCAL,
  resumen: COMANDO_RESUMEN,
  estado: COMANDO_RESUMEN,
  equipo: COMANDO_EQUIPO,
  departamentos: COMANDO_DEPARTAMENTOS,
  buscar: COMANDO_BUSCAR
}

// Separador para los comandos que llevan dos partes:
//   /pasar cierre: juan@dcsmart.app
//   /nota cierre: hablé con el proveedor
// Sin un separador explicito no hay forma de saber donde termina el nombre de
// la tarea y empieza el resto.
const SEPARADOR = ':'

function partirArgumento(argumento) {
  const i = String(argumento || '').indexOf(SEPARADOR)
  if (i < 0) return { tarea: String(argumento || '').trim(), resto: '' }
  return { tarea: argumento.slice(0, i).trim(), resto: argumento.slice(i + 1).trim() }
}

// "/vincular finanzas" -> "finanzas". Todo lo que sigue al nombre del comando.
export function argumentoDeComando(texto) {
  const partes = String(texto || '').trim().split(/\s+/)
  return partes.slice(1).join(' ').trim()
}

// "/atrasadas algo" -> "atrasadas". Tolera acentos y mayusculas para que
// /Mías y /mias sean lo mismo.
export function nombreDeComando(texto) {
  const primera = String(texto || '').trim().split(/\s+/)[0] || ''
  if (!primera.startsWith('/')) return null
  return sinAcentos(primera.slice(1))
}

const IDS_CONOCIDOS = new Set(Object.values(POR_NOMBRE))

// El nombre gana sobre el ID. Devuelve null si no se reconoce ninguno.
// Se valida contra IDS_CONOCIDOS y no contra HANDLERS porque AYUDA y VINCULAR
// se resuelven aparte, fuera de esa tabla.
export function resolverComando({ comandoId, texto }) {
  const porNombre = POR_NOMBRE[nombreDeComando(texto)]
  if (porNombre) return porNombre
  const id = Number(comandoId)
  return IDS_CONOCIDOS.has(id) ? id : null
}

// Cuanto para atras mira /atrasadas. Mismo criterio que el kiosko: un mes de
// backlog alcanza para ver lo que hay que resolver sin arrastrar historia.
const DIAS_ATRASADAS = 60

const AYUDA = [
  '*Para mirar*',
  '`/hoy` — las tareas que vencen hoy en este departamento',
  '`/atrasadas` — lo que quedó sin hacer, de más viejo a más nuevo',
  '`/mias` — las que están a tu nombre (más las del equipo sin responsable fijo)',
  '',
  '*Para coordinar*',
  '`/marcar cierre` — la das por hecha',
  '`/tildar` — elegís de una lista, con checkbox, varias para marcar juntas',
  '`/tomar cierre` — la tarea queda a tu nombre',
  '`/pasar cierre: juan@dcsmart.app` — se la pasás a otra persona',
  '`/nota cierre: hablé con el proveedor` — dejás un comentario en el historial de la tarea',
  '_(`/derivar` y `/apuntar` hacen lo mismo que `/pasar` y `/nota`, pero con un formulario_',
  '_para elegir de una lista en vez de escribir.)_',
  '',
  '*Para ver el detalle*',
  '`/tarea cierre` — en qué anda una tarea, quién la tiene y su historial',
  '`/local tiamo` — las tareas de un local (o de todo un grupo)',
  '`/resumen` — cómo viene el departamento',
  '`/equipo` — quién tiene qué',
  '',
  '*Para consultar información*',
  '`/buscar cuál es la política de viáticos` — le preguntás a Gemini, que responde solo con los documentos cargados para tu departamento (manuales, políticas, instructivos)',
  '',
  '_No hace falta escribir el nombre completo de la tarea: con una parte alcanza_',
  '_(`/tomar cierre`). Si hay más de una que coincida, te pregunto cuál._',
  '',
  '_Solo administradores:_ `/vincular` abre un formulario para tildar qué departamento(s) cubre este Space (podés elegir más de uno). `/desvincular` para que este Space deje de recibir recordatorios y de cubrir ninguno.',
  '',
  '*Pagos de dcsmart* (no dependen de tu departamento)',
  '`/pago tiamo` — elegís un pago reciente de ese local y le asignás una tarea y/o una persona',
  '`/mispagos` — los pagos que tenés pendientes de resolver',
  '`/tildarpagos` — marcás varios como resueltos, con checkbox',
  '',
  '_Los recordatorios llegan solos todas las mañanas._'
].join('\n')

// Se agrega SOLO cuando el comando se ejecuta en "modo todo" (ver más abajo):
// avisar de entrada que el alcance es distinto evita que alguien piense que
// /hoy está roto porque trae tareas de otros departamentos.
const AVISO_MODO_TODO =
  '\n\n_Este Space ve TODOS los departamentos (es el de Dirección): `/hoy`, `/atrasadas`, `/mias`, `/tarea`, ' +
  '`/local`, `/resumen` y `/equipo` traen todo mezclado, y `/tomar`, `/pasar`, `/nota` (y sus diálogos) ' +
  'actúan sobre la tarea de cualquier departamento que encuentren._'

// Mismo aviso que AVISO_MODO_TODO pero para un Space compartido entre un
// puñado de departamentos concretos (no toda la empresa) -- por eso no puede
// ser una constante estatica, necesita los nombres reales.
function avisoModoCompartido(departamentos) {
  const nombres = departamentos.map((d) => d.nombre).join(', ')
  return (
    `\n\n_Este Space cubre varios departamentos (${nombres}): \`/hoy\`, \`/atrasadas\`, \`/mias\`, \`/tarea\`, ` +
    '`/local`, `/resumen` y `/equipo` traen todo mezclado, y `/tomar`, `/pasar`, `/nota` (y sus diálogos) ' +
    'actúan sobre la tarea de cualquiera de esos departamentos._'
  )
}

function unDia(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// Puede operar en Chat dentro de este Space: es de alguno de los
// departamentos que el Space cubre (el dueño, o los que se agregaron con
// /compartir), o es admin (mismo criterio que el resto de la app, ver
// permisos.js). Dirección es la excepcion, y a proposito NO por pertenecer a
// ese departamento sino por escribir desde SU Space: el usuario eligio de
// forma explicita que el control de acceso sea "quien este en el grupo que
// cree y vincule a Dirección", no "quien tenga Dirección en su ficha" -- así
// que ni siquiera hace falta ser de Dirección para operar ahí, alcanza con
// ser un ExtUser activo. Ver [[dcsmart_tareas_plataforma]] 2026-08-26.
//
// `departamentos` es el array COMPLETO que cubre el Space (dueño +
// compartidos, ver departamentosDelSpace) -- no un departamento suelto, para
// que un Space compartido entre 2-3 equipos deje operar a cualquiera de
// ellos, no solo al dueño original.
export function puedeOperarEnChat(usuario, departamentos) {
  if (!usuario) return false
  if (departamentos.some((d) => d?.slug === SLUG_DIRECCION)) return true
  return departamentos.some((d) => puede(usuario, 'ver', d?.id))
}

// Pasar una tarea a OTRA persona es editar (MANAGER u OWNER del grupo de ese
// departamento). Marcar, tomar y anotar alcanzan con ser MEMBER, y eso ya lo
// garantiza el ambito del Space. El Space de Direccion (modo todo) puede todo.
const AVISO_SIN_PERMISO_PASAR = (departamento) =>
  `⚠️ Pasarle una tarea a otra persona lo puede hacer un MANAGER u OWNER del grupo de ${departamento.nombre}. Si la querés hacer vos, usá \`/tomar\`.`

// Todos los departamentos que cubre un Space: el dueño (chat_space_name) +
// los que se agregaron con /compartir. Array vacio si el Space no esta
// vinculado a nadie. La forma es SIEMPRE un array (largo 1 para un Space
// normal) para que el resto del codigo no tenga que bifurcar segun si es
// compartido o no.
export async function departamentosDelSpace(db, space) {
  const dueño = await db.departamento.findUnique({ where: { chat_space_name: space } })
  if (!dueño) return []
  const filas = await db.departamentoCompartidoEnSpace.findMany({
    where: { chat_space_name: space },
    include: { departamento: true }
  })
  return [dueño, ...filas.map((f) => f.departamento)]
}

// Que departamento mira el comando: el dueño del Space si la persona puede
// operar ahi (caso normal, el Space ES del departamento o de alguno de los
// compartidos; para el Space de Dirección cualquier activo puede), y si no
// el propio.
// Nunca devuelve uno que la persona no pueda ver -- un Space puede tener gente
// de otros equipos.
// Devuelve { departamento, compartidos, porFallback }: `departamento` es
// siempre el DUEÑO (el de chat_space_name, para encabezados/`/vincular`),
// `compartidos` son los adicionales (`[]` para un Space normal), y
// `porFallback` es true cuando NO se pudo usar el del Space y se cayo al
// propio. Importa decirlo en la respuesta: sin eso, alguien parado en un
// Space sin vincular ve las tareas de otro departamento sin ninguna pista de
// por que -- paso de verdad, y el mensaje "no hay tareas pendientes 🎉"
// resultaba enganoso.
//
// OJO: `porFallback` tambien es la guarda de "modo todo" (ver mas abajo). Si
// alguien de Dirección escribe en un Space sin vincular, cae por fallback a
// SU propio departamento (Dirección) pero con porFallback=true -- eso NO
// activa modo todo, a proposito: el privilegio es del Space dedicado, no de
// pertenecer a Dirección (ver puedeOperarEnChat).
async function resolverDepartamento(db, { space, extUser }) {
  if (space) {
    const delEspacio = await departamentosDelSpace(db, space)
    if (delEspacio.length && puedeOperarEnChat(extUser, delEspacio)) {
      const [dueño, ...compartidos] = delEspacio
      return { departamento: dueño, compartidos, porFallback: false }
    }
  }
  // Sin Space vinculado: los departamentos propios (con Groups como fuente, una
  // persona puede estar en varios; el primero hace de principal).
  const ids = departamentosDe(extUser)
  if (!ids.length) return { departamento: null, compartidos: [], porFallback: false }
  const propios = await db.departamento.findMany({ where: { id: { in: ids }, activo: true }, orderBy: { nombre: 'asc' } })
  if (!propios.length) return { departamento: null, compartidos: [], porFallback: false }
  const [principal, ...resto] = propios
  return { departamento: principal, compartidos: resto, porFallback: true }
}

// "Modo todo": el Space esta vinculado DIRECTAMENTE a Dirección (no por
// fallback) -- ver el comentario de resolverDepartamento. En este modo los
// comandos de lectura mezclan los 11 departamentos y los de accion pueden
// tomar/pasar/anotar la tarea de cualquiera de ellos. Un Space compartido
// (dueño + /compartir) es un modo DISTINTO, mas chico -- ver ambitoDeChat.
function esModoTodo(departamento, porFallback) {
  return !porFallback && departamento?.slug === SLUG_DIRECCION
}

async function departamentosOperables(db) {
  return db.departamento.findMany({
    where: { activo: true, id_calendar_google: { not: null } },
    orderBy: { nombre: 'asc' }
  })
}

// El conjunto de departamentos que aplica a este contexto de Chat: los 11 en
// modo todo (Dirección), o el dueño + compartidos para cualquier otro Space
// (un array de 1 solo elemento si no tiene compartidos -- el caso de
// siempre). Centraliza una cuenta que se repetia igual en tres lugares
// (ejecutarComando, pendientesParaAsignar, pendientesParaTildar).
async function ambitoDeChat(db, { departamento, compartidos, porFallback }) {
  const modoTodo = esModoTodo(departamento, porFallback)
  const departamentos = modoTodo ? await departamentosOperables(db) : [departamento, ...compartidos]
  return { modoTodo, departamentos }
}

// Envuelve resolverDepartamento + ambitoDeChat en un solo llamado, para
// comandos que necesitan el ambito de un Space pero NO pasan por
// ejecutarComando (hoy solo /buscar, ver routes/chat.js -- resolverDepartamento
// no esta exportado a proposito, todo lo demas pasa por ejecutarComando).
export async function ambitoDelSpace(db, { space, extUser }) {
  const { departamento, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento) return { departamentos: [], modoTodo: false, porFallback: false }
  return { ...(await ambitoDeChat(db, { departamento, compartidos, porFallback })), porFallback }
}

// Aviso que se agrega cuando el departamento no salio del Space.
function avisoDeFallback(departamento) {
  return (
    `\n\n_Este Space no está vinculado a ningún departamento, así que te muestro las de *${departamento.nombre}* (el tuyo)._` +
    '\n_Un administrador puede vincularlo escribiendo_ `/vincular` _y eligiendo del formulario que se abre._'
  )
}

function encabezado(titulo, departamento) {
  return `*${titulo} — ${departamento.nombre}*`
}

// Mismo encabezado de siempre para un Space normal (un solo departamento).
// En modo todo no hay UN departamento que nombrar; en un Space compartido
// (dueño + /compartir) se nombran los dos o tres, con "+" -- distinto de
// modo todo porque ahi SI tiene sentido decir cuales son (nunca son mas de
// 2-3, a diferencia de los 11 de Dirección).
function tituloDeAmbito(titulo, { departamento, departamentos, modoTodo }) {
  if (modoTodo) return `*${titulo} — Todos los departamentos*`
  if (departamentos?.length > 1) return `*${titulo} — ${departamentos.map((d) => d.nombre).join(' + ')}*`
  return encabezado(titulo, departamento)
}

// Chat no permite encadenar comandos: cada uno es un evento independiente y no
// hay forma de mandar dos en un mismo mensaje. Lo que si se puede es dejar el
// siguiente comando ARMADO para copiar, que en la practica da el mismo efecto
// sin estado ni sintaxis nueva.
//
// Se usa el nombre COMPLETO de la tarea a proposito: un fragmento seria mas
// corto pero podria matchear otra cosa, y la gracia es poder copiar y pegar
// sin pensar.
function sugerir(...comandos) {
  const utiles = comandos.filter(Boolean)
  if (!utiles.length) return ''
  return `\n\n_Después:_ ${utiles.map((c) => `\`${c}\``).join(' · ')}`
}

// Las listas guardan sus items de dos formas: /hoy, /atrasadas y /mias usan
// { evento, departamento, dias }; /local usa los "operables" con .nombre ya
// resuelto.
function nombreDeEvento(evento) {
  return evento?.extendedProperties?.private?.nombre_tarea || evento?.summary || ''
}

// Con mas de una pendiente, /tildar (elegir varias con checkbox) es mas util
// que "/marcar" + el nombre de la primera nomas -- esa era una sugerencia
// arbitraria en cuanto habia dos o mas.
function sugerirSobreEventos(items) {
  const primera = items[0]
  if (!primera) return ''
  const nombre = nombreDeEvento(primera.evento)
  if (!nombre) return ''
  const marcar = items.length > 1 ? '/tildar' : `/marcar ${nombre}`
  return sugerir(marcar, `/tarea ${nombre}`, `/tomar ${nombre}`)
}

function sugerirSobreOperables(items) {
  const primera = items[0]
  if (!primera?.nombre) return ''
  const marcar = items.length > 1 ? '/tildar' : `/marcar ${primera.nombre}`
  return sugerir(marcar, `/tarea ${primera.nombre}`, `/tomar ${primera.nombre}`)
}

function sinNada(texto) {
  return `${texto} 🎉`
}

// Trae instancias de VARIOS departamentos en paralelo y etiqueta cada evento
// con el departamento del que salio -- fuera de "modo todo" es un array de
// uno solo, pero la forma del resultado es siempre la misma para que los
// comandos no tengan que bifurcar segun el modo.
async function instanciasDelRango(gcal, departamentos, { desdeISO, hastaISO }) {
  const porDepartamento = await Promise.all(
    departamentos.map(async (departamento) => {
      const items = await gcal.listarInstancias({
        calendarId: departamento.id_calendar_google,
        timeMin: `${desdeISO}T00:00:00Z`,
        timeMax: `${hastaISO}T23:59:59Z`
      })
      return items.map((evento) => ({ evento, departamento }))
    })
  )
  return porDepartamento.flat()
}

async function comandoHoy(deps, { departamento, departamentos, modoTodo, nombreLocal }) {
  const hoyISO = hoyEnArgentina()
  const items = await instanciasDelRango(deps.gcal, departamentos, { desdeISO: hoyISO, hastaISO: hoyISO })

  const pendientes = []
  const hechas = []
  for (const { evento, departamento: deptoDelEvento } of items) {
    const { hecha, fechaISO } = clasificarInstancia(evento)
    if (fechaISO !== hoyISO) continue
    ;(hecha ? hechas : pendientes).push({ evento, departamento: deptoDelEvento, dias: 0 })
  }

  const titulo = tituloDeAmbito('Hoy', { departamento, departamentos, modoTodo })
  if (!pendientes.length && !hechas.length) {
    return `${titulo}\nNo hay tareas agendadas para hoy.`
  }

  const opts = { conDepartamento: departamentos.length > 1 }
  const bloques = [titulo]
  if (pendientes.length) {
    bloques.push(`\n🕒 *Pendientes (${pendientes.length}):*\n${pendientes.map((i) => lineaDeTarea(i, nombreLocal, opts)).join('\n')}`)
  } else {
    bloques.push(`\n${sinNada('Todo lo de hoy está hecho')}`)
  }
  if (hechas.length) {
    bloques.push(`\n✅ *Hechas (${hechas.length}):*\n${hechas.map((i) => lineaDeTarea(i, nombreLocal, opts)).join('\n')}`)
  }
  return bloques.join('\n') + sugerirSobreEventos(pendientes)
}

async function comandoAtrasadas(deps, { departamento, departamentos, modoTodo, nombreLocal }) {
  const hoyISO = hoyEnArgentina()
  const items = await instanciasDelRango(deps.gcal, departamentos, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: hoyISO
  })

  const vencidas = []
  for (const { evento, departamento: deptoDelEvento } of items) {
    const { hecha, vencida } = clasificarInstancia(evento)
    if (hecha || !vencida) continue
    vencidas.push({ evento, departamento: deptoDelEvento, dias: diasHabilesVencida(evento, { hoyISO }) })
  }
  vencidas.sort((a, b) => b.dias - a.dias)

  const titulo = tituloDeAmbito('Atrasadas', { departamento, departamentos, modoTodo })
  if (!vencidas.length) {
    return `${titulo}\n${sinNada('No hay nada atrasado')}`
  }

  return (
    [
      titulo,
      `${vencidas.length} sin resolver, de más vieja a más nueva:`,
      '',
      vencidas.map((i) => lineaDeTarea(i, nombreLocal, { conAntiguedad: true, conDepartamento: departamentos.length > 1 })).join('\n')
    ].join('\n') + sugerirSobreEventos(vencidas)
  )
}

async function comandoMias(deps, { departamento, departamentos, modoTodo, nombreLocal, email }) {
  const hoyISO = hoyEnArgentina()
  // Misma ventana que la pantalla "Mis tareas": mira mas hacia atras que hacia
  // adelante, porque lo que importa es el backlog.
  const items = await instanciasDelRango(deps.gcal, departamentos, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: unDia(hoyISO, 14)
  })

  const vencidas = []
  const deHoy = []
  const proximas = []
  for (const { evento, departamento: deptoDelEvento } of items) {
    const props = evento.extendedProperties?.private || {}
    const responsable = String(props.asignado_a || '').toLowerCase().trim()
    // Sin responsable fijo = le toca al equipo, y por lo tanto tambien a esta
    // persona -- vale tanto para un Space normal como para uno compartido
    // (es "el equipo" de ese Space, un concepto chico y real). En modo todo
    // (Dirección viendo la empresa entera) "sin dueño" ya no es "el equipo de
    // nadie en particular", asi que ahi se pide coincidencia exacta.
    if (modoTodo ? responsable !== email : responsable && responsable !== email) continue

    const { hecha, vencida, fechaISO } = clasificarInstancia(evento)
    if (hecha) continue
    if (vencida) vencidas.push({ evento, departamento: deptoDelEvento, dias: diasHabilesVencida(evento, { hoyISO }) })
    // Lo de hoy va aparte de lo que viene despues: una tarea que vence hoy no
    // es "por venir", y mezclarlas esconde justo la que hay que hacer ya.
    else if (fechaISO === hoyISO) deHoy.push({ evento, departamento: deptoDelEvento, dias: 0 })
    else proximas.push({ evento, departamento: deptoDelEvento, dias: 0 })
  }
  vencidas.sort((a, b) => b.dias - a.dias)

  const titulo = tituloDeAmbito('Mis tareas', { departamento, departamentos, modoTodo })
  if (!vencidas.length && !deHoy.length && !proximas.length) {
    return `${titulo}\n${sinNada('No tenés nada pendiente')}`
  }

  const opts = { conDepartamento: departamentos.length > 1 }
  const bloques = [titulo]
  if (vencidas.length) {
    bloques.push(`\n⚠️ *Atrasadas (${vencidas.length}):*\n${vencidas.map((i) => lineaDeTarea(i, nombreLocal, { ...opts, conAntiguedad: true })).join('\n')}`)
  }
  if (deHoy.length) {
    bloques.push(`\n🕒 *Hoy (${deHoy.length}):*\n${deHoy.map((i) => lineaDeTarea(i, nombreLocal, opts)).join('\n')}`)
  }
  if (proximas.length) {
    bloques.push(`\n📅 *Próximos días (${proximas.length}):*\n${proximas.map((i) => lineaDeTarea(i, nombreLocal, opts)).join('\n')}`)
  }
  // Lo atrasado primero: es lo que conviene tocar antes que lo de hoy.
  return bloques.join('\n') + sugerirSobreEventos([...vencidas, ...deHoy])
}

// Lista + estado actual para el formulario (checkbox) de /vincular. Al
// reves que los demas "pendientesParaX": no exige que quien pregunta ya
// pueda operar en este Space -- ESTE comando es justamente el que define
// quien va a poder despues. Solo exige ser administrador.
export async function departamentosParaVincular(deps, { space, extUser }) {
  const { db } = deps
  if (!esAdminGlobal(extUser)) {
    return { error: '⚠️ Solo un administrador puede vincular este Space a un departamento.' }
  }
  if (!space) return { error: '⚠️ No pude identificar este Space.' }

  const departamentos = await db.departamento.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } })
  const actual = await departamentosDelSpace(db, space)
  return { departamentos, actuales: new Set(actual.map((d) => d.id)) }
}

// Fija de una sola vez la lista COMPLETA de departamentos que cubre este
// Space, a partir de lo tildado en el formulario de /vincular (ver
// dialogoVincular). Reemplaza tanto al /vincular de texto original como a
// /compartir + /descompartir -- volver a abrir el formulario y tildar
// distinto ES la forma de agregar, sacar, o cambiar de dueño. Decision
// explicita del usuario (2026-08-27): un solo comando reusado con checkbox,
// no tres comandos de texto separados.
//
// El dueño (Departamento.chat_space_name, @unique -- no puede ser dueño de
// dos Spaces a la vez) se mantiene si sigue tildado, para no reordenar nada
// solo por agregar o sacar un compartido; si se destildo, el primero por
// orden alfabetico de los que quedan pasa a ser el nuevo dueño. El resto de
// los tildados quedan como compartidos (DepartamentoCompartidoEnSpace) --
// mismo mecanismo que ya usaba /compartir, solo que ahora se recalcula
// entero en cada envio del formulario en vez de a mano de a uno.
export async function vincularDepartamentos(deps, { space, extUser, idsDepartamentos }) {
  const { db, log = console } = deps
  if (!esAdminGlobal(extUser)) {
    return '⚠️ Solo un administrador puede vincular este Space a un departamento.'
  }
  if (!space) return '⚠️ No pude identificar este Space.'

  const ids = [...new Set((Array.isArray(idsDepartamentos) ? idsDepartamentos : [idsDepartamentos]).filter(Boolean))]
  const actual = await departamentosDelSpace(db, space)
  const dueñoActual = actual[0] ?? null

  if (!ids.length) {
    if (!dueñoActual) return 'Este Space no cubre ningún departamento -- no hay nada que desvincular.'
    const { count } = await db.departamentoCompartidoEnSpace.deleteMany({ where: { chat_space_name: space } })
    await db.departamento.update({ where: { id: dueñoActual.id }, data: { chat_space_name: null } })
    log.info?.({ space, compartidosLimpiados: count }, 'chat: space desvinculado por el formulario (sin tildes)')
    return '✅ Listo. Este Space ya no cubre ningún departamento.\nPara volver a activarlo, escribí `/vincular`.'
  }

  const elegidos = await db.departamento.findMany({ where: { id: { in: ids }, activo: true }, orderBy: { nombre: 'asc' } })
  if (!elegidos.length) return '⚠️ Ninguno de los departamentos tildados sigue activo. Probá de nuevo.'

  const nuevoDueño = elegidos.find((d) => d.id === dueñoActual?.id) ?? elegidos[0]

  // chat_space_name es @unique en Departamento: no se le puede robar en
  // silencio el vinculo a un departamento que ya es dueño de OTRO Space.
  if (nuevoDueño.chat_space_name && nuevoDueño.chat_space_name !== space) {
    return `⚠️ *${nuevoDueño.nombre}* ya es el dueño de otro Space. Desvinculalo ahí primero (\`/desvincular\` desde ese otro Space) antes de tildarlo acá.`
  }

  if (nuevoDueño.id !== dueñoActual?.id) {
    if (dueñoActual) await db.departamento.update({ where: { id: dueñoActual.id }, data: { chat_space_name: null } })
    await db.departamento.update({ where: { id: nuevoDueño.id }, data: { chat_space_name: space } })
  }

  const compartidosNuevos = elegidos.filter((d) => d.id !== nuevoDueño.id)
  const idsCompartidosNuevos = compartidosNuevos.map((d) => d.id)
  await db.departamentoCompartidoEnSpace.deleteMany({
    where: {
      chat_space_name: space,
      id_departamento: { notIn: idsCompartidosNuevos.length ? idsCompartidosNuevos : ['__ninguno__'] }
    }
  })
  for (const d of compartidosNuevos) {
    const yaExiste = await db.departamentoCompartidoEnSpace.findFirst({ where: { chat_space_name: space, id_departamento: d.id } })
    if (!yaExiste) await db.departamentoCompartidoEnSpace.create({ data: { chat_space_name: space, id_departamento: d.id } })
  }

  log.info?.(
    { space, dueño: nuevoDueño.slug, compartidos: compartidosNuevos.map((d) => d.slug) },
    'chat: space vinculado por el formulario'
  )

  const notaDireccion = elegidos.some((d) => d.slug === SLUG_DIRECCION)
    ? '\n\n_Este Space va a poder ver y operar sobre CUALQUIER departamento (incluye a Dirección) -- sumá con cuidado a quién agregás acá._'
    : ''
  const resumen = compartidosNuevos.length
    ? `*${nuevoDueño.nombre}* (recibe los recordatorios) + ${compartidosNuevos.map((d) => `*${d.nombre}*`).join(', ')}`
    : `*${nuevoDueño.nombre}*`
  return `✅ Listo. Este Space queda vinculado a ${resumen}.${notaDireccion}`
}

// ── Comandos que operan sobre UNA tarea ───────────────────────────────────
//
// La tarea se identifica por texto parcial de su nombre, NO por un numero de
// una lista previa: entre que alguien mira /hoy y escribe el comando, otra
// persona puede marcar algo y correr la numeracion, y el comando terminaria
// aplicandose a la tarea equivocada. El texto no tiene ese problema, y la
// respuesta siempre nombra la tarea sobre la que se actuo para que un match
// erroneo se vea al instante.

async function instanciasOperables(gcal, departamentos, hoyISO) {
  const items = await instanciasDelRango(gcal, departamentos, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: unDia(hoyISO, 14)
  })
  return items.map(({ evento, departamento }) => {
    const nombre = evento.extendedProperties?.private?.nombre_tarea || evento.summary || '(sin nombre)'
    const local = localDeEvento(evento, nombre)
    return {
      evento,
      departamento,
      nombre,
      local,
      // Lo que se muestra y se busca: una tarea asignada por local son N eventos
      // con el MISMO nombre_tarea, y sin el local /marcar elegia uno al azar.
      rotulo: local ? `${nombre} — ${local}` : nombre,
      ...clasificarInstancia(evento)
    }
  })
}

// El local no viaja limpio en el evento (solo id_local_ext); se toma del
// summary, que lo arma lib/titulo.js como "<tarea> — <local> (<grupo>)".
function localDeEvento(evento, nombre) {
  if (!evento.extendedProperties?.private?.id_local_ext) return null
  const summary = String(evento.summary || '').replace(/^✓\s*/, '')
  const prefijo = `${nombre} — `
  if (!summary.startsWith(prefijo)) return null
  return summary.slice(prefijo.length).replace(/\s*\([^)]*\)\s*$/, '') || null
}

// Clave de "es la misma tarea": rotulo (nombre + local) + departamento. Dos
// rotulos iguales en DOS departamentos son la MISMA tarea compartida
// (TareaAsignacionDepto) con una copia de evento en cada calendario -- ahi
// conviene pedir que se precise, porque marcar una copia no marca la otra.
function claveDeTarea(operable) {
  return `${operable.departamento?.id}::${operable.rotulo}`
}

function coincide(operable, q) {
  const r = sinAcentos(operable.rotulo)
  if (r.includes(q)) return true
  // "cmv tiamo" contra "CMV — TI AMO": se compara tambien sin espacios ni signos.
  const compacto = (t) => t.replace(/[^a-z0-9]/g, '')
  if (compacto(q) && compacto(r).includes(compacto(q))) return true
  const palabras = q.split(/\s+/).filter((p) => p && p !== '—' && p !== '-')
  return palabras.length > 1 && palabras.every((p) => r.includes(p))
}

// { una } | { varias } | { ninguna }
function buscarPorTexto(operables, texto, hoyISO) {
  const q = sinAcentos(texto)
  if (!q) return { ninguna: true }

  const exactas = operables.filter((o) => sinAcentos(o.rotulo) === q || sinAcentos(o.nombre) === q)
  const candidatas = exactas.length ? exactas : operables.filter((o) => coincide(o, q))
  if (!candidatas.length) return { ninguna: true }

  // Varias instancias de LA MISMA tarea (una recurrente cae muchos dias) no es
  // ambiguedad real: se elige la de hoy, y si no hay, la mas atrasada. Solo se
  // pide precisar cuando son tareas distintas.
  const claves = new Set(candidatas.map(claveDeTarea))
  if (claves.size > 1) return { varias: candidatas }

  const deHoy = candidatas.find((c) => c.fechaISO === hoyISO)
  if (deHoy) return { una: deHoy }
  const ordenadas = [...candidatas].sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
  return { una: ordenadas[0] }
}

// NOTA (modo todo): si una tarea compartida entre dos departamentos coincide
// el mismo dia en los dos, esto la va a pedir precisar siempre -- y como el
// texto no permite indicar "cual departamento", no hay forma de resolverlo
// por texto. Para ese caso puntual sirve /asignar, /derivar o /apuntar (el
// dialogo elige por id de instancia, no por nombre).
function pedirPrecision(resultado, operables, { modoTodo = false } = {}) {
  const etiqueta = (o) => (modoTodo && o.departamento ? `${o.rotulo} (${o.departamento.nombre})` : o.rotulo)

  if (resultado.varias) {
    const unicas = [...new Map(resultado.varias.map((c) => [claveDeTarea(c), c])).values()]
    const opciones = unicas.map((c) => `• ${etiqueta(c)}`).join('\n')
    return `Hay más de una tarea que coincide. ¿Cuál?\n\n${opciones}`
  }
  const disponibles = [...new Map(operables.filter((o) => !o.hecha).map((o) => [claveDeTarea(o), o])).values()]
  if (!disponibles.length) return 'No encontré esa tarea, y no hay ninguna pendiente en este departamento.'
  return `No encontré esa tarea. Las pendientes son:\n\n${disponibles.map((o) => `• ${etiqueta(o)}`).join('\n')}`
}

// /tomar, /pasar y /nota usan gcal.marcarInstancia DIRECTO: mergean
// extendedProperties con las que ya tiene y appendean al historial, pero
// deliberadamente no ponen estado REALIZADA -- ninguna de las tres da la
// tarea por hecha, solo cambian quien se encarga o dejan constancia.
//
// /marcar es la excepcion: SI cierra la tarea, asi que reusa
// marcarInstanciaYPropagar (lib/marcar-instancia.js) -- el mismo helper del
// click del boton de la tarjeta -- en vez de gcal.marcarInstancia. Eso da,
// gratis, lo que las otras tres no necesitan: chequeo de "ya estaba marcada"
// (evita duplicar la linea de historial en un doble click), propagacion a las
// copias de departamentos compartidos, y el aviso de prerrequisito pendiente.
function ahoraISO() {
  return new Date().toISOString()
}

async function comandoMarcar(deps, { departamentos, modoTodo, email, argumento }) {
  const { gcal } = deps
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const r = buscarPorTexto(operables, argumento, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo: departamentos.length > 1 })

  const { evento, rotulo: nombre, departamento } = r.una
  const etiqueta = departamentos.length > 1 ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`

  const { evento: eventoFresco, yaEstaba, avisos } = await marcarInstanciaYPropagar(deps, {
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    emailUsuario: email,
    evaluarAvisos: ({ idAsignacion, fechaISO }) => prerrequisitosPendientes(deps, { idAsignacion, fechaISO }),
    // Mismo motivo que el click de boton: Chat corta a los 30s y el backoff
    // ante un 429 puede dormir hasta 30s solo, asi que la propagacion a
    // departamentos compartidos se resuelve en background.
    propagarEnBackground: true
  })

  if (yaEstaba) {
    const quien = eventoFresco?.extendedProperties?.private?.realizada_por
    return `✓ ${etiqueta} ya estaba marcada${quien ? ` por ${quien}` : ''}.`
  }

  const sufijo = avisos.length
    ? `\n⚠️ Ojo: todavía no ${avisos.length === 1 ? 'está hecha' : 'están hechas'} ` +
      avisos.map((a) => `*${a.nombre_tarea}* (${a.departamento})`).join(', ') + '.'
    : ''
  return `✅ ${etiqueta} marcada por ${email}.${sufijo}` + sugerir(`/tarea ${nombre}`)
}

async function comandoTomar(deps, { departamentos, modoTodo, email, argumento }) {
  const { gcal } = deps
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const r = buscarPorTexto(operables, argumento, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo: departamentos.length > 1 })

  const { evento, rotulo: nombre, hecha, departamento } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta tomarla.`

  const actual = evento.extendedProperties?.private?.asignado_a
  if (actual && actual.toLowerCase() === email) return `*${nombre}* ya está a tu nombre.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: { asignado_a: email },
    logLine: `${ahoraISO()} - TOMADA por ${email}${actual ? ` (antes: ${actual})` : ''}`
  })
  const etiqueta = departamentos.length > 1 ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
  const cierre = sugerir(`/marcar ${nombre}`, `/nota ${nombre}: `, `/tarea ${nombre}`)
  return actual
    ? `✋ ${etiqueta} pasa de ${actual} a vos.${cierre}`
    : `✋ Listo, ${etiqueta} queda a tu nombre.${cierre}`
}

async function comandoPasar(deps, { departamentos, modoTodo, email, extUser, argumento }) {
  const { db, gcal } = deps
  const { tarea, resto: destino } = partirArgumento(argumento)

  if (!tarea || !destino) {
    return 'Necesito la tarea y el email, separados por dos puntos.\nPor ejemplo: `/pasar cierre: juan@dcsmart.app`'
  }

  const emailDestino = normalizarEmail(destino)
  const persona = await conPermisos(db, await db.extUser.findUnique({ where: { email: emailDestino } }))
  if (!persona?.activo) return `No encontré a *${destino}* entre los usuarios activos de la plataforma.`

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const r = buscarPorTexto(operables, tarea, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo: departamentos.length > 1 })

  const { evento, rotulo: nombre, hecha, departamento } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta pasarla.`
  if (!modoTodo && !puede(extUser, 'editar', departamento.id)) return AVISO_SIN_PERMISO_PASAR(departamento)

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: { asignado_a: emailDestino },
    logLine: `${ahoraISO()} - REASIGNADA a ${emailDestino} por ${email}`
  })

  // Se avisa cuando la persona es de otro departamento QUE EL DE LA TAREA (no
  // el del comando): esa es la comparacion que importa para saber si le va a
  // aparecer en su /mias.
  const aviso =
    departamentosDe(persona).length > 0 && !departamentosDe(persona).includes(departamento.id)
      ? `\n⚠️ Ojo: ${persona.nombre} no es de ${departamento.nombre}, así que esta tarea no le va a aparecer en su \`/mias\`. Avisale por las suyas.`
      : ''
  const etiqueta = departamentos.length > 1 ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
  return `➡️ ${etiqueta} queda a nombre de ${persona.nombre} (${emailDestino}).${aviso}` + sugerir(`/nota ${nombre}: `)
}

async function comandoNota(deps, { departamentos, modoTodo, email, argumento }) {
  const { gcal } = deps
  const { tarea, resto: nota } = partirArgumento(argumento)

  if (!tarea || !nota) {
    return 'Necesito la tarea y la nota, separadas por dos puntos.\nPor ejemplo: `/nota cierre: hablé con el proveedor, viene el jueves`'
  }

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  // A diferencia de /tomar y /pasar, aca SI se puede anotar una tarea ya hecha:
  // dejar constancia despues de cerrarla es un caso legitimo.
  const r = buscarPorTexto(operables, tarea, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo: departamentos.length > 1 })

  const { evento, rotulo: nombre, departamento } = r.una
  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: {},
    logLine: `${ahoraISO()} - NOTA de ${email}: ${nota}`
  })
  const etiqueta = departamentos.length > 1 ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
  return `📝 Anotado en ${etiqueta}:\n_${nota}_` + sugerir(`/marcar ${nombre}`, `/tarea ${nombre}`)
}

// ── Comandos de status ────────────────────────────────────────────────────

const MAX_LINEAS_HISTORIAL = 6

// Detalle de UNA tarea: en que anda, quien la tiene, de que depende, y su
// historial. Es el que cierra el circulo de /nota: sin esto las notas se
// escriben en el historial del evento y no hay forma de leerlas desde Chat.
async function comandoTarea(deps, { departamentos, nombreLocal, argumento }) {
  const { db, gcal } = deps
  if (!argumento) return 'Decime parte del nombre de la tarea. Por ejemplo: `/tarea cierre`'

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const r = buscarPorTexto(operables, argumento, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo: departamentos.length > 1 })

  const { evento, nombre, hecha, vencida, fechaISO, departamento } = r.una
  const props = evento.extendedProperties?.private || {}
  const local = props.id_local_ext ? nombreLocal.get(props.id_local_ext) || 'Local sin nombre' : 'Toda la empresa'

  const estado = props.estado === 'NO_APLICA'
    ? `⊘ no aplica${props.no_aplica_motivo ? `: ${props.no_aplica_motivo}` : ''}${props.no_aplica_por ? ` (${props.no_aplica_por})` : ''}`
    : hecha
    ? `✅ hecha${props.realizada_por ? ` por ${props.realizada_por}` : ''}`
    : vencida
      ? `⚠️ atrasada ${diasHabilesVencida(evento, { hoyISO })} días hábiles`
      : fechaISO === hoyISO
        ? '🕒 pendiente, vence hoy'
        : `📅 pendiente, vence el ${fechaISO}`

  const lineas = [
    `*${nombre}*`,
    `Departamento: ${departamento.nombre}`,
    `Local: ${local}`,
    `Fecha: ${fechaISO}`,
    `Estado: ${estado}`,
    `Responsable: ${props.asignado_a || '_sin responsable fijo (la hace el equipo)_'}`
  ]

  // Prerrequisitos: se leen de la base, sin tocar Calendar de otro
  // departamento -- solo hace falta saber que espera, no si esta hecho.
  if (props.id_asignacion) {
    const [espera, bloquea] = await Promise.all([
      db.tareaAsignacionDependencia.findMany({
        where: { id_asignacion: props.id_asignacion, activa: true },
        include: { prerequisito: { include: { tarea: { include: { departamento: true } } } } }
      }),
      db.tareaAsignacionDependencia.findMany({
        where: { id_asignacion_prerequisito: props.id_asignacion, activa: true },
        include: { asignacion: { include: { tarea: { include: { departamento: true } } } } }
      })
    ])
    if (espera.length) {
      lineas.push(
        `\n⏳ *Espera a:* ${espera.map((d) => `${d.prerequisito.tarea.nombre} (${d.prerequisito.tarea.departamento.nombre})`).join(', ')}`
      )
    }
    if (bloquea.length) {
      lineas.push(
        `\n🔗 *Si no se hace, frena:* ${bloquea.map((d) => `${d.asignacion.tarea.nombre} (${d.asignacion.tarea.departamento.nombre})`).join(', ')}`
      )
    }
  }

  const historial = String(evento.description || '').trim()
  if (historial) {
    const todas = historial.split('\n').filter(Boolean)
    const ultimas = todas.slice(-MAX_LINEAS_HISTORIAL)
    const recorte = todas.length > ultimas.length ? `_(${todas.length - ultimas.length} más arriba)_\n` : ''
    lineas.push(`\n📜 *Historial:*\n${recorte}${ultimas.join('\n')}`)
  } else {
    lineas.push('\n📜 _Sin historial todavía._')
  }

  return (
    lineas.join('\n') +
    (hecha
      ? sugerir(`/nota ${nombre}: `)
      : sugerir(`/marcar ${nombre}`, `/tomar ${nombre}`, `/nota ${nombre}: `, `/pasar ${nombre}: `))
  )
}

// Tareas de un local, o de todos los locales de un grupo. Acepta las dos cosas
// con el mismo comando: 22 de los 32 grupos tienen UN solo local, asi que un
// /grupo aparte no aportaria nada y seria un comando mas para configurar.
async function comandoLocal(deps, { departamento, departamentos, modoTodo, argumento, preferirGrupo }) {
  const { db, gcal } = deps
  if (!argumento) return 'Decime un local o un grupo. Por ejemplo: `/local tiamo`'

  const buscado = sinAcentos(argumento)
  const locales = await db.extLocal.findMany({ where: { activo: true }, select: { id: true, nombre: true, grupo: true } })

  const nombreExacto = locales.filter((l) => sinAcentos(l.nombre) === buscado)
  const grupoExacto = locales.filter((l) => sinAcentos(l.grupo) === buscado)
  const nombreParcial = locales.filter((l) => sinAcentos(l.nombre).includes(buscado))
  const grupoParcial = locales.filter((l) => sinAcentos(l.grupo).includes(buscado))

  // Un texto puede ser a la vez el nombre de un local y parte de un grupo
  // ("aldos" = el local ALDOS y tambien GRUPO ALDOS, con 8 locales). El alias
  // que se uso desempata: /grupo apunta al grupo, /local al local. Y si igual
  // queda ambiguo, se pregunta en vez de elegir por el usuario.
  let elegidos = null
  let esGrupo = false
  if (preferirGrupo && grupoParcial.length) {
    elegidos = grupoParcial
    esGrupo = true
  } else if (grupoExacto.length) {
    elegidos = grupoExacto
    esGrupo = true
  } else if (nombreExacto.length) {
    elegidos = nombreExacto
  } else if (nombreParcial.length && grupoParcial.length) {
    const gruposDistintos = [...new Set(grupoParcial.map((l) => l.grupo))]
    return [
      `"${argumento}" puede ser un local o un grupo. ¿Cuál?`,
      '',
      ...nombreParcial.slice(0, 8).map((l) => `• el local *${l.nombre}* — \`/local ${l.nombre}\``),
      ...gruposDistintos.map((g) => `• el grupo *${g}* — \`/grupo ${g}\``)
    ].join('\n')
  } else if (nombreParcial.length) {
    elegidos = nombreParcial
  } else if (grupoParcial.length) {
    elegidos = grupoParcial
    esGrupo = true
  }

  if (!elegidos?.length) {
    return `No encontré ningún local ni grupo que coincida con "${argumento}".`
  }
  // Si matchea demasiados por nombre, el texto es probablemente muy corto.
  if (!esGrupo && elegidos.length > 8) {
    return `"${argumento}" coincide con ${elegidos.length} locales. Probá con algo más específico.`
  }

  const idsElegidos = new Set(elegidos.map((l) => l.id))
  const titulo = esGrupo
    ? `${elegidos[0].grupo} (${elegidos.length} ${elegidos.length === 1 ? 'local' : 'locales'})`
    : elegidos.length === 1
      ? elegidos[0].nombre
      : `${elegidos.length} locales`

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const nombrePorId = new Map(locales.map((l) => [l.id, l.nombre]))

  const relevantes = operables.filter((o) => {
    const idLocal = o.evento.extendedProperties?.private?.id_local_ext
    return idLocal && idsElegidos.has(idLocal)
  })

  const varios = departamentos.length > 1
  const encabezadoLocal = modoTodo
    ? titulo
    : varios
      ? `${titulo} — ${departamentos.map((d) => d.nombre).join(' + ')}`
      : `${titulo} — ${departamento.nombre}`
  if (!relevantes.length) {
    const alcance = modoTodo ? 'en la empresa' : varios ? 'en esos departamentos' : 'de este departamento'
    return `*${encabezadoLocal}*\nNo hay tareas ${alcance} para ${esGrupo ? 'ese grupo' : 'ese local'} en el último mes.`
  }

  const vencidas = relevantes.filter((o) => !o.hecha && o.vencida).sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
  const pendientes = relevantes.filter((o) => !o.hecha && !o.vencida)
  const hechas = relevantes.filter((o) => o.hecha)

  const linea = (o) => {
    const nl = nombrePorId.get(o.evento.extendedProperties?.private?.id_local_ext) || ''
    const partes = []
    if (elegidos.length > 1) partes.push(nl)
    if (varios) partes.push(o.departamento.nombre)
    const sufijo = partes.length ? ` — ${partes.join(' · ')}` : ''
    const atraso = o.vencida ? ` _(hace ${diasHabilesVencida(o.evento, { hoyISO })}d)_` : ''
    return `• ${o.nombre}${sufijo}${atraso}`
  }

  const bloques = [`*${encabezadoLocal}*`]
  if (vencidas.length) bloques.push(`\n⚠️ *Atrasadas (${vencidas.length}):*\n${vencidas.map(linea).join('\n')}`)
  if (pendientes.length) bloques.push(`\n🕒 *Pendientes (${pendientes.length}):*\n${pendientes.map(linea).join('\n')}`)
  if (hechas.length) bloques.push(`\n✅ ${hechas.length} ${hechas.length === 1 ? 'hecha' : 'hechas'} en el período.`)
  return bloques.join('\n') + sugerirSobreOperables([...vencidas, ...pendientes])
}

// Numeros del departamento: la respuesta a "¿cómo venimos?".
async function comandoResumen(deps, { departamento, departamentos, modoTodo }) {
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(deps.gcal, departamentos, hoyISO)

  const hoy = operables.filter((o) => o.fechaISO === hoyISO)
  const vencidas = operables.filter((o) => !o.hecha && o.vencida)
  const hechasPeriodo = operables.filter((o) => o.hecha && !o.noAplica)
  const cerradas = hechasPeriodo.length + vencidas.length
  const cumplimiento = cerradas ? Math.round((hechasPeriodo.length / cerradas) * 100) : null

  const masVieja = vencidas
    .map((o) => ({ nombre: o.rotulo, departamento: o.departamento, dias: diasHabilesVencida(o.evento, { hoyISO }) }))
    .sort((a, b) => b.dias - a.dias)[0]

  const varios = departamentos.length > 1
  const titulo = modoTodo
    ? 'Resumen — Todos los departamentos'
    : varios
      ? `Resumen — ${departamentos.map((d) => d.nombre).join(' + ')}`
      : `Resumen — ${departamento.nombre}`
  const lineas = [
    `*${titulo}*`,
    '',
    `Hoy: ${hoy.filter((o) => !o.hecha).length} pendientes, ${hoy.filter((o) => o.hecha).length} hechas`,
    `Atrasadas: ${vencidas.length}`,
    // El % se calcula sobre lo que ya se cerro de un modo u otro (hechas +
    // vencidas sin hacer): meter lo que todavia no vencio lo hundiria sin
    // que nadie haya incumplido nada.
    cumplimiento === null
      ? 'Cumplimiento del último mes: _sin datos todavía_'
      : `Cumplimiento del último mes: *${cumplimiento}%* (${hechasPeriodo.length} de ${cerradas})`
  ]
  if (masVieja) {
    const deQuien = varios ? ` (${masVieja.departamento.nombre})` : ''
    lineas.push(`\nLa más atrasada: *${masVieja.nombre}*${deQuien}, hace ${masVieja.dias} días hábiles.`)
  }
  if (!vencidas.length && !hoy.filter((o) => !o.hecha).length) lineas.push(`\n${sinNada('Al día')}`)
  return (
    lineas.join('\n') +
    (masVieja ? sugerir(`/tarea ${masVieja.nombre}`, '/atrasadas', '/equipo') : sugerir('/hoy'))
  )
}

// Carga por persona: quien tiene que y cuanto atraso arrastra.
async function comandoEquipo(deps, { departamento, departamentos, modoTodo }) {
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(deps.gcal, departamentos, hoyISO)
  const pendientes = operables.filter((o) => !o.hecha)

  const titulo = modoTodo
    ? 'Equipo — Todos los departamentos'
    : departamentos.length > 1
      ? `Equipo — ${departamentos.map((d) => d.nombre).join(' + ')}`
      : `Equipo — ${departamento.nombre}`
  if (!pendientes.length) return `*${titulo}*\n${sinNada('No hay nada pendiente')}`

  const SIN_DUENO = '(sin responsable)' // ordena primero y no choca con ningun email
  const porPersona = new Map()
  for (const o of pendientes) {
    const quien = normalizarEmail(o.evento.extendedProperties?.private?.asignado_a) || SIN_DUENO
    if (!porPersona.has(quien)) porPersona.set(quien, { total: 0, atrasadas: 0, peor: 0 })
    const acc = porPersona.get(quien)
    acc.total++
    if (o.vencida) {
      acc.atrasadas++
      acc.peor = Math.max(acc.peor, diasHabilesVencida(o.evento, { hoyISO }))
    }
  }

  // Mas atrasadas primero: es el orden en que conviene mirarlo.
  const filas = [...porPersona.entries()].sort((a, b) => b[1].atrasadas - a[1].atrasadas || b[1].total - a[1].total)

  const lineas = [`*${titulo}*`, '']
  for (const [quien, { total, atrasadas, peor }] of filas) {
    const etiqueta = quien === SIN_DUENO ? '_Sin responsable (las hace el equipo)_' : quien
    const detalle = atrasadas
      ? `${total} pendientes, *${atrasadas} atrasadas* (la peor, hace ${peor}d)`
      : `${total} pendientes, al día`
    lineas.push(`• ${etiqueta} — ${detalle}`)
  }
  return lineas.join('\n') + sugerir('/atrasadas', '/resumen')
}

// Panorama de configuracion de los 11 departamentos. A proposito NO consulta
// Calendar: seria una llamada por departamento y Chat corta a los 30 s. Lo que
// muestra es el estado de la configuracion, que es justo lo que no se ve desde
// ningun otro lado.
async function comandoDepartamentos(deps, { extUser }) {
  const { db } = deps
  if (!esAdminGlobal(extUser)) {
    return '⚠️ Este comando es solo para administradores.'
  }

  const [departamentos, compartidos] = await Promise.all([
    db.departamento.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { tareas: true } } }
    }),
    db.departamentoCompartidoEnSpace.findMany({ include: { departamento: true } })
  ])

  // Agrupados por Space, para mostrar en la fila del DUEÑO con quien lo
  // comparte -- un DepartamentoCompartidoEnSpace no tiene fila propia, es
  // metadata de OTRO departamento (el dueño de ese chat_space_name).
  const compartidosPorSpace = new Map()
  for (const c of compartidos) {
    if (!compartidosPorSpace.has(c.chat_space_name)) compartidosPorSpace.set(c.chat_space_name, [])
    compartidosPorSpace.get(c.chat_space_name).push(c.departamento.nombre)
  }

  const lineas = ['*Departamentos*', '']
  for (const d of departamentos) {
    const destino = d.chat_space_name ? '💬 Space' : d.chat_webhook_url ? '🔗 webhook' : '— sin avisos'
    const cal = d.id_calendar_google ? '' : ' ⚠️ sin calendario'
    const modoTodo = d.slug === SLUG_DIRECCION ? ' · 👁️ ve todo' : ''
    const nombresCompartidos = d.chat_space_name ? compartidosPorSpace.get(d.chat_space_name) : null
    const compartido = nombresCompartidos?.length ? ` · 🤝 compartido con ${nombresCompartidos.join(', ')}` : ''
    const umbrales =
      d.dias_aviso_departamento || d.dias_aviso_direccion
        ? ` · umbrales ${d.dias_aviso_departamento ?? 'def'}/${d.dias_aviso_direccion ?? 'def'}`
        : ''
    lineas.push(`• *${d.nombre}* (\`${d.slug}\`) — ${d._count.tareas} tareas · ${destino}${umbrales}${cal}${modoTodo}${compartido}`)
  }

  const sinDestino = departamentos.filter((d) => !d.chat_space_name && !d.chat_webhook_url).length
  if (sinDestino) {
    lineas.push(`\n_${sinDestino} sin Space ni webhook: sus tareas atrasadas escalan a Dirección pero no reciben su propio recordatorio._`)
  }
  return lineas.join('\n')
}

// ── Apoyo de los dialogos (/asignar, /derivar, /apuntar) ──────────────────
//
// Devuelven estructura en vez de texto, porque un dialogo no es un mensaje:
// lo arma chat-cards.js y lo despacha routes/chat.js.

// El value que viaja en la card no puede ser solo el instanceId: en modo todo
// el mismo id de evento puede repetirse entre calendarios distintos (son
// calendarios independientes), y ademas el submit necesita saber que
// calendario leer sin volver a resolver "todo el departamento" de nuevo.
// Se codifica el id de departamento junto con el id de instancia -- ninguno
// de los dos puede llevar "::", asi que es un separador seguro.
const SEP_TAREA_CODIFICADA = '::'

function codificarTarea(idDepartamento, instanceId) {
  return `${idDepartamento}${SEP_TAREA_CODIFICADA}${instanceId}`
}

function decodificarTarea(valor) {
  const i = String(valor || '').indexOf(SEP_TAREA_CODIFICADA)
  if (i < 0) return { idDepartamento: null, instanceId: null }
  return { idDepartamento: valor.slice(0, i), instanceId: valor.slice(i + SEP_TAREA_CODIFICADA.length) }
}

// Resuelve a que departamento pertenece una tarea codificada por
// pendientesParaAsignar. Fuera de "modo todo" tiene que caer dentro del
// ambito del Space (el dueño MAS sus compartidos) -- si no, alguien podria
// manipular el value del formulario (viene del cliente) para actuar sobre un
// departamento ajeno. En modo todo se confia el id codificado, siempre que
// sea un departamento activo con calendario: ese es justamente el privilegio
// de ese Space.
async function departamentoDeTareaCodificada(db, valorCodificado, { space, extUser }) {
  const { idDepartamento, instanceId } = decodificarTarea(valorCodificado)
  if (!idDepartamento || !instanceId) return { instanceId: null }

  const { departamento: contexto, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
  const modoTodo = esModoTodo(contexto, porFallback)
  const ambitoIds = [contexto?.id, ...compartidos.map((d) => d.id)]
  if (!modoTodo && !ambitoIds.includes(idDepartamento)) return { instanceId: null }

  const departamento = await db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento?.activo || !departamento.id_calendar_google) return { instanceId: null }
  return { departamento, instanceId, modoTodo }
}

// Semaforo + contadores, MISMO criterio que el kiosko (routes/tv.js#estado_general):
// rojo si hay algo atrasado (de cualquier dia -- una tarea de hoy recien vence a
// la medianoche), amarillo si quedan pendientes de hoy, verde si no.
function resumenDelDia(operables, hoyISO) {
  const deHoy = operables.filter((o) => o.fechaISO === hoyISO)
  const vencidas = operables.filter((o) => !o.hecha && o.vencida).length
  const pendientes = deHoy.filter((o) => !o.hecha && !o.vencida).length
  const realizadas = deHoy.filter((o) => o.hecha).length
  const semaforo = vencidas > 0 ? '🔴' : pendientes > 0 ? '🟡' : '🟢'
  return { semaforo, vencidas, pendientes, realizadas }
}

// { departamento, departamentos, pendientes, porFallback, modoTodo } | { error }
export async function pendientesParaAsignar(deps, { space, extUser }) {
  const { db, gcal } = deps
  const { departamento, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento?.id_calendar_google) {
    return { error: '⚠️ No pude resolver un departamento con calendario para este Space. Un administrador puede vincularlo escribiendo `/vincular` y eligiendo del formulario que se abre.' }
  }

  const { modoTodo, departamentos } = await ambitoDeChat(db, { departamento, compartidos, porFallback })

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const varios = departamentos.length > 1
  const pendientes = operables
    .filter((o) => !o.hecha)
    .sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
    .map((o) => {
      const deQuien = varios ? ` — ${o.departamento.nombre}` : ''
      return {
        instanceId: codificarTarea(o.departamento.id, o.evento.id),
        etiqueta: o.vencida
          ? `${o.rotulo}${deQuien} — atrasada ${diasHabilesVencida(o.evento, { hoyISO })}d`
          : o.fechaISO === hoyISO
            ? `${o.rotulo}${deQuien} — hoy`
            : `${o.rotulo}${deQuien} — ${o.fechaISO}`
      }
    })

  return { departamento, departamentos, pendientes, porFallback, modoTodo }
}

// Toma una instancia por su id (viene del dialogo). El id se re-verifica
// contra Calendar igual, y el departamento sale del propio value codificado
// (re-chequeado contra permisos en departamentoDeTareaCodificada) -- lo que
// llega del formulario no decide permisos por si solo.
export async function tomarPorInstanceId(deps, { space, extUser, email, instanceId: valorCodificado }) {
  const { db, gcal, log = console } = deps
  const { departamento, instanceId } = await departamentoDeTareaCodificada(db, valorCodificado, { space, extUser })
  if (!departamento) return '⚠️ No pude identificar la tarea (o ya no tenés acceso a ese departamento).'

  const instancia = await gcal.leerInstancia({ calendarId: departamento.id_calendar_google, instanceId })
  if (!instancia) return '⚠️ Esa tarea ya no existe.'

  const props = instancia.extendedProperties?.private || {}
  const nombre = props.nombre_tarea || instancia.summary || 'La tarea'
  if (estaHecha(props)) return `${nombre} ya está hecha.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId,
    extendedProperties: { asignado_a: email },
    logLine: `${ahoraISO()} - TOMADA por ${email}${props.asignado_a ? ` (antes: ${props.asignado_a})` : ''}`
  })
  log.info?.({ instanceId, email, departamento: departamento.slug }, 'chat: tarea tomada desde el dialogo')
  return `✋ ${nombre} queda a tu nombre.`
}

// Nomina para el dropdown de /derivar. Compania entera, no acotada al
// departamento: /pasar ya permite pasarle una tarea a alguien de otro equipo
// (con su propio aviso), asi que el dialogo no tiene por que ser mas
// restrictivo que el comando de texto que imita.
export async function personasActivas(deps) {
  const { db } = deps
  return db.extUser.findMany({
    where: { activo: true },
    select: { email: true, nombre: true },
    orderBy: { nombre: 'asc' }
  })
}

// Reasigna una instancia por su id (viene del dialogo de /derivar). Mismo
// criterio que tomarPorInstanceId: el id y el email destino se re-verifican
// del lado del servidor, el formulario no decide nada por si solo.
export async function pasarPorInstanceId(deps, { space, extUser, email, instanceId: valorCodificado, emailDestino }) {
  const { db, gcal, log = console } = deps
  const { departamento, instanceId, modoTodo } = await departamentoDeTareaCodificada(db, valorCodificado, { space, extUser })
  if (!departamento) return '⚠️ No pude identificar la tarea (o ya no tenés acceso a ese departamento).'
  if (!modoTodo && !puede(extUser, 'editar', departamento.id)) return AVISO_SIN_PERMISO_PASAR(departamento)

  const destino = normalizarEmail(emailDestino)
  if (!destino) return '⚠️ Elegí a quién le pasás la tarea.'
  const persona = await conPermisos(db, await db.extUser.findUnique({ where: { email: destino } }))
  if (!persona?.activo) return '⚠️ Esa persona ya no está activa en la plataforma.'

  const instancia = await gcal.leerInstancia({ calendarId: departamento.id_calendar_google, instanceId })
  if (!instancia) return '⚠️ Esa tarea ya no existe.'

  const props = instancia.extendedProperties?.private || {}
  const nombre = props.nombre_tarea || instancia.summary || 'La tarea'
  if (estaHecha(props)) return `${nombre} ya está hecha, no hace falta pasarla.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId,
    extendedProperties: { asignado_a: destino },
    logLine: `${ahoraISO()} - REASIGNADA a ${destino} por ${email}`
  })
  log.info?.({ instanceId, destino, departamento: departamento.slug }, 'chat: tarea pasada desde el diálogo')

  // Mismo aviso que comandoPasar: si la persona es de otro departamento, esta
  // tarea no le va a aparecer en su /mias (que mira su propio departamento).
  const aviso =
    departamentosDe(persona).length > 0 && !departamentosDe(persona).includes(departamento.id)
      ? ` ⚠️ Ojo: ${persona.nombre} no es de ${departamento.nombre}, así que esta tarea no le va a aparecer en su \`/mias\`.`
      : ''
  return `➡️ ${nombre} queda a nombre de ${persona.nombre}.${aviso}`
}

// Agrega una nota a una instancia por su id (viene del dialogo de /apuntar).
export async function notaPorInstanceId(deps, { space, extUser, email, instanceId: valorCodificado, nota }) {
  const { db, gcal, log = console } = deps
  const { departamento, instanceId } = await departamentoDeTareaCodificada(db, valorCodificado, { space, extUser })
  if (!departamento) return '⚠️ No pude identificar la tarea (o ya no tenés acceso a ese departamento).'

  const textoNota = String(nota || '').trim()
  if (!textoNota) return '⚠️ La nota llegó vacía.'

  const instancia = await gcal.leerInstancia({ calendarId: departamento.id_calendar_google, instanceId })
  if (!instancia) return '⚠️ Esa tarea ya no existe.'

  const props = instancia.extendedProperties?.private || {}
  const nombre = props.nombre_tarea || instancia.summary || 'La tarea'

  // A diferencia de /derivar, acá SI se puede anotar una tarea ya hecha --
  // mismo criterio que comandoNota: dejar constancia despues de cerrarla es
  // un caso legitimo.
  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId,
    extendedProperties: {},
    logLine: `${ahoraISO()} - NOTA de ${email}: ${textoNota}`
  })
  log.info?.({ instanceId, departamento: departamento.slug }, 'chat: nota agregada desde el diálogo')
  return `📝 Anotado en *${nombre}*.`
}

// ── Apoyo del dialogo /tildar (checkbox, varias tareas de una) ────────────

// { departamento, departamentos, pendientes, porFallback, modoTodo, resumen } | { error }
//
// A diferencia de pendientesParaAsignar (ordenada por fecha, pensada para
// "cual tomo"), esta lista va ordenada por ATRASO -- la mas vieja primero -- y
// se acota a lo vencido + lo de hoy: tomar algo con dos semanas de
// anticipacion no tiene sentido en un checklist de "esto ya lo hice".
export async function pendientesParaTildar(deps, { space, extUser }) {
  const { db, gcal } = deps
  const { departamento, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento?.id_calendar_google) {
    return { error: '⚠️ No pude resolver un departamento con calendario para este Space. Un administrador puede vincularlo escribiendo `/vincular` y eligiendo del formulario que se abre.' }
  }

  const { modoTodo, departamentos } = await ambitoDeChat(db, { departamento, compartidos, porFallback })

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const resumen = resumenDelDia(operables, hoyISO)
  const varios = departamentos.length > 1

  const pendientes = operables
    .filter((o) => !o.hecha && (o.vencida || o.fechaISO === hoyISO))
    .map((o) => ({ ...o, dias: o.vencida ? diasHabilesVencida(o.evento, { hoyISO }) : 0 }))
    .sort((a, b) => b.dias - a.dias)
    .map((o) => {
      // 🔴/🟡, no 🚨/⚠️/🕒: el pedido fue explicito por "los colores" del
      // semaforo, y usar el mismo par que el kiosko (en vez del vocabulario
      // de tres niveles de la tarjeta diaria) es lo que hace que se lea igual
      // que la pantalla de oficina que esto imita.
      const color = o.vencida ? '🔴' : '🟡'
      const antiguedad = o.vencida ? ` — hace ${o.dias}d` : ' — hoy'
      const deQuien = varios ? ` [${o.departamento.nombre}]` : ''
      return {
        instanceId: codificarTarea(o.departamento.id, o.evento.id),
        etiqueta: `${color} ${o.rotulo}${deQuien}${antiguedad}`
      }
    })

  return { departamento, departamentos, pendientes, porFallback, modoTodo, resumen }
}

// Marca VARIAS instancias codificadas de una sola vez (vienen del checkbox
// del dialogo /tildar). Cada una se re-verifica y marca por separado -- si
// una falla (por ejemplo ya no existe, o alguien la desvinculo del
// departamento mientras tanto), no aborta las demas.
export async function marcarVarias(deps, { space, extUser, email, instanceIds }) {
  const { db, gcal, log = console } = deps
  const valores = (Array.isArray(instanceIds) ? instanceIds : [instanceIds]).filter(Boolean)
  if (!valores.length) return '⚠️ No tildaste ninguna.'

  const marcadas = []
  const yaEstaban = []
  const fallidas = []
  const avisos = []

  for (const valor of valores) {
    let nombre = null
    try {
      const { departamento, instanceId } = await departamentoDeTareaCodificada(db, valor, { space, extUser })
      if (!departamento) {
        fallidas.push('una tarea (ya no tenés acceso a su departamento)')
        continue
      }
      const previa = await gcal.leerInstancia({ calendarId: departamento.id_calendar_google, instanceId })
      nombre = previa?.extendedProperties?.private?.nombre_tarea || previa?.summary || 'Tarea'

      const { yaEstaba, avisos: avisosDeEsta } = await marcarInstanciaYPropagar(deps, {
        calendarId: departamento.id_calendar_google,
        instanceId,
        emailUsuario: email,
        evaluarAvisos: ({ idAsignacion, fechaISO }) => prerrequisitosPendientes(deps, { idAsignacion, fechaISO }),
        propagarEnBackground: true
      })
      if (yaEstaba) yaEstaban.push(nombre)
      else {
        marcadas.push(nombre)
        avisos.push(...avisosDeEsta)
      }
    } catch (err) {
      log.error?.({ err: err.message }, 'chat: fallo marcar desde el checkbox de /tildar')
      fallidas.push(nombre || 'una tarea')
    }
  }

  const lineas = []
  if (marcadas.length) lineas.push(`✅ Marcadas (${marcadas.length}): ${marcadas.join(', ')}.`)
  if (yaEstaban.length) lineas.push(`✓ Ya estaban hechas (${yaEstaban.length}): ${yaEstaban.join(', ')}.`)
  if (fallidas.length) lineas.push(`⚠️ No se pudieron marcar (${fallidas.length}): ${fallidas.join(', ')}.`)
  if (avisos.length) {
    const unicos = [...new Map(avisos.map((a) => [`${a.nombre_tarea}|${a.departamento}`, a])).values()]
    lineas.push(
      `⚠️ Ojo: todavía no ${unicos.length === 1 ? 'está hecha' : 'están hechas'} ` +
      unicos.map((a) => `*${a.nombre_tarea}* (${a.departamento})`).join(', ') + '.'
    )
  }
  return lineas.join('\n') || 'No se marcó nada.'
}

// ── Apoyo de /pago, /mispagos, /tildarpagos ────────────────────────────────
//
// Un Pago no tiene departamento, solo local -- por eso estos tres NO pasan
// por resolverDepartamento/modoTodo como el resto del archivo. El unico gate
// es ser un ExtUser activo (ya verificado antes de llegar aca, en
// routes/chat.js), igual que cualquier comando de lectura.

// { local } | { varios } | { error } -- version simplificada de la
// resolucion de comandoLocal: aca hace falta UN local puntual (un Pago es de
// uno solo), no la logica de "o es un grupo" que ese comando necesita.
async function resolverLocalPorTexto(db, texto) {
  const buscado = sinAcentos(texto)
  const locales = await db.extLocal.findMany({ where: { activo: true }, select: { id: true, nombre: true } })
  const exacto = locales.filter((l) => sinAcentos(l.nombre) === buscado)
  const candidatos = exacto.length ? exacto : locales.filter((l) => sinAcentos(l.nombre).includes(buscado))
  if (candidatos.length === 1) return { local: candidatos[0] }
  if (!candidatos.length) return { error: `No encontré ningún local que coincida con "${texto}".` }
  return { varios: candidatos }
}

// { local, pendientes, tareas, personas } | { error }
export async function pagosParaVincular(deps, { argumento }) {
  const { db } = deps
  if (!argumento) return { error: '⚠️ Decime el local. Por ejemplo: `/pago tiamo`' }

  const resuelto = await resolverLocalPorTexto(db, argumento)
  if (resuelto.error) return { error: `⚠️ ${resuelto.error}` }
  if (resuelto.varios) {
    const opciones = resuelto.varios.map((l) => `• ${l.nombre}`).join('\n')
    return { error: `Hay más de un local que coincide con "${argumento}". ¿Cuál?\n\n${opciones}` }
  }

  const local = resuelto.local
  const [yaVinculados, tareas, personas] = await Promise.all([
    db.pagoSeguimiento.findMany({ where: { id_local_ext: local.id }, select: { id_pago: true } }),
    db.tarea.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } }),
    personasActivas(deps)
  ])
  const excluir = new Set(yaVinculados.map((p) => p.id_pago))
  const pendientes = await pagosRecientesDeLocal(deps, { idLocalExt: local.id, excluir })

  return { local, pendientes, tareas, personas }
}

// Confirma la vinculacion (viene del dialogo de /pago). El pago se re-lee de
// BigQuery en este momento -- no se confia en lo que haya en el value de la
// card, que pudo quedar viejo entre que se abrio el dialogo y se mando.
export async function vincularPago(deps, { email, idPago, idTarea, asignadoA }) {
  const { db, log = console } = deps
  if (!idPago) return '⚠️ No pude identificar el pago.'

  const yaExiste = await db.pagoSeguimiento.findUnique({ where: { id_pago: idPago } })
  if (yaExiste) return '✓ Ese pago ya tenía seguimiento.'

  const pago = await pagoPorId(deps, { idPago })
  if (!pago) return '⚠️ No encontré ese pago (puede haberse eliminado o quedar fuera de la ventana reciente).'

  let persona = null
  const destino = asignadoA ? normalizarEmail(asignadoA) : null
  if (destino) {
    persona = await db.extUser.findUnique({ where: { email: destino } })
    if (!persona?.activo) return '⚠️ Esa persona ya no está activa en la plataforma.'
  }

  const tarea = idTarea ? await db.tarea.findUnique({ where: { id: idTarea } }) : null

  await db.pagoSeguimiento.create({
    data: {
      id_pago: pago.id,
      id_local_ext: pago.id_local_ext || null,
      comprobante: pago.comprobante,
      proveedor: pago.proveedor,
      importe: pago.importe != null ? String(pago.importe) : null,
      fecha_pago: pago.fecha_dia ? new Date(pago.fecha_dia) : null,
      id_tarea: tarea?.id || null,
      asignado_a: destino,
      created_by: email
    }
  })
  log.info?.({ idPago: pago.id, idTarea: tarea?.id, destino }, 'chat: pago vinculado desde el diálogo')

  const monto = formatearMonto(pago.importe) || ''
  const partes = [`✅ Vinculado: ${pago.comprobante || pago.proveedor} ${monto}.`]
  if (tarea) partes.push(`Clasificado como *${tarea.nombre}*.`)
  if (persona) partes.push(`Asignado a ${persona.nombre}.`)
  return partes.join(' ')
}

// Texto plano, mismo estilo que /mias -- pasa por ejecutarComando pero ANTES
// de resolverDepartamento (ver ese archivo), porque un pago no tiene uno.
async function comandoMisPagos(deps, { email }) {
  const { db } = deps
  const pendientes = await db.pagoSeguimiento.findMany({
    where: { asignado_a: email, estado: 'PENDIENTE' },
    include: { tarea: true },
    orderBy: { created_at: 'asc' }
  })
  if (!pendientes.length) return `*Mis pagos*\n${sinNada('No tenés pagos pendientes')}`

  const lineas = pendientes.map((p) => {
    const clasificacion = p.tarea ? ` — ${p.tarea.nombre}` : ''
    const monto = formatearMonto(p.importe) ? ` — ${formatearMonto(p.importe)}` : ''
    return `• ${p.comprobante || p.proveedor || '(sin comprobante)'}${clasificacion}${monto}`
  })
  return `*Mis pagos*\n\n${lineas.join('\n')}` + sugerir('/tildarpagos')
}

// { pendientes } -- lista para el checkbox de /tildarpagos. Mismo shape
// {instanceId, etiqueta} que espera selectorMultiple en chat-cards.js, aunque
// aca "instanceId" sea en realidad el id de PagoSeguimiento -- se llama igual
// para poder compartir el widget sin que chat-cards.js necesite saber de que
// dominio viene cada uno.
export async function pendientesParaTildarPagos(deps, { email }) {
  const { db } = deps
  const pendientes = await db.pagoSeguimiento.findMany({
    where: { asignado_a: email, estado: 'PENDIENTE' },
    include: { tarea: true },
    orderBy: { created_at: 'asc' }
  })
  return pendientes.map((p) => {
    const clasificacion = p.tarea ? ` — ${p.tarea.nombre}` : ''
    const monto = formatearMonto(p.importe) ? ` — ${formatearMonto(p.importe)}` : ''
    return { instanceId: p.id, etiqueta: `${p.comprobante || p.proveedor || '(sin comprobante)'}${clasificacion}${monto}` }
  })
}

// Marca varios PagoSeguimiento como HECHO de una (viene del checkbox de
// /tildarpagos). El WHERE con asignado_a+estado en el mismo updateMany es la
// guarda de seguridad: nadie puede marcar un pago que no es suyo manipulando
// el value de la card, porque esa fila simplemente no matchea el filtro.
export async function marcarPagos(deps, { email, ids }) {
  const { db } = deps
  const valores = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!valores.length) return '⚠️ No tildaste ninguno.'

  const { count } = await db.pagoSeguimiento.updateMany({
    where: { id: { in: valores }, asignado_a: email, estado: 'PENDIENTE' },
    data: { estado: 'HECHO' }
  })
  const noEncontrados = valores.length - count
  const partes = [`✅ Marcados ${count} de ${valores.length}.`]
  if (noEncontrados > 0) partes.push(`${noEncontrados} no se pudieron marcar (ya no eran tuyos, o ya estaban hechos).`)
  return partes.join(' ')
}

// Corta el vinculo de este Space. La otra forma de lograr lo mismo es sacar la
// app del Space (REMOVED_FROM_SPACE tambien limpia), pero eso ademas silencia
// los comandos -- con esto el Space deja de recibir los recordatorios y sigue
// pudiendo consultar.
async function comandoDesvincular(deps, { space, extUser }) {
  const { db, log = console } = deps

  if (!esAdminGlobal(extUser)) {
    return '⚠️ Solo un administrador puede desvincular este Space.'
  }
  if (!space) return '⚠️ No pude identificar este Space.'

  const actual = await db.departamento.findUnique({ where: { chat_space_name: space } })
  if (!actual) return 'Este Space no está vinculado a ningún departamento.'

  // Los compartidos (/compartir) se limpian ACA, no despues: si quedaran
  // huerfanos apuntando a este mismo string de Space, un futuro /vincular a
  // un departamento DISTINTO los "reactivaria" solos, aplicando a un par
  // equivocado sin que nadie lo haya pedido.
  const { count } = await db.departamentoCompartidoEnSpace.deleteMany({ where: { chat_space_name: space } })
  await db.departamento.update({ where: { id: actual.id }, data: { chat_space_name: null } })
  log.info?.({ space, departamento: actual.slug, compartidosLimpiados: count }, 'chat: space desvinculado por comando')
  const nota = count ? ` (y se sacaron los ${count} departamento${count === 1 ? '' : 's'} que lo compartían)` : ''
  return `✅ Listo. Este Space ya no recibe los recordatorios de *${actual.nombre}*${nota}.\nPara volver a activarlo: \`/vincular ${actual.slug}\``
}

// Comandos que necesitan resolver un departamento con calendario antes de
// correr. /vincular, /desvincular y /ayuda quedan afuera: /vincular y
// /desvincular operan sobre el vinculo del Space (pedirles un departamento ya
// resuelto seria circular), y /ayuda no necesita ninguno salvo para decidir
// si suma el aviso de "modo todo".
const HANDLERS = {
  [COMANDO_HOY]: comandoHoy,
  [COMANDO_ATRASADAS]: comandoAtrasadas,
  [COMANDO_MIAS]: comandoMias,
  [COMANDO_MARCAR]: comandoMarcar,
  [COMANDO_TOMAR]: comandoTomar,
  [COMANDO_PASAR]: comandoPasar,
  [COMANDO_NOTA]: comandoNota,
  [COMANDO_TAREA]: comandoTarea,
  [COMANDO_LOCAL]: comandoLocal,
  [COMANDO_RESUMEN]: comandoResumen,
  [COMANDO_EQUIPO]: comandoEquipo,
  [COMANDO_DEPARTAMENTOS]: comandoDepartamentos
}

// Devuelve el TEXTO de la respuesta (el envoltorio de Chat lo pone routes/chat.js).
// Nunca tira: un comando que explota tiene que contestar algo legible, no
// dejar al usuario mirando un error de Chat.
export async function ejecutarComando(deps, { comandoId, texto, space, extUser, email }) {
  const { db, gcal, log = console } = deps

  const comando = resolverComando({ comandoId, texto })

  // En el flujo real, /vincular abre un dialogo (checkbox, ver
  // departamentosParaVincular/dialogoVincular) y nunca llega hasta aca -- lo
  // intercepta manejarComando en routes/chat.js antes de este punto, igual
  // que /asignar o /tildar. Esta rama es solo una red de seguridad.
  if (comando === COMANDO_VINCULAR) {
    return 'Escribí `/vincular` y elegí de la lista con checkbox que se abre.'
  }

  if (comando === COMANDO_DESVINCULAR) {
    try {
      return await comandoDesvincular({ db, log }, { space, extUser })
    } catch (err) {
      log.error?.({ err: err.message, comando }, 'chat: fallo el desvinculado')
      return '⚠️ No pude desvincular el Space. Probá de nuevo.'
    }
  }

  if (comando === COMANDO_AYUDA) {
    const { departamento, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
    const { modoTodo, departamentos } = await ambitoDeChat(db, { departamento, compartidos, porFallback })
    if (modoTodo) return `${AYUDA}${AVISO_MODO_TODO}`
    if (departamentos.length > 1) return `${AYUDA}${avisoModoCompartido(departamentos)}`
    return AYUDA
  }

  // Un Pago no tiene departamento -- antes de la resolucion de mas abajo, que
  // exige uno, o /mispagos quedaria bloqueado para cualquiera sin
  // departamento propio (o parado en un Space sin vincular).
  if (comando === COMANDO_MISPAGOS) {
    try {
      return await comandoMisPagos({ db }, { email })
    } catch (err) {
      log.error?.({ err: err.message }, 'chat: fallo /mispagos')
      return '⚠️ No pude traer tus pagos. Probá de nuevo.'
    }
  }

  const handler = HANDLERS[comando]
  if (!handler) {
    log.warn?.({ comandoId, texto }, 'chat: comando desconocido')
    return `No conozco ese comando.\n\n${AYUDA}`
  }

  const { departamento, compartidos, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento) {
    return '⚠️ Tu usuario todavía no tiene departamento asignado. Pedile a un administrador que te lo cargue.'
  }
  if (!departamento.id_calendar_google) {
    return `⚠️ ${departamento.nombre} todavía no tiene calendario configurado.`
  }

  const { modoTodo, departamentos } = await ambitoDeChat(db, { departamento, compartidos, porFallback })

  try {
    const locales = await db.extLocal.findMany({ select: { id: true, nombre: true } })
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
    const respuesta = await handler(
      { db, gcal, log },
      {
        departamento,
        departamentos,
        modoTodo,
        nombreLocal,
        email,
        extUser,
        argumento: argumentoDeComando(texto),
        // /grupo y /local son el mismo handler; el alias que se uso desempata
        // cuando el texto puede ser tanto un local como un grupo.
        preferirGrupo: nombreDeComando(texto) === 'grupo'
      }
    )
    return porFallback ? `${respuesta}${avisoDeFallback(departamento)}` : respuesta
  } catch (err) {
    log.error?.({ err: err.message, comandoId, texto }, 'chat: fallo un comando')
    return '⚠️ No pude traer las tareas. Probá de nuevo o entrá a la plataforma.'
  }
}
