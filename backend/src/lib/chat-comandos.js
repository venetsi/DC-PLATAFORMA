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
import { esAdminGlobal, puedeGestionarDepartamento } from './permisos.js'

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
export const COMANDO_VINCULAR = 5
export const COMANDO_DESVINCULAR = 6
export const COMANDO_TOMAR = 7
export const COMANDO_PASAR = 8
export const COMANDO_NOTA = 9
// /asignar abre un DIALOGO (formulario modal) para elegir la tarea de una lista
// en vez de escribir su nombre.
//
// NO FUNCIONA HOY, y el experimento sirvio para delimitar el problema: el
// dialogo SI se abre (viene de un comando, canal sano) pero su envio NO llega
// nunca al endpoint -- Chat muestra "No se pudo cargar este dialogo. La app no
// responde o la respuesta no es valida". Confirma que lo roto es TODO lo que
// llega como buttonClickedPayload: botones dentro de mensajes y envios de
// dialogo por igual. /tomar por texto es el camino que funciona.
//
// Se deja el codigo entero (probado de punta a punta simulando el envio) porque
// el dia que Google destrabe ese canal vuelve a andar sin tocar nada.
export const COMANDO_ASIGNAR = 10

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
  tomar: COMANDO_TOMAR,
  pasar: COMANDO_PASAR,
  nota: COMANDO_NOTA,
  comentar: COMANDO_NOTA,
  asignar: COMANDO_ASIGNAR,
  tarea: COMANDO_TAREA,
  detalle: COMANDO_TAREA,
  local: COMANDO_LOCAL,
  grupo: COMANDO_LOCAL,
  resumen: COMANDO_RESUMEN,
  estado: COMANDO_RESUMEN,
  equipo: COMANDO_EQUIPO,
  departamentos: COMANDO_DEPARTAMENTOS
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
const DIAS_ATRASADAS = 30

const AYUDA = [
  '*Para mirar*',
  '`/hoy` — las tareas que vencen hoy en este departamento',
  '`/atrasadas` — lo que quedó sin hacer, de más viejo a más nuevo',
  '`/mias` — las que están a tu nombre (más las del equipo sin responsable fijo)',
  '',
  '*Para coordinar*',
  '`/tomar cierre` — la tarea queda a tu nombre',
  '`/pasar cierre: juan@dcsmart.app` — se la pasás a otra persona',
  '`/nota cierre: hablé con el proveedor` — dejás un comentario en el historial de la tarea',
  '',
  '*Para ver el detalle*',
  '`/tarea cierre` — en qué anda una tarea, quién la tiene y su historial',
  '`/local tiamo` — las tareas de un local (o de todo un grupo)',
  '`/resumen` — cómo viene el departamento',
  '`/equipo` — quién tiene qué',
  '',
  '_No hace falta escribir el nombre completo de la tarea: con una parte alcanza_',
  '_(`/tomar cierre`). Si hay más de una que coincida, te pregunto cuál._',
  '',
  '_Solo administradores:_ `/vincular` y el nombre del departamento, para que este Space reciba los recordatorios. `/desvincular` para que dejen de llegar.',
  '',
  '_Los recordatorios llegan solos todas las mañanas._'
].join('\n')

