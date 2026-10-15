// Job diario (8am via Cloud Scheduler): recordatorio por departamento y
// escalamiento en dos niveles.
//
//   nivel 1 -- a los N dias habiles de atraso la tarea se destaca en el
//              mensaje del propio departamento;
//   nivel 2 -- a los M (mas) se le suma un mensaje consolidado a Direccion.
//
// Direccion SUMA, no reemplaza: el item sigue apareciendo en el aviso del
// departamento. Los umbrales salen de la columna del departamento, del
// entorno, o del default (ver lib/escalamiento.js).
//
// Si el departamento tiene un Space vinculado, el aviso sale como card con
// botones para marcar sin salir de Chat (los clicks los recibe
// routes/chat.js); si no, cae al webhook viejo en texto plano.
//
// El job no escribe NADA en el evento, a proposito -- se repite todos los dias
// mientras la tarea siga sin hacerse, que es lo que lo vuelve un reporte de
// aging en vez de una alerta unica.
//
// Los LUNES el recordatorio diario se reemplaza por el resumen semanal (ver
// lib/resumen-semanal.js): a cada departamento, sus atrasadas y la semana dia
// por dia; a Direccion, los totales por departamento, el cumplimiento de la
// semana pasada y el ranking de atrasadas por responsable. El escalamiento a
// Direccion sale igual que cualquier otro dia. AVISO_MODO=semanal|diario
// fuerza un modo (para probar sin esperar al lunes).
//
// QUE PASA CUANDO ALGO FALLA (ver lib/veredicto-avisos.js): cada departamento
// se lee y se arma por separado, y cada seccion (Spaces combinados, resumen a
// Direccion, escalamiento) tiene su propio manejo de errores: un fallo en una
// cosa no tumba el resto. Lo que fallo se le dice a Direccion en su Space y
// queda como ERROR en el log. El codigo de salida es de error SOLO si no salio
// nada habiendo algo para enviar (ahi reintentar es seguro).
import { prisma as prismaReal, listarInstancias, getCalendar } from './lib.js'
import { agruparPorTerminar, finDeSerie, mensajePorTerminar, DIAS_POR_TERMINAR } from '../lib/por-terminar.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'
import { clasificarParaAviso, resolverUmbrales } from '../lib/escalamiento.js'
import { crearTransporteChat, crearTransporteConsola, enviarEnSerie } from '../lib/notificaciones.js'
import { mensajeDepartamento, mensajeDireccion, mensajeResumenDireccion, mensajeSemanal, mensajeSemanalCombinado } from '../lib/mensajes-chat.js'
import { cardDepartamento, cardResumenDireccion, cardSemanal, cardSemanalCombinada } from '../lib/chat-cards.js'
import { infoDepartamentos } from '../lib/colores-depto.js'
import { DIAS_MINIMOS, desdeHaceNDias, finDeHoyArgentina } from '../lib/ventana-avisos.js'
import { SLUG_DIRECCION } from '../lib/direccion.js'
import { cargarFeriados } from '../lib/feriados.js'
import { mensajeProblemas, veredictoDelJob } from '../lib/veredicto-avisos.js'
import { cumplimientoDelTramo, datosSemanaDepartamento, espaciosCombinados, modoDelAviso, rankingPorResponsable, unirSinDuplicados } from '../lib/resumen-semanal.js'

// La ventana se deriva de los umbrales en vez de estar hardcodeada: si alguien
// configura "escalar a los 20 dias", una ventana fija de 14 nunca llegaria a
// verlo. El +7 da margen para que la tarea siga apareciendo despues de escalar.
function diasDeVentana(departamentos) {
  const mayor = Math.max(...departamentos.map((d) => resolverUmbrales(d).direccion), 0)
  return Math.max(DIAS_MINIMOS, mayor + 7)
}

const esperarMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Leer: lo UNICO que habla con Calendar. Si tira, el departamento queda "sin leer" ──

async function leerDiario({ listar, depto, timeMin, timeMax }) {
  // Sin filtro server-side por estado=PENDIENTE: era la definicion divergente
  // que dejaba fuera del query a los eventos SIN la property `estado`, que
  // el kiosko en cambio si contaba como vencidos.
  const items = await listar({ calendarId: depto.id_calendar_google, timeMin, timeMax, maxPaginas: 40 })
  // Una lectura truncada traeria lo mas viejo y dejaria afuera lo de hoy:
  // mejor decirlo que avisar a medias.
  if (items.truncado) throw new Error('lectura truncada: hay mas eventos de los que se pudieron traer')
  return items
}

