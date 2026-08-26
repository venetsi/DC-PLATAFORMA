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
import { hoyEnArgentina, clasificarInstancia, diasHabilesVencida } from './vencimiento.js'
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

// IDs "canonicos", que se usan solo como fallback: lo que manda es el NOMBRE
// del comando, que viene en el texto del mensaje. Se prioriza el nombre porque
// el ID lo elige a mano quien configura la app en la consola, y un numero mal
// puesto hacia que /ayuda contestara "Atrasadas" -- paso de verdad.
export const COMANDO_HOY = 1
export const COMANDO_ATRASADAS = 2
export const COMANDO_MIAS = 3
export const COMANDO_AYUDA = 4
export const COMANDO_VINCULAR = 5

const POR_NOMBRE = {
  hoy: COMANDO_HOY,
  tareas: COMANDO_HOY,
  atrasadas: COMANDO_ATRASADAS,
  vencidas: COMANDO_ATRASADAS,
  mias: COMANDO_MIAS,
  ayuda: COMANDO_AYUDA,
  help: COMANDO_AYUDA,
  vincular: COMANDO_VINCULAR
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
  '*Comandos disponibles*',
  '',
  '`/hoy` — las tareas que vencen hoy en este departamento',
  '`/atrasadas` — lo que quedó sin hacer, de más viejo a más nuevo',
  '`/mias` — las que están a tu nombre (más las del equipo sin responsable fijo)',
  '`/ayuda` — esta lista',
  '',
  '_Solo administradores:_ `/vincular <departamento>` para que este Space reciba los recordatorios.',
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
async function resolverDepartamento(db, { space, extUser }) {
  if (space) {
    const delSpace = await db.departamento.findUnique({ where: { chat_space_name: space } })
    if (delSpace && puedeGestionarDepartamento(extUser, delSpace.id)) return delSpace
  }
  if (!extUser?.id_departamento) return null
  return db.departamento.findUnique({ where: { id: extUser.id_departamento } })
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

// Comandos que necesitan resolver un departamento con calendario antes de
// correr. /vincular queda afuera: justamente sirve para ANTES de que el Space
// tenga departamento, y pedirle uno seria circular.
const HANDLERS = {
  [COMANDO_HOY]: comandoHoy,
  [COMANDO_ATRASADAS]: comandoAtrasadas,
  [COMANDO_MIAS]: comandoMias
}

// Devuelve el TEXTO de la respuesta (el envoltorio de Chat lo pone routes/chat.js).
// Nunca tira: un comando que explota tiene que contestar algo legible, no
// dejar al usuario mirando un error de Chat.
export async function ejecutarComando(deps, { comandoId, texto, space, extUser, email }) {
  const { db, gcal, log = console } = deps

  const comando = resolverComando({ comandoId, texto })
  if (comando === COMANDO_AYUDA) return AYUDA

  if (comando === COMANDO_VINCULAR) {
    try {
      return await comandoVincular({ db, log }, { space, extUser, argumento: argumentoDeComando(texto) })
    } catch (err) {
      log.error?.({ err: err.message }, 'chat: fallo /vincular')
      return '⚠️ No pude vincular el Space. Probá de nuevo.'
    }
  }

  const handler = HANDLERS[comando]
  if (!handler) {
    log.warn?.({ comandoId, texto }, 'chat: comando desconocido')
    return `No conozco ese comando.\n\n${AYUDA}`
  }

  const departamento = await resolverDepartamento(db, { space, extUser })
  if (!departamento) {
    return '⚠️ Tu usuario todavía no tiene departamento asignado. Pedile a un administrador que te lo cargue.'
  }
  if (!departamento.id_calendar_google) {
    return `⚠️ ${departamento.nombre} todavía no tiene calendario configurado.`
  }

  try {
    const locales = await db.extLocal.findMany({ select: { id: true, nombre: true } })
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
    return await handler({ db, gcal, log }, { departamento, nombreLocal, email })
  } catch (err) {
    log.error?.({ err: err.message, comandoId, texto }, 'chat: fallo un comando')
    return '⚠️ No pude traer las tareas. Probá de nuevo o entrá a la plataforma.'
  }
}