function unDia(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// Que departamento mira el comando: el del Space si la persona lo puede
// gestionar (caso normal, el Space ES el del departamento), y si no el propio.
// Nunca devuelve uno que la persona no pueda ver -- un Space puede tener gente
// de otros equipos.
// Devuelve { departamento, porFallback }: `porFallback` es true cuando NO se
// pudo usar el del Space y se cayo al propio. Importa decirlo en la respuesta:
// sin eso, alguien parado en un Space sin vincular ve las tareas de otro
// departamento sin ninguna pista de por que -- paso de verdad, y el mensaje
// "no hay tareas pendientes 🎉" resultaba enganoso.
async function resolverDepartamento(db, { space, extUser }) {
  if (space) {
    const delSpace = await db.departamento.findUnique({ where: { chat_space_name: space } })
    if (delSpace && puedeGestionarDepartamento(extUser, delSpace.id)) {
      return { departamento: delSpace, porFallback: false }
    }
  }
  if (!extUser?.id_departamento) return { departamento: null, porFallback: false }
  const propio = await db.departamento.findUnique({ where: { id: extUser.id_departamento } })
  return { departamento: propio, porFallback: true }
}

// Aviso que se agrega cuando el departamento no salio del Space.
function avisoDeFallback(departamento) {
  return (
    `\n\n_Este Space no está vinculado a ningún departamento, así que te muestro las de *${departamento.nombre}* (el tuyo)._` +
    '\n_Un administrador puede vincularlo escribiendo_ `/vincular` _y el nombre del departamento._'
  )
}

function encabezado(titulo, departamento) {
  return `*${titulo} — ${departamento.nombre}*`
}

function sinNada(texto) {
  return `${texto} 🎉`
}

async function instanciasDelRango(gcal, departamento, { desdeISO, hastaISO }) {
  return gcal.listarInstancias({
    calendarId: departamento.id_calendar_google,
    timeMin: `${desdeISO}T00:00:00Z`,
    timeMax: `${hastaISO}T23:59:59Z`
  })
}

async function comandoHoy(deps, { departamento, nombreLocal }) {
  const hoyISO = hoyEnArgentina()
  const items = await instanciasDelRango(deps.gcal, departamento, { desdeISO: hoyISO, hastaISO: hoyISO })

  const pendientes = []
  const hechas = []
  for (const evento of items) {
    const { hecha, fechaISO } = clasificarInstancia(evento)
    if (fechaISO !== hoyISO) continue
    ;(hecha ? hechas : pendientes).push({ evento, dias: 0 })
  }

  if (!pendientes.length && !hechas.length) {
    return `${encabezado('Hoy', departamento)}\nNo hay tareas agendadas para hoy.`
  }

  const bloques = [encabezado('Hoy', departamento)]
  if (pendientes.length) {
    bloques.push(`\n🕒 *Pendientes (${pendientes.length}):*\n${pendientes.map((i) => lineaDeTarea(i, nombreLocal)).join('\n')}`)
  } else {
    bloques.push(`\n${sinNada('Todo lo de hoy está hecho')}`)
  }
  if (hechas.length) {
    bloques.push(`\n✅ *Hechas (${hechas.length}):*\n${hechas.map((i) => lineaDeTarea(i, nombreLocal)).join('\n')}`)
  }
  return bloques.join('\n')
}

async function comandoAtrasadas(deps, { departamento, nombreLocal }) {
  const hoyISO = hoyEnArgentina()
  const items = await instanciasDelRango(deps.gcal, departamento, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: hoyISO
  })

  const vencidas = []
  for (const evento of items) {
    const { hecha, vencida } = clasificarInstancia(evento)
    if (hecha || !vencida) continue
    vencidas.push({ evento, dias: diasHabilesVencida(evento, { hoyISO }) })
  }
  vencidas.sort((a, b) => b.dias - a.dias)

  if (!vencidas.length) {
    return `${encabezado('Atrasadas', departamento)}\n${sinNada('No hay nada atrasado')}`
  }

  return [
    encabezado('Atrasadas', departamento),
    `${vencidas.length} sin resolver, de más vieja a más nueva:`,
    '',
    vencidas.map((i) => lineaDeTarea(i, nombreLocal, { conAntiguedad: true })).join('\n')
  ].join('\n')
}