// ── Armar: puro (sin I/O). Si tira, es un bug o un dato raro, y NO deja estado a medias ──

function armarDiario({ depto, items, umbrales, hoyISO, ahora, nombreLocal, urlApp }) {
  const baldes = clasificarParaAviso(items, { umbrales, hoyISO, referencia: ahora })
  const mensajes = []
  if (baldes.vencidas.length || baldes.pendientes_hoy.length) {
    // Se arman las DOS representaciones: la card va al Space vinculado (con
    // botones para marcar sin salir de Chat) y el texto al webhook viejo.
    mensajes.push({
      etiqueta: depto.slug,
      destino: depto,
      texto: mensajeDepartamento(depto, baldes, nombreLocal, { umbrales }),
      card: cardDepartamento(depto, baldes, nombreLocal, { umbrales, urlApp })
    })
  }
  return { baldes, mensajes }
}

// El mismo mensaje del departamento, para cada otro Space donde esta vinculado.
// El destino es una copia con ESE Space (y sin webhook: el webhook es del Space
// propio, no se repite).
export function copiasEnOtrosSpaces(depto, mensajes, compartidos) {
  const extras = [...new Set(compartidos.filter((c) => c.id_departamento === depto.id && c.chat_space_name && c.chat_space_name !== depto.chat_space_name).map((c) => c.chat_space_name))]
  return extras.flatMap((space) => mensajes.map((m) => ({
    ...m,
    etiqueta: `${m.etiqueta} → …${String(space).slice(-5)}`,
    destino: { ...depto, chat_space_name: space, chat_webhook_url: null }
  })))
}

function armarSemanal({ depto, datos, umbrales, hoyISO, ahora, nombreLocal, grupoLocal, urlApp }) {
  const baldes = clasificarParaAviso(datos.items, { umbrales, hoyISO, referencia: ahora })
  const mensajes = []
  if (datos.total || datos.vencidas.length) {
    mensajes.push({
      etiqueta: `${depto.slug} (semanal)`,
      semanalDe: depto.id,
      destino: depto,
      texto: mensajeSemanal(depto, datos, nombreLocal, { hoyISO, grupoLocal }),
      card: cardSemanal(depto, datos, nombreLocal, { hoyISO, grupoLocal, urlApp })
    })
  }
  return { baldes, mensajes }
}

// Fin de cada serie recurrente activa. Una lectura por serie (events.get), de a
// pocas a la vez: son cientos y el job corre una vez por dia.
async function leerSeriesReales({ prisma }) {
  const calendar = await getCalendar()
  const asignaciones = await prisma.tareaAsignacion.findMany({
    where: { activa: true, id_calendar_event: { not: null }, tarea: { activa: true } },
    include: { tarea: { include: { departamento: true } }, local: true }
  })
  const filas = []
  let fallidas = 0
  const cola = [...asignaciones]
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (cola.length) {
      const a = cola.pop()
      const calendarId = a.tarea.departamento.id_calendar_google
      if (!calendarId) continue
      try {
        const { data } = await calendar.events.get({ calendarId, eventId: a.id_calendar_event })
        if (data.status === 'cancelled') continue
        filas.push({
          tarea: a.tarea.nombre,
          departamento: a.tarea.departamento.nombre,
          local: a.local?.nombre || 'Toda la empresa',
          fin: finDeSerie(data.recurrence, data.start?.date || String(data.start?.dateTime || '').slice(0, 10))
        })
      } catch {
        fallidas++
      }
    }
  }))
  return { filas, fallidas }
}

