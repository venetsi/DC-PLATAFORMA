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
import { SLUG_DIRECCION } from './direccion.js'
import { marcarInstanciaYPropagar } from './marcar-instancia.js'
import { prerrequisitosPendientes } from './dependencias.js'

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
  marcar: COMANDO_MARCAR,
  hecha: COMANDO_MARCAR,
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
  '`/marcar cierre` — la das por hecha',
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
  '_No hace falta escribir el nombre completo de la tarea: con una parte alcanza_',
  '_(`/tomar cierre`). Si hay más de una que coincida, te pregunto cuál._',
  '',
  '_Solo administradores:_ `/vincular` y el nombre del departamento, para que este Space reciba los recordatorios. `/desvincular` para que dejen de llegar.',
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

function unDia(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// Puede operar en Chat dentro de este departamento: el caso normal es "es de
// ese departamento, o es admin" (mismo criterio que el resto de la app, ver
// permisos.js). Dirección es la excepcion, y a proposito NO por pertenecer a
// ese departamento sino por escribir desde SU Space: el usuario eligio de
// forma explicita que el control de acceso sea "quien este en el grupo que
// cree y vincule a Dirección", no "quien tenga Dirección en su ficha" -- así
// que ni siquiera hace falta ser de Dirección para operar ahí, alcanza con
// ser un ExtUser activo. Ver [[dcsmart_tareas_plataforma]] 2026-08-26.
export function puedeOperarEnChat(usuario, departamento) {
  if (departamento?.slug === SLUG_DIRECCION) return !!usuario
  return puedeGestionarDepartamento(usuario, departamento?.id)
}

// Que departamento mira el comando: el del Space si la persona puede operar
// ahi (caso normal, el Space ES el del departamento; para el Space de
// Dirección cualquier activo puede), y si no el propio.
// Nunca devuelve uno que la persona no pueda ver -- un Space puede tener gente
// de otros equipos.
// Devuelve { departamento, porFallback }: `porFallback` es true cuando NO se
// pudo usar el del Space y se cayo al propio. Importa decirlo en la respuesta:
// sin eso, alguien parado en un Space sin vincular ve las tareas de otro
// departamento sin ninguna pista de por que -- paso de verdad, y el mensaje
// "no hay tareas pendientes 🎉" resultaba enganoso.
//
// OJO: `porFallback` tambien es la guarda de "modo todo" (ver mas abajo). Si
// alguien de Dirección escribe en un Space sin vincular, cae por fallback a
// SU propio departamento (Dirección) pero con porFallback=true -- eso NO
// activa modo todo, a proposito: el privilegio es del Space dedicado, no de
// pertenecer a Dirección (ver puedeOperarEnChat).
async function resolverDepartamento(db, { space, extUser }) {
  if (space) {
    const delSpace = await db.departamento.findUnique({ where: { chat_space_name: space } })
    if (delSpace && puedeOperarEnChat(extUser, delSpace)) {
      return { departamento: delSpace, porFallback: false }
    }
  }
  if (!extUser?.id_departamento) return { departamento: null, porFallback: false }
  const propio = await db.departamento.findUnique({ where: { id: extUser.id_departamento } })
  return { departamento: propio, porFallback: true }
}

// "Modo todo": el Space esta vinculado DIRECTAMENTE a Dirección (no por
// fallback) -- ver el comentario de resolverDepartamento. En este modo los
// comandos de lectura mezclan los 11 departamentos y los de accion pueden
// tomar/pasar/anotar la tarea de cualquiera de ellos.
function esModoTodo(departamento, porFallback) {
  return !porFallback && departamento?.slug === SLUG_DIRECCION
}

async function departamentosOperables(db) {
  return db.departamento.findMany({
    where: { activo: true, id_calendar_google: { not: null } },
    orderBy: { nombre: 'asc' }
  })
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

// Mismo encabezado de siempre, salvo en modo todo: ahi no hay UN departamento
// que nombrar.
function tituloDeAmbito(titulo, { departamento, modoTodo }) {
  return modoTodo ? `*${titulo} — Todos los departamentos*` : encabezado(titulo, departamento)
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

function sugerirSobreEventos(items) {
  const primera = items[0]
  if (!primera) return ''
  const nombre = nombreDeEvento(primera.evento)
  return nombre ? sugerir(`/marcar ${nombre}`, `/tarea ${nombre}`, `/tomar ${nombre}`) : ''
}

function sugerirSobreOperables(items) {
  const primera = items[0]
  return primera?.nombre ? sugerir(`/marcar ${primera.nombre}`, `/tarea ${primera.nombre}`, `/tomar ${primera.nombre}`) : ''
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

  const titulo = tituloDeAmbito('Hoy', { departamento, modoTodo })
  if (!pendientes.length && !hechas.length) {
    return `${titulo}\nNo hay tareas agendadas para hoy.`
  }

  const opts = { conDepartamento: modoTodo }
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

  const titulo = tituloDeAmbito('Atrasadas', { departamento, modoTodo })
  if (!vencidas.length) {
    return `${titulo}\n${sinNada('No hay nada atrasado')}`
  }

  return (
    [
      titulo,
      `${vencidas.length} sin resolver, de más vieja a más nueva:`,
      '',
      vencidas.map((i) => lineaDeTarea(i, nombreLocal, { conAntiguedad: true, conDepartamento: modoTodo })).join('\n')
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
    // persona -- pero eso solo tiene sentido DENTRO de un departamento. En
    // modo todo (Dirección viendo la empresa entera) "sin dueño" no es "mio",
    // asi que ahi se pide coincidencia exacta.
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

  const titulo = tituloDeAmbito('Mis tareas', { departamento, modoTodo })
  if (!vencidas.length && !deHoy.length && !proximas.length) {
    return `${titulo}\n${sinNada('No tenés nada pendiente')}`
  }

  const opts = { conDepartamento: modoTodo }
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

// Vincula el Space donde se escribio el comando a un departamento. Hace lo
// mismo que la card de botones que manda ADDED_TO_SPACE, para quien prefiera
// escribirlo -- y sirve cuando hay mas departamentos libres que botones en la
// card. Entre los dos caminos, nunca hace falta cargar chat_space_name por SQL.
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
  const nota =
    elegido.slug === SLUG_DIRECCION
      ? '\n\n_Este Space va a poder ver y operar sobre CUALQUIER departamento (es Dirección) -- sumá con cuidado a quién agregás acá._'
      : ''
  return `✅ Listo. Este Space queda vinculado a *${elegido.nombre}*: acá van a llegar los recordatorios diarios.${nota}`
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
  return items.map(({ evento, departamento }) => ({
    evento,
    departamento,
    nombre: evento.extendedProperties?.private?.nombre_tarea || evento.summary || '(sin nombre)',
    ...clasificarInstancia(evento)
  }))
}

// Clave de "es la misma tarea": nombre + departamento. `Tarea.nombre` es unico
// global, asi que dos nombres iguales en DOS departamentos son siempre la
// MISMA tarea compartida (TareaAsignacionDepto) con una copia de evento en
// cada calendario -- y ahi si conviene pedir que se precise, porque marcar una
// copia no marca la otra. Fuera de "modo todo" esto no cambia nada (un solo
// departamento en juego, la clave colapsa al nombre solo).
function claveDeTarea(operable) {
  return `${operable.departamento?.id}::${operable.nombre}`
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
  const etiqueta = (o) => (modoTodo && o.departamento ? `${o.nombre} (${o.departamento.nombre})` : o.nombre)

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
  if (!r.una) return pedirPrecision(r, operables, { modoTodo })

  const { evento, nombre, departamento } = r.una
  const etiqueta = modoTodo ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`

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
  if (!r.una) return pedirPrecision(r, operables, { modoTodo })

  const { evento, nombre, hecha, departamento } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta tomarla.`

  const actual = evento.extendedProperties?.private?.asignado_a
  if (actual && actual.toLowerCase() === email) return `*${nombre}* ya está a tu nombre.`

  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: { asignado_a: email },
    logLine: `${ahoraISO()} - TOMADA por ${email}${actual ? ` (antes: ${actual})` : ''}`
  })
  const etiqueta = modoTodo ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
  const cierre = sugerir(`/marcar ${nombre}`, `/nota ${nombre}: `, `/tarea ${nombre}`)
  return actual
    ? `✋ ${etiqueta} pasa de ${actual} a vos.${cierre}`
    : `✋ Listo, ${etiqueta} queda a tu nombre.${cierre}`
}

async function comandoPasar(deps, { departamentos, modoTodo, email, argumento }) {
  const { db, gcal } = deps
  const { tarea, resto: destino } = partirArgumento(argumento)

  if (!tarea || !destino) {
    return 'Necesito la tarea y el email, separados por dos puntos.\nPor ejemplo: `/pasar cierre: juan@dcsmart.app`'
  }

  const emailDestino = normalizarEmail(destino)
  const persona = await db.extUser.findUnique({ where: { email: emailDestino } })
  if (!persona?.activo) return `No encontré a *${destino}* entre los usuarios activos de la plataforma.`

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const r = buscarPorTexto(operables, tarea, hoyISO)
  if (!r.una) return pedirPrecision(r, operables, { modoTodo })

  const { evento, nombre, hecha, departamento } = r.una
  if (hecha) return `*${nombre}* ya está hecha, no hace falta pasarla.`

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
    persona.id_departamento && persona.id_departamento !== departamento.id
      ? `\n⚠️ Ojo: ${persona.nombre} no es de ${departamento.nombre}, así que esta tarea no le va a aparecer en su \`/mias\`. Avisale por las suyas.`
      : ''
  const etiqueta = modoTodo ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
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
  if (!r.una) return pedirPrecision(r, operables, { modoTodo })

  const { evento, nombre, departamento } = r.una
  await gcal.marcarInstancia({
    calendarId: departamento.id_calendar_google,
    instanceId: evento.id,
    extendedProperties: {},
    logLine: `${ahoraISO()} - NOTA de ${email}: ${nota}`
  })
  const etiqueta = modoTodo ? `*${nombre}* (${departamento.nombre})` : `*${nombre}*`
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

  const encabezadoLocal = modoTodo ? titulo : `${titulo} — ${departamento.nombre}`
  if (!relevantes.length) {
    const alcance = modoTodo ? 'en la empresa' : 'de este departamento'
    return `*${encabezadoLocal}*\nNo hay tareas ${alcance} para ${esGrupo ? 'ese grupo' : 'ese local'} en el último mes.`
  }

  const vencidas = relevantes.filter((o) => !o.hecha && o.vencida).sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
  const pendientes = relevantes.filter((o) => !o.hecha && !o.vencida)
  const hechas = relevantes.filter((o) => o.hecha)

  const linea = (o) => {
    const nl = nombrePorId.get(o.evento.extendedProperties?.private?.id_local_ext) || ''
    const partes = []
    if (elegidos.length > 1) partes.push(nl)
    if (modoTodo) partes.push(o.departamento.nombre)
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
  const hechasPeriodo = operables.filter((o) => o.hecha)
  const cerradas = hechasPeriodo.length + vencidas.length
  const cumplimiento = cerradas ? Math.round((hechasPeriodo.length / cerradas) * 100) : null

  const masVieja = vencidas
    .map((o) => ({ nombre: o.nombre, departamento: o.departamento, dias: diasHabilesVencida(o.evento, { hoyISO }) }))
    .sort((a, b) => b.dias - a.dias)[0]

  const titulo = modoTodo ? 'Resumen — Todos los departamentos' : `Resumen — ${departamento.nombre}`
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
    const deQuien = modoTodo ? ` (${masVieja.departamento.nombre})` : ''
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

  const titulo = modoTodo ? 'Equipo — Todos los departamentos' : `Equipo — ${departamento.nombre}`
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

  const departamentos = await db.departamento.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    include: { _count: { select: { tareas: true } } }
  })

  const lineas = ['*Departamentos*', '']
  for (const d of departamentos) {
    const destino = d.chat_space_name ? '💬 Space' : d.chat_webhook_url ? '🔗 webhook' : '— sin avisos'
    const cal = d.id_calendar_google ? '' : ' ⚠️ sin calendario'
    const modoTodo = d.slug === SLUG_DIRECCION ? ' · 👁️ ve todo' : ''
    const umbrales =
      d.dias_aviso_departamento || d.dias_aviso_direccion
        ? ` · umbrales ${d.dias_aviso_departamento ?? 'def'}/${d.dias_aviso_direccion ?? 'def'}`
        : ''
    lineas.push(`• *${d.nombre}* (\`${d.slug}\`) — ${d._count.tareas} tareas · ${destino}${umbrales}${cal}${modoTodo}`)
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
// pendientesParaAsignar. Fuera de "modo todo" tiene que coincidir con el
// departamento del contexto -- si no, alguien podria manipular el value del
// formulario (viene del cliente) para actuar sobre un departamento ajeno. En
// modo todo se confia el id codificado, siempre que sea un departamento
// activo con calendario: ese es justamente el privilegio de ese Space.
async function departamentoDeTareaCodificada(db, valorCodificado, { space, extUser }) {
  const { idDepartamento, instanceId } = decodificarTarea(valorCodificado)
  if (!idDepartamento || !instanceId) return { instanceId: null }

  const { departamento: contexto, porFallback } = await resolverDepartamento(db, { space, extUser })
  const modoTodo = esModoTodo(contexto, porFallback)
  if (!modoTodo && idDepartamento !== contexto?.id) return { instanceId: null }

  const departamento = await db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento?.activo || !departamento.id_calendar_google) return { instanceId: null }
  return { departamento, instanceId }
}

// { departamento, pendientes, porFallback, modoTodo } | { error }
export async function pendientesParaAsignar(deps, { space, extUser }) {
  const { db, gcal } = deps
  const { departamento, porFallback } = await resolverDepartamento(db, { space, extUser })
  if (!departamento?.id_calendar_google) {
    return { error: '⚠️ No pude resolver un departamento con calendario para este Space. Un administrador puede vincularlo escribiendo `/vincular` y el nombre del departamento.' }
  }

  const modoTodo = esModoTodo(departamento, porFallback)
  const departamentos = modoTodo ? await departamentosOperables(db) : [departamento]

  const hoyISO = hoyEnArgentina()
  const operables = await instanciasOperables(gcal, departamentos, hoyISO)
  const pendientes = operables
    .filter((o) => !o.hecha)
    .sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO)))
    .map((o) => {
      const deQuien = modoTodo ? ` — ${o.departamento.nombre}` : ''
      return {
        instanceId: codificarTarea(o.departamento.id, o.evento.id),
        etiqueta: o.vencida
          ? `${o.nombre}${deQuien} — atrasada ${diasHabilesVencida(o.evento, { hoyISO })}d`
          : o.fechaISO === hoyISO
            ? `${o.nombre}${deQuien} — hoy`
            : `${o.nombre}${deQuien} — ${o.fechaISO}`
      }
    })

  return { departamento, pendientes, porFallback, modoTodo }
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
  const { departamento, instanceId } = await departamentoDeTareaCodificada(db, valorCodificado, { space, extUser })
  if (!departamento) return '⚠️ No pude identificar la tarea (o ya no tenés acceso a ese departamento).'

  const destino = normalizarEmail(emailDestino)
  if (!destino) return '⚠️ Elegí a quién le pasás la tarea.'
  const persona = await db.extUser.findUnique({ where: { email: destino } })
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
    persona.id_departamento && persona.id_departamento !== departamento.id
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

  if (comando === COMANDO_AYUDA) {
    const { departamento, porFallback } = await resolverDepartamento(db, { space, extUser })
    return esModoTodo(departamento, porFallback) ? `${AYUDA}${AVISO_MODO_TODO}` : AYUDA
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

  const modoTodo = esModoTodo(departamento, porFallback)
  const departamentos = modoTodo ? await departamentosOperables(db) : [departamento]

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