async function comandoMias(deps, { departamento, nombreLocal, email }) {
  const hoyISO = hoyEnArgentina()
  // Misma ventana que la pantalla "Mis tareas": mira mas hacia atras que hacia
  // adelante, porque lo que importa es el backlog.
  const items = await instanciasDelRango(deps.gcal, departamento, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: unDia(hoyISO, 14)
  })

  const vencidas = []
  const deHoy = []
  const proximas = []
  for (const evento of items) {
    const props = evento.extendedProperties?.private || {}
    const responsable = String(props.asignado_a || '').toLowerCase().trim()
    // Sin responsable fijo = le toca al equipo, y por lo tanto tambien a esta
    // persona. Es lo que hace que la vista sirva desde el dia uno.
    if (responsable && responsable !== email) continue

    const { hecha, vencida, fechaISO } = clasificarInstancia(evento)
    if (hecha) continue
    if (vencida) vencidas.push({ evento, dias: diasHabilesVencida(evento, { hoyISO }) })
    // Lo de hoy va aparte de lo que viene despues: una tarea que vence hoy no
    // es "por venir", y mezclarlas esconde justo la que hay que hacer ya.
    else if (fechaISO === hoyISO) deHoy.push({ evento, dias: 0 })
    else proximas.push({ evento, dias: 0 })
  }
  vencidas.sort((a, b) => b.dias - a.dias)

  if (!vencidas.length && !deHoy.length && !proximas.length) {
    return `${encabezado('Mis tareas', departamento)}\n${sinNada('No tenés nada pendiente')}`
  }

  const bloques = [encabezado('Mis tareas', departamento)]
  if (vencidas.length) {
    bloques.push(`\n⚠️ *Atrasadas (${vencidas.length}):*\n${vencidas.map((i) => lineaDeTarea(i, nombreLocal, { conAntiguedad: true })).join('\n')}`)
  }
  if (deHoy.length) {
    bloques.push(`\n🕒 *Hoy (${deHoy.length}):*\n${deHoy.map((i) => lineaDeTarea(i, nombreLocal)).join('\n')}`)
  }
  if (proximas.length) {
    bloques.push(`\n📅 *Próximos días (${proximas.length}):*\n${proximas.map((i) => lineaDeTarea(i, nombreLocal)).join('\n')}`)
  }
  return bloques.join('\n')
}

// Vincula el Space donde se escribio el comando a un departamento. Reemplaza
// la card de botones que se usaba antes (los botones `action` no funcionan),
// y sigue siendo lo unico que evita cargar chat_space_name por SQL a mano.
async function comandoVincular(deps, { space, extUser, argumento }) {
  const { db, log = console } = deps

  if (!esAdminGlobal(extUser)) {
    return '⚠️ Solo un administrador puede vincular este Space a un departamento.'
  }
  if (!space) return '⚠️ No pude identificar este Space.'

  const yaVinculado = await db.departamento.findUnique({ where: { chat_space_name: space } })
  if (yaVinculado) {
    return `Este Space ya está vinculado a *${yaVinculado.nombre}*. Para cambiarlo, desvinculalo primero desde la plataforma.`
  }

  const libres = await db.departamento.findMany({
    where: { activo: true, chat_space_name: null },
    select: { id: true, nombre: true, slug: true },
    orderBy: { nombre: 'asc' }
  })
  const comoElegir = libres.map((d) => `• \`/vincular ${d.slug}\` — ${d.nombre}`).join('\n')

  if (!argumento) {
    return `¿A qué departamento vinculo este Space?\n\n${comoElegir}`
  }

  // Se acepta el slug o el nombre, sin distinguir acentos ni mayusculas: quien
  // escribe el comando no tiene por que saber cual es el slug exacto.
  const buscado = sinAcentos(argumento)
  const elegido = libres.find((d) => sinAcentos(d.slug) === buscado || sinAcentos(d.nombre) === buscado)

  if (!elegido) {
    return `No encontré un departamento libre que se llame "${argumento}".\n\n${comoElegir}`
  }

  await db.departamento.update({ where: { id: elegido.id }, data: { chat_space_name: space } })
  log.info?.({ space, departamento: elegido.slug }, 'chat: space vinculado por comando')
  return `✅ Listo. Este Space queda vinculado a *${elegido.nombre}*: acá van a llegar los recordatorios diarios.`
}

// ── Comandos que operan sobre UNA tarea ───────────────────────────────────
//
// La tarea se identifica por texto parcial de su nombre, NO por un numero de
// una lista previa: entre que alguien mira /hoy y escribe el comando, otra
// persona puede marcar algo y correr la numeracion, y el comando terminaria
// aplicandose a la tarea equivocada. El texto no tiene ese problema, y la
// respuesta siempre nombra la tarea sobre la que se actuo para que un match
// erroneo se vea al instante.