export async function correr({
  prisma = prismaReal,
  listar = listarInstancias,
  cargarFeriadosFn = cargarFeriados,
  crearTransporte = (simulacion) => (simulacion ? crearTransporteConsola() : crearTransporteChat()),
  ahora = new Date(),
  leerSeries = leerSeriesReales,
  env = process.env,
  esperar = esperarMs,
  pausaEnvioMs
} = {}) {
  const feriados = await cargarFeriadosFn()
  // cargarFeriados devuelve [] si no pudo cargarlos (el calendario de feriados
  // siempre trae fechas): sin ellos los dias de atraso se cuentan de mas.
  const feriadosCargados = feriados.length > 0

  // TODOS los activos con calendario, no solo los que tienen webhook: el
  // webhook condiciona el ENVIO, no la evaluacion. Sin esto, un departamento
  // sin Space propio seria invisible tambien para Direccion.
  const [departamentos, locales] = await Promise.all([
    prisma.departamento.findMany({
      where: { activo: true, id_calendar_google: { not: null } },
      orderBy: { nombre: 'asc' }
    }),
    prisma.extLocal.findMany()
  ])
  const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
  const grupoLocal = new Map(locales.filter((l) => l.grupo).map((l) => [l.id, l.grupo]))
  const urlApp = env.FRONTEND_URL

  const hoyISO = hoyEnArgentina(ahora)
  const timeMin = desdeHaceNDias(diasDeVentana(departamentos))
  const timeMax = finDeHoyArgentina(hoyISO)

  const direccion = departamentos.find((d) => d.slug === SLUG_DIRECCION) || null
  const umbralDireccion = resolverUmbrales(direccion).direccion
  const modo = modoDelAviso(hoyISO, env.AVISO_MODO)
  const semanalHoy = modo === 'semanal'

  const mensajes = []
  const paraDireccion = []
  const configuracionAjustada = []
  let vencidasTotales = 0
  // Solo en modo semanal: lo que necesita el resumen a Direccion.
  const semanal = { filas: [], sinNada: [], sinLeer: [], vencidasPorDepto: [], items: [], semana: null }
  const candidatosSinCanal = []
  const datosPorDepto = new Map()
  // Lo que no se pudo LEER (Calendar) y lo que no se pudo ARMAR (un dato raro):
  // un error en UNO no tumba a los demas (antes abortaba el job entero y nadie
  // recibia nada).
  const erroresLectura = []
  const erroresArmado = []

  // Los Spaces donde cada departamento esta vinculado ademas de su Space propio
  // (/vincular). Un Space que cubre varios departamentos recibe lo de TODOS ellos
  // (pedido del usuario, 2026-10-15): el recordatorio diario, el resumen del
  // lunes y el aviso "Ya podes hacerla". Si no se puede leer, cada departamento
  // sigue recibiendo lo suyo en su Space propio.
  let compartidos = []
  try {
    compartidos = await prisma.departamentoCompartidoEnSpace.findMany({ select: { chat_space_name: true, id_departamento: true } })
  } catch (err) {
    erroresArmado.push({ departamento: 'Spaces combinados', error: err.message })
    console.error(`[avisos] no se pudieron leer los Spaces compartidos: ${err.message}`)
  }

  for (const depto of departamentos) {
    const umbrales = resolverUmbrales(depto)
    if (umbrales.ajustado) configuracionAjustada.push(depto.slug)

    let leido
    try {
      leido = semanalHoy
        ? await datosSemanaDepartamento({ db: prisma, gcal: { listarInstancias: listar }, log: console }, depto, { hoyISO, referencia: ahora })
        : await leerDiario({ listar, depto, timeMin, timeMax })
    } catch (err) {
      erroresLectura.push({ departamento: depto.nombre, error: err.message })
      if (semanalHoy) semanal.sinLeer.push(depto.nombre)
      console.error(`[avisos] no se pudo leer la agenda de ${depto.slug}: ${err.message}`)
      continue
    }

    // Primero se arma TODO; recien despues se publica en las listas del job.
    // Asi un fallo al armar no deja al departamento a la vez "leido" y "sin leer".
    let armado
    try {
      armado = semanalHoy
        ? armarSemanal({ depto, datos: leido, umbrales, hoyISO, ahora, nombreLocal, grupoLocal, urlApp })
        : armarDiario({ depto, items: leido, umbrales, hoyISO, ahora, nombreLocal, urlApp })
    } catch (err) {
      erroresArmado.push({ departamento: depto.nombre, error: err.message })
      console.error(`[avisos] no se pudo armar el aviso de ${depto.slug}: ${err.message}`)
      continue
    }

    const { baldes } = armado
    mensajes.push(...armado.mensajes)
    // Recordatorio diario: tambien a cada otro Space donde el departamento esta
    // vinculado (el del lunes sale en una sola tarjeta por Space, mas abajo).
    if (!semanalHoy) mensajes.push(...copiasEnOtrosSpaces(depto, armado.mensajes, compartidos))
    vencidasTotales += baldes.vencidas.length
    if (semanalHoy) {
      const datos = leido
      semanal.semana = datos.semana
      semanal.items.push(datos.items)
      semanal.vencidasPorDepto.push({ departamento: depto, vencidas: datos.vencidas })
      if (!datos.total && !datos.vencidas.length && !datos.pasada.total) semanal.sinNada.push(depto.nombre)
      else semanal.filas.push({ departamento: depto, total: datos.total, atrasadas: datos.vencidas.length, pasada: datos.pasada })
      datosPorDepto.set(depto.id, datos)
      // Con tareas esta semana pero sin donde recibir avisos: se le dice a Direccion.
      if ((datos.total || datos.vencidas.length) && !depto.chat_space_name && !depto.chat_webhook_url) candidatosSinCanal.push(depto)
    }
    if (baldes.escala_direccion.length) {
      // Se guarda el umbral CON EL QUE escaló cada departamento: con overrides
      // por departamento no hay un solo numero que describa el consolidado.
      paraDireccion.push({ departamento: depto, items: baldes.escala_direccion, umbral: umbrales.direccion })
    }
  }

  // Spaces combinados SIN dueño (gente de varios equipos, cada departamento
  // con su propio Space): reciben UNA tarjeta semanal con todos juntos. Un
  // Space propio con otros tildados (para usar comandos) sigue recibiendo solo
  // la de su departamento -- decision del usuario. El recordatorio diario va
  // siempre solo al Space propio de cada uno.
  let combinados = []
  if (semanalHoy && !erroresArmado.some((e) => e.departamento === 'Spaces combinados')) {
    try {
      // Sin dueño: siempre. Con dueño: solo si cubre 2 o mas (con un solo
      // departamento no hay nada que juntar y sale su tarjeta de siempre).
      combinados = espaciosCombinados(departamentos, compartidos)
        .filter((c) => !c.dueño || c.departamentos.length > 1)
      if (combinados.length) {
        const info = infoDepartamentos(await prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true } }))
        const nuevos = []
        for (const { space, departamentos: delSpace } of combinados) {
          const partes = delSpace.map((d) => ({ departamento: d, datos: datosPorDepto.get(d.id) })).filter((p) => p.datos)
          const sinLeer = delSpace.filter((d) => !datosPorDepto.has(d.id)).map((d) => d.nombre)
          if (!partes.some((p) => p.datos.total || p.datos.vencidas.length)) continue
          nuevos.push({
            etiqueta: `${partes.map((p) => p.departamento.slug).join('+')} (semanal, Space combinado)`,
            // El transporte postea al Space de `chat_space_name`; puede no tener dueño.
            destino: { nombre: partes.map((p) => p.departamento.nombre).join(' + '), chat_space_name: space },
            texto: mensajeSemanalCombinado(partes, nombreLocal, { hoyISO, grupoLocal, sinLeer }),
            card: cardSemanalCombinada(partes, nombreLocal, { hoyISO, grupoLocal, info, space, sinLeer, urlApp })
          })
        }
        mensajes.push(...nuevos)
        // El dueño de un Space combinado no recibe ademas SU tarjeta ahi: ya va
        // dentro de la combinada.
        const conDueño = new Set(combinados.filter((c) => c.dueño).map((c) => c.space))
        for (let i = mensajes.length - 1; i >= 0; i--) {
          if (mensajes[i].semanalDe && conDueño.has(mensajes[i].destino.chat_space_name)) mensajes.splice(i, 1)
        }
      }
    } catch (err) {
      erroresArmado.push({ departamento: 'Spaces combinados', error: err.message })
      console.error(`[avisos] no se pudieron armar los Spaces combinados: ${err.message}`)
    }
  }

  const avisosDepartamento = mensajes.length

  // Departamentos con tareas esta semana que no tienen NINGUN lugar donde
  // recibir avisos (ni Space propio, ni webhook, ni un Space combinado): por
  // ejemplo, porque sacaron la app del Space. Antes se contaban como "omitidos"
  // y nadie se enteraba.
  const idsEnCombinados = new Set(combinados.flatMap((c) => c.departamentos.map((d) => d.id)))
  const sinCanal = candidatosSinCanal.filter((d) => !idsEnCombinados.has(d.id)).map((d) => d.nombre)

  // El resumen a Direccion va ANTES que el escalamiento: es lo primero que
  // conviene leer el lunes; el escalamiento es el detalle de lo mas viejo.
  let resumenDireccion = null
  if (semanalHoy && semanal.semana) {
    try {
      // El cumplimiento global sin contar dos veces las tareas compartidas.
      const pasadaTotal = cumplimientoDelTramo(unirSinDuplicados(semanal.items), { ...semanal.semana.pasada, referencia: ahora })
      const ranking = rankingPorResponsable(semanal.vencidasPorDepto)
      const datosDireccion = { semana: semanal.semana, filas: semanal.filas, sinNada: semanal.sinNada, sinLeer: semanal.sinLeer, sinCanal, ranking, pasadaTotal, urlApp }
      const mensajeDeDireccion = direccion
        ? { etiqueta: `${direccion.slug} (resumen semanal)`, destino: direccion, texto: mensajeResumenDireccion(datosDireccion), card: cardResumenDireccion(datosDireccion) }
        : null
      resumenDireccion = { cumplimiento_semana_pasada: pasadaTotal, responsables_con_atrasadas: ranking.length }
      if (mensajeDeDireccion) mensajes.push(mensajeDeDireccion)
    } catch (err) {
      erroresArmado.push({ departamento: 'Resumen a Dirección', error: err.message })
      console.error(`[avisos] no se pudo armar el resumen a Direccion: ${err.message}`)
    }
  }

  if (paraDireccion.length && direccion) {
    try {
      // El encabezado cita el umbral solo si TODOS los departamentos escalados
      // usan el mismo; con overrides mezclados seria un numero falso, y la
      // antiguedad de cada linea ya dice lo que importa.
      const umbrales = new Set(paraDireccion.map((d) => d.umbral))
      mensajes.push({
        etiqueta: `${direccion.slug} (escalamiento)`,
        destino: direccion,
        texto: mensajeDireccion(paraDireccion, nombreLocal, { umbral: umbrales.size === 1 ? [...umbrales][0] : null })
      })
    } catch (err) {
      erroresArmado.push({ departamento: 'Escalamiento a Dirección', error: err.message })
      console.error(`[avisos] no se pudo armar el escalamiento: ${err.message}`)
    }
  }

  // Series que estan por terminar: a Direccion, los lunes (con el resumen
  // semanal) y a diario cuando a alguna le quedan 7 dias o menos.
  let seriesPorTerminar = 0
  if (direccion) {
    try {
      const { filas, fallidas } = await leerSeries({ prisma })
      const grupos = agruparPorTerminar(filas, { hoyISO })
      seriesPorTerminar = grupos.reduce((n, g) => n + g.locales.length, 0)
      if (grupos.length && (semanalHoy || grupos[0].diasMin <= 7)) {
        mensajes.push({ etiqueta: `${direccion.slug} (series por terminar)`, destino: direccion, texto: mensajePorTerminar(grupos, { dias: DIAS_POR_TERMINAR, urlApp }) })
      }
      if (fallidas) {
        erroresArmado.push({ departamento: 'Series por terminar', error: `no se pudieron leer ${fallidas} series de Calendar` })
      }
    } catch (err) {
      erroresArmado.push({ departamento: 'Series por terminar', error: err.message })
      console.error(`[avisos] no se pudo armar el aviso de series por terminar: ${err.message}`)
    }
  }

  // AVISO_DRY_RUN=1 arma y muestra los mensajes sin postear nada: sirve para
  // revisar contra datos reales antes de soltarlo en el horario real.
  const simulacion = env.AVISO_DRY_RUN === '1'
  const transporte = crearTransporte(simulacion)
  const envio = await enviarEnSerie(transporte, mensajes, { pausaMs: pausaEnvioMs ?? (simulacion ? 0 : 1100) })

  // Si algo salio mal, Direccion se entera en su Space: antes quedaba solo en
  // un log que nadie mira. Una sola advertencia por corrida, despues de la
  // pausa que pide Chat entre mensajes al mismo Space.
  const otros = feriadosCargados ? [] : ['No pude cargar los feriados: los días de atraso se contaron sin descontarlos.']
  const veredicto = veredictoDelJob({ departamentosEvaluados: departamentos.length, erroresLectura, erroresArmado, otros, mensajes: mensajes.length, envio })
  const advertencia = mensajeProblemas({ fallidos: envio.fallidos, erroresLectura, erroresArmado, otros })
  let advertencia_a_direccion = null
  if (advertencia) {
    // Si la ejecucion va a reintentarse (falla total), solo avisa el primer
    // intento: cada reintento repetiria la misma advertencia.
    const intento = Number(env.CLOUD_RUN_TASK_ATTEMPT ?? 0)
    if (veredicto.falla_total && intento > 0) {
      advertencia_a_direccion = 'omitida (reintento)'
    } else if (!direccion) {
      advertencia_a_direccion = 'direccion no encontrada'
    } else {
      if (!simulacion) await esperar(1100)
      const r = await enviarEnSerie(transporte, [{ etiqueta: `${direccion.slug} (advertencia)`, destino: direccion, texto: advertencia }], { pausaMs: 0 })
      advertencia_a_direccion = r.enviados ? 'enviada' : r.omitidos ? 'direccion sin destino' : 'fallo'
    }
    // Si Direccion no se pudo enterar, que quede en el log como ALERTA con el
    // texto completo (es lo unico que queda para una alerta de Cloud Logging).
    if (advertencia_a_direccion !== 'enviada' && advertencia_a_direccion !== 'omitida (reintento)') {
      console.error(`[avisos] ALERTA: no se pudo advertir a Direccion (${advertencia_a_direccion}). Texto:\n${advertencia}`)
    }
  }

  // Contadores explicitos para que "avisos_enviados: 0" deje de ser un
  // misterio: ahora se ve si no habia vencidas, si no habia webhooks, o si
  // los envios fallaron.
  return {
    ...(simulacion ? { simulacion: true } : {}),
    modo,
    ...(resumenDireccion ? { resumen_semanal: resumenDireccion } : {}),
    departamentos_evaluados: departamentos.length,
    departamentos_con_space: departamentos.filter((d) => d.chat_space_name).length,
    departamentos_con_webhook: departamentos.filter((d) => d.chat_webhook_url).length,
    vencidas_totales: vencidasTotales,
    avisos_departamento: avisosDepartamento,
    series_por_terminar: seriesPorTerminar,
    escaladas_a_direccion: paraDireccion.reduce((n, d) => n + d.items.length, 0),
    direccion_sin_destino: !direccion?.chat_space_name && !direccion?.chat_webhook_url,
    umbral_direccion: umbralDireccion,
    configuracion_ajustada: configuracionAjustada,
    sin_canal: sinCanal,
    feriados_cargados: feriadosCargados,
    errores_lectura: erroresLectura,
    errores_armado: erroresArmado,
    advertencia_a_direccion,
    veredicto,
    ...envio
  }
}

// Corre siempre, salvo que un test lo desactive a proposito (AVISOS_NO_EJECUTAR=1).
// A proposito NO es "correr solo si soy el modulo principal": si ese chequeo
// fallara en produccion, el job no haria nada y saldria en verde.
if (process.env.AVISOS_NO_EJECUTAR !== '1') {
  correr()
    .then((r) => {
      // "OK" solo si de verdad lo fue; los problemas salen por stderr (severidad
      // ERROR en Cloud Logging). Codigo de error SOLO si no salio nada habiendo
      // algo para enviar: ahi reintentar es seguro (ver lib/veredicto-avisos.js).
      if (r.veredicto.hubo_errores) console.error('Avisos de Chat CON PROBLEMAS:', r)
      else console.log('Avisos de Chat OK:', r)
      if (r.veredicto.falla_total) process.exitCode = 1
    })
    .catch((err) => {
      console.error('Avisos de Chat fallo:', err)
      process.exitCode = 1
    })
    .finally(() => prismaReal.$disconnect())
}