async function instanciasOperables(gcal, departamento, hoyISO) {
  const items = await instanciasDelRango(gcal, departamento, {
    desdeISO: unDia(hoyISO, -DIAS_ATRASADAS),
    hastaISO: unDia(hoyISO, 14)
  })
  return items.map((evento) => ({
    evento,
    nombre: evento.extendedProperties?.private?.nombre_tarea || evento.summary || '(sin nombre)',
    ...clasificarInstancia(evento)
  }))
}

// { una } | { varias } | { ninguna }
function buscarPorTexto(operables, texto, hoyISO) {
  const q = sinAcentos(texto)
  if (!q) return { ninguna: true }

  const exactas = operables.filter((o) => sinAcentos(o.nombre) === q)
  const candidatas = exactas.length ? exactas : operables.filter((o) => sinAcentos(o.nombre).includes(q))
  if (!candidatas.length) return { ninguna: true }

  // Varias instancias de LA MISMA tarea (una recurrente cae muchos dias) no es
  // ambiguedad real: se elige la de hoy, y si no hay, la mas atrasada. Solo se
  // pide precisar cuando son tareas distintas.
  const nombres = new Set(candidatas.map((c) => c.nombre))
  if (nombres.size > 1) return { varias: candidatas }

  const deHoy = candidatas.find((c) => c.fechaISO === hoyISO)
  if (deHoy) return { una: deHoy }
  const ordenadas = [...candidatas].sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
  return { una: ordenadas[0] }
}

function pedirPrecision(resultado, operables) {
  if (resultado.varias) {
    const opciones = [...new Set(resultado.varias.map((c) => c.nombre))].map((n) => `• ${n}`).join('\n')
    return `Hay más de una tarea que coincide. ¿Cuál?\n\n${opciones}`
  }
  const disponibles = [...new Set(operables.filter((o) => !o.hecha).map((o) => o.nombre))]
  if (!disponibles.length) return 'No encontré esa tarea, y no hay ninguna pendiente en este departamento.'
  return `No encontré esa tarea. Las pendientes son:\n\n${disponibles.map((n) => `• ${n}`).join('\n')}`
}

// Se usa marcarInstancia para las tres: mergea extendedProperties con las que
// ya tiene y appendea al historial del evento. Solo pone el ✓ y el gris cuando
// se le pasa estado REALIZADA, asi que aca no marca nada como hecho.
function ahoraISO() {
  return new Date().toISOString()
}

async function comandoTomar(deps, { departamento, email, argumento }) {
  const { gcal } = deps
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  const r = buscarPorTexto(operables, argumento, hoyISO)
  if (!r.una) return pedirPrecision(r, operables)

  const { evento, nombre, hecha } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta tomarla.`

  const actual = evento.extendedProperties?.private?.asignado_a
  if (actual && actual.toLowerCase() === email) return `*${nombre}* ya está a tu nombre.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: { asignado_a: email },
    logLine: `${ahoraISO()} - TOMADA por ${email}${actual ? ` (antes: ${actual})` : ''}`
  })
  return actual
    ? `✋ *${nombre}* pasa de ${actual} a vos.`
    : `✋ Listo, *${nombre}* queda a tu nombre.`
}

async function comandoPasar(deps, { departamento, email, argumento }) {
  const { db, gcal } = deps
  const { tarea, resto: destino } = partirArgumento(argumento)

  if (!tarea || !destino) {
    return 'Necesito la tarea y el email, separados por dos puntos.\nPor ejemplo: `/pasar cierre: juan@dcsmart.app`'
  }

  const emailDestino = normalizarEmail(destino)
  const persona = await db.extUser.findUnique({ where: { email: emailDestino } })
  if (!persona?.activo) return `No encontré a *${destino}* entre los usuarios activos de la plataforma.`

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  const r = buscarPorTexto(operables, tarea, hoyISO)
  if (!r.una) return pedirPrecision(r, operables)

  const { evento, nombre, hecha } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta pasarla.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: { asignado_a: emailDestino },
    logLine: `${ahoraISO()} - REASIGNADA a ${emailDestino} por ${email}`
  })

  // Se avisa cuando la persona es de otro departamento: el sistema lo permite,
  // pero esa tarea no le va a aparecer en su /mias (que mira su propio
  // departamento), asi que puede no enterarse nunca.
  const aviso =
    persona.id_departamento && persona.id_departamento !== departamento.id
      ? `\n⚠️ Ojo: ${persona.nombre} no es de ${departamento.nombre}, así que esta tarea no le va a aparecer en su \`/mias\`. Avisale por las suyas.`
      : ''
  return `➡️ *${nombre}* queda a nombre de ${persona.nombre} (${emailDestino}).${aviso}`
}

async function comandoNota(deps, { departamento, email, argumento }) {
  const { gcal } = deps
  const { tarea, resto: nota } = partirArgumento(argumento)

  if (!tarea || !nota) {
    return 'Necesito la tarea y la nota, separadas por dos puntos.\nPor ejemplo: `/nota cierre: hablé con el proveedor, viene el jueves`'
  }

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  // A diferencia de /tomar y /pasar, aca SI se puede anotar una tarea ya hecha:
  // dejar constancia despues de cerrarla es un caso legitimo.
  const r = buscarPorTexto(operables, tarea, hoyISO)
  if (!r.una) return pedirPrecision(r, operables)

  const { evento, nombre } = r.una
  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: {},
    logLine: `${ahoraISO()} - NOTA de ${email}: ${nota}`
  })
  return `📝 Anotado en *${nombre}*:\n_${nota}_`
}

// ── Comandos de status ────────────────────────────────────────────────────

const MAX_LINEAS_HISTORIAL = 6

// Detalle de UNA tarea: en que anda, quien la tiene, de que depende, y su
// historial. Es el que cierra el circulo de /nota: sin esto las notas se
// escriben en el historial del evento y no hay forma de leerlas desde Chat.
async function comandoTarea(deps, { departamento, nombreLocal, argumento }) {
  const { db, gcal } = deps
  if (!argumento) return 'Decime parte del nombre de la tarea. Por ejemplo: `/tarea cierre`'

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  const r = buscarPorTexto(operables, argumento, hoyISO)
  if (!r.una) return pedirPrecision(r, operables)

  const { evento, nombre, hecha, vencida, fechaISO } = r.una
  const props = evento.extendedProperties?.private || {}
  const local = props.id_local_ext ? nombreLocal.get(props.id_local_ext) || 'Local sin nombre' : 'Toda la empresa'

  const estado = hecha
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

  return lineas.join('\n')
}

// Tareas de un local, o de todos los locales de un grupo. Acepta las dos cosas
// con el mismo comando: 22 de los 32 grupos tienen UN solo local, asi que un
// /grupo aparte no aportaria nada y seria un comando mas para configurar.
async function comandoLocal(deps, { departamento, argumento, preferirGrupo }) {
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
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  const nombrePorId = new Map(locales.map((l) => [l.id, l.nombre]))

  const relevantes = operables.filter((o) => {
    const idLocal = o.evento.extendedProperties?.private?.id_local_ext
    return idLocal && idsElegidos.has(idLocal)
  })

  if (!relevantes.length) {
    return `*${titulo} — ${departamento.nombre}*\nNo hay tareas de este departamento para ${esGrupo ? 'ese grupo' : 'ese local'} en el último mes.`
  }

  const vencidas = relevantes.filter((o) => !o.hecha && o.vencida).sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
  const pendientes = relevantes.filter((o) => !o.hecha && !o.vencida)
  const hechas = relevantes.filter((o) => o.hecha)

  const linea = (o) => {
    const nl = nombrePorId.get(o.evento.extendedProperties?.private?.id_local_ext) || ''
    const cuantos = elegidos.length > 1 ? ` — ${nl}` : ''
    const atraso = o.vencida ? ` _(hace ${diasHabilesVencida(o.evento, { hoyISO })}d)_` : ''
    return `• ${o.nombre}${cuantos}${atraso}`
  }

  const bloques = [`*${titulo} — ${departamento.nombre}*`]
  if (vencidas.length) bloques.push(`\n⚠️ *Atrasadas (${vencidas.length}):*\n${vencidas.map(linea).join('\n')}`)
  if (pendientes.length) bloques.push(`\n🕒 *Pendientes (${pendientes.length}):*\n${pendientes.map(linea).join('\n')}`)
  if (hechas.length) bloques.push(`\n✅ ${hechas.length} ${hechas.length === 1 ? 'hecha' : 'hechas'} en el período.`)
  return bloques.join('\n')
}

// Numeros del departamento: la respuesta a "¿cómo venimos?".
async function comandoResumen(deps, { departamento }) {
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(deps.gcal, departamento, hoyISO)

  const hoy = operables.filter((o) => o.fechaISO === hoyISO)
  const vencidas = operables.filter((o) => !o.hecha && o.vencida)
  const hechasPeriodo = operables.filter((o) => o.hecha)
  const cerradas = hechasPeriodo.length + vencidas.length
  const cumplimiento = cerradas ? Math.round((hechasPeriodo.length / cerradas) * 100) : null

  const masVieja = vencidas
    .map((o) => ({ nombre: o.nombre, dias: diasHabilesVencida(o.evento, { hoyISO }) }))
    .sort((a, b) => b.dias - a.dias)[0]

  const lineas = [
    `*Resumen — ${departamento.nombre}*`,
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
  if (masVieja) lineas.push(`\nLa más atrasada: *${masVieja.nombre}*, hace ${masVieja.dias} días hábiles.`)
  if (!vencidas.length && !hoy.filter((o) => !o.hecha).length) lineas.push(`\n${sinNada('Al día')}`)
  return lineas.join('\n')
}

// Carga por persona: quien tiene que y cuanto atraso arrastra.
async function comandoEquipo(deps, { departamento }) {
  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(deps.gcal, departamento, hoyISO)
  const pendientes = operables.filter((o) => !o.hecha)

  if (!pendientes.length) return `*Equipo — ${departamento.nombre}*\n${sinNada('No hay nada pendiente')}`

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

  const lineas = [`*Equipo — ${departamento.nombre}*`, '']
  for (const [quien, { total, atrasadas, peor }] of filas) {
    const etiqueta = quien === SIN_DUENO ? '_Sin responsable (las hace el equipo)_' : quien
    const detalle = atrasadas
      ? `${total} pendientes, *${atrasadas} atrasadas* (la peor, hace ${peor}d)`
      : `${total} pendientes, al día`
    lineas.push(`• ${etiqueta} — ${detalle}`)
  }
  return lineas.join('\n')
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

  const departamentos = await db.departamento.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    include: { _count: { select: { tareas: true } } }
  })

  const lineas = ['*Departamentos*', '']
  for (const d of departamentos) {
    const destino = d.chat_space_name ? '💬 Space' : d.chat_webhook_url ? '🔗 webhook' : '— sin avisos'
    const cal = d.id_calendar_google ? '' : ' ⚠️ sin calendario'
    const umbrales =
      d.dias_aviso_departamento || d.dias_aviso_direccion
        ? ` · umbrales ${d.dias_aviso_departamento ?? 'def'}/${d.dias_aviso_direccion ?? 'def'}`
        : ''
    lineas.push(`• *${d.nombre}* (\`${d.slug}\`) — ${d._count.tareas} tareas · ${destino}${umbrales}${cal}`)
  }

  const sinDestino = departamentos.filter((d) => !d.chat_space_name && !d.chat_webhook_url).length
  if (sinDestino) {
    lineas.push(`\n_${sinDestino} sin Space ni webhook: sus tareas atrasadas escalan a Dirección pero no reciben su propio recordatorio._`)
  }
  return lineas.join('\n')
}

// ── Apoyo del dialogo experimental (/asignar) ─────────────────────────────
//
// Devuelven estructura en vez de texto, porque un dialogo no es un mensaje:
// lo arma chat-cards.js y lo despacha routes/chat.js.

// { departamento, pendientes } | { error }
export async function pendientesParaAsignar(deps, { space, extUser }) {
  const { db, gcal } = deps
  const { departamento, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento?.id_calendar_google) {
    return { error: '⚠️ No pude resolver un departamento con calendario para este Space. Un administrador puede vincularlo escribiendo `/vincular` y el nombre del departamento.' }
  }

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamento, hoyISO)
  const pendientes = operables
    .filter((o) => !o.hecha)
    .sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
    .map((o) => ({
      instanceId: o.evento.id,
      etiqueta: o.vencida
        ? `${o.nombre} — atrasada ${diasHabilesVencida(o.evento, { hoyISO })}d`
        : o.fechaISO === hoyISO
          ? `${o.nombre} — hoy`
          : `${o.nombre} — ${o.fechaISO}`
    }))

  return { departamento, pendientes, porFallback }
}

// Toma una instancia por su id (viene del dialogo). El id se re-verifica contra
// Calendar igual, y el departamento se resuelve por el Space: lo que llega del
// formulario no decide permisos.
export async function tomarPorInstanceId(deps, { space, extUser, email, instanceId }) {
  const { db, gcal, log = console } = deps
  const { departamento } = await resolverDepartamento(db, { space, extUser })
  if (!departamento?.id_calendar_google) return '⚠️ Este Space no está vinculado a ningún departamento.'
  if (!instanceId) return '⚠️ No pude identificar la tarea.'

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
  log.info?.({ instanceId, email }, 'chat: tarea tomada desde el dialogo')
  return `✋ ${nombre} queda a tu nombre.`
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

  await db.departamento.update({ where: { id: actual.id }, data: { chat_space_name: null } })
  log.info?.({ space, departamento: actual.slug }, 'chat: space desvinculado por comando')
  return `✅ Listo. Este Space ya no recibe los recordatorios de *${actual.nombre}*.\nPara volver a activarlo: \`/vincular ${actual.slug}\``
}

// Comandos que necesitan resolver un departamento con calendario antes de
// correr. /vincular y /desvincular quedan afuera: operan sobre el vinculo del
// Space, y pedirles un departamento ya resuelto seria circular.
const HANDLERS = {
  [COMANDO_HOY]: comandoHoy,
  [COMANDO_ATRASADAS]: comandoAtrasadas,
  [COMANDO_MIAS]: comandoMias,
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
  if (comando === COMANDO_AYUDA) return AYUDA

  if (comando === COMANDO_VINCULAR || comando === COMANDO_DESVINCULAR) {
    const esVincular = comando === COMANDO_VINCULAR
    try {
      return esVincular
        ? await comandoVincular({ db, log }, { space, extUser, argumento: argumentoDeComando(texto) })
        : await comandoDesvincular({ db, log }, { space, extUser })
    } catch (err) {
      log.error?.({ err: err.message, comando }, 'chat: fallo el (des)vinculado')
      return `⚠️ No pude ${esVincular ? 'vincular' : 'desvincular'} el Space. Probá de nuevo.`
    }
  }

  const handler = HANDLERS[comando]
  if (!handler) {
    log.warn?.({ comandoId, texto }, 'chat: comando desconocido')
    return `No conozco ese comando.\n\n${AYUDA}`
  }

  const { departamento, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento) {
    return '⚠️ Tu usuario todavía no tiene departamento asignado. Pedile a un administrador que te lo cargue.'
  }
  if (!departamento.id_calendar_google) {
    return `⚠️ ${departamento.nombre} todavía no tiene calendario configurado.`
  }

  try {
    const locales = await db.extLocal.findMany({ select: { id: true, nombre: true } })
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
    const respuesta = await handler(
      { db, gcal, log },
      {
        departamento,
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
