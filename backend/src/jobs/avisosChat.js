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
import { prisma, listarInstancias } from './lib.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'
import { clasificarParaAviso, resolverUmbrales } from '../lib/escalamiento.js'
import { crearTransporteChat, crearTransporteConsola, enviarEnSerie } from '../lib/notificaciones.js'
import { mensajeDepartamento, mensajeDireccion, mensajeResumenDireccion, mensajeSemanal, mensajeSemanalCombinado } from '../lib/mensajes-chat.js'
import { cardDepartamento, cardResumenDireccion, cardSemanal, cardSemanalCombinada } from '../lib/chat-cards.js'
import { infoDepartamentos } from '../lib/colores-depto.js'
import { DIAS_MINIMOS, desdeHaceNDias, finDeHoyArgentina } from '../lib/ventana-avisos.js'
import { SLUG_DIRECCION } from '../lib/direccion.js'
import { cargarFeriados } from '../lib/feriados.js'
import { cumplimientoDelTramo, datosSemanaDepartamento, espaciosCombinados, modoDelAviso, rankingPorResponsable, unirSinDuplicados } from '../lib/resumen-semanal.js'

// La ventana se deriva de los umbrales en vez de estar hardcodeada: si alguien
// configura "escalar a los 20 dias", una ventana fija de 14 nunca llegaria a
// verlo. El +7 da margen para que la tarea siga apareciendo despues de escalar.
function diasDeVentana(departamentos) {
  const mayor = Math.max(...departamentos.map((d) => resolverUmbrales(d).direccion), 0)
  return Math.max(DIAS_MINIMOS, mayor + 7)
}

async function correr() {
  await cargarFeriados()
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

  const ahora = new Date()
  const hoyISO = hoyEnArgentina(ahora)
  const timeMin = desdeHaceNDias(diasDeVentana(departamentos))
  const timeMax = finDeHoyArgentina(hoyISO)

  const direccion = departamentos.find((d) => d.slug === SLUG_DIRECCION) || null
  const umbralDireccion = resolverUmbrales(direccion).direccion
  const modo = modoDelAviso(hoyISO)

  const mensajes = []
  const paraDireccion = []
  const configuracionAjustada = []
  let vencidasTotales = 0
  // Solo en modo semanal: lo que necesita el resumen a Direccion.
  const semanal = { filas: [], sinNada: [], vencidasPorDepto: [], items: [], semana: null }
  // Spaces combinados SIN dueño (gente de varios equipos, cada departamento
  // con su propio Space): reciben UNA tarjeta semanal con todos juntos. Un
  // Space propio con otros tildados (para usar comandos) sigue recibiendo solo
  // la de su departamento -- decision del usuario. El recordatorio diario va
  // siempre solo al Space propio de cada uno.
  const combinados = modo === 'semanal'
    ? espaciosCombinados(departamentos, await prisma.departamentoCompartidoEnSpace.findMany({ select: { chat_space_name: true, id_departamento: true } }))
      .filter((c) => !c.dueño)
    : []
  const datosPorDepto = new Map()

  for (const depto of departamentos) {
    const umbrales = resolverUmbrales(depto)
    if (umbrales.ajustado) configuracionAjustada.push(depto.slug)

    let baldes
    if (modo === 'semanal') {
      // Una sola lectura del calendario (60 dias atras hasta el domingo) para
      // la tarjeta semanal, el cumplimiento de la semana pasada y el
      // escalamiento, que sale igual que cualquier otro dia.
      const datos = await datosSemanaDepartamento({ db: prisma, gcal: { listarInstancias }, log: console }, depto, { hoyISO, referencia: ahora })
      baldes = clasificarParaAviso(datos.items, { umbrales, hoyISO, referencia: ahora })
      semanal.semana = datos.semana
      semanal.items.push(datos.items)
      semanal.vencidasPorDepto.push({ departamento: depto, vencidas: datos.vencidas })
      if (!datos.total && !datos.vencidas.length && !datos.pasada.total) semanal.sinNada.push(depto.nombre)
      else semanal.filas.push({ departamento: depto, total: datos.total, atrasadas: datos.vencidas.length, pasada: datos.pasada })

      datosPorDepto.set(depto.id, datos)
      if (datos.total || datos.vencidas.length) {
        mensajes.push({
          etiqueta: `${depto.slug} (semanal)`,
          destino: depto,
          texto: mensajeSemanal(depto, datos, nombreLocal, { hoyISO, grupoLocal }),
          card: cardSemanal(depto, datos, nombreLocal, { hoyISO, grupoLocal, urlApp: process.env.FRONTEND_URL })
        })
      }
    } else {
      // Sin filtro server-side por estado=PENDIENTE: era la definicion divergente
      // que dejaba fuera del query a los eventos SIN la property `estado`, que
      // el kiosko en cambio si contaba como vencidos.
      const items = await listarInstancias({ calendarId: depto.id_calendar_google, timeMin, timeMax })
      baldes = clasificarParaAviso(items, { umbrales, hoyISO, referencia: ahora })
      if (baldes.vencidas.length || baldes.pendientes_hoy.length) {
        // Se arman las DOS representaciones: la card va al Space vinculado (con
        // botones para marcar sin salir de Chat) y el texto al webhook viejo.
        mensajes.push({
          etiqueta: depto.slug,
          destino: depto,
          texto: mensajeDepartamento(depto, baldes, nombreLocal, { umbrales }),
          card: cardDepartamento(depto, baldes, nombreLocal, { umbrales, urlApp: process.env.FRONTEND_URL })
        })
      }
    }
    vencidasTotales += baldes.vencidas.length

    if (baldes.escala_direccion.length) {
      // Se guarda el umbral CON EL QUE escaló cada departamento: con overrides
      // por departamento no hay un solo numero que describa el consolidado.
      paraDireccion.push({ departamento: depto, items: baldes.escala_direccion, umbral: umbrales.direccion })
    }
  }

  if (combinados.length) {
    const info = infoDepartamentos(await prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true } }))
    for (const { space, departamentos: delSpace } of combinados) {
      const partes = delSpace.map((d) => ({ departamento: d, datos: datosPorDepto.get(d.id) })).filter((p) => p.datos)
      if (!partes.some((p) => p.datos.total || p.datos.vencidas.length)) continue
      mensajes.push({
        etiqueta: `${partes.map((p) => p.departamento.slug).join('+')} (semanal, Space combinado)`,
        // El transporte postea al Space de `chat_space_name`; puede no tener dueño.
        destino: { nombre: partes.map((p) => p.departamento.nombre).join(' + '), chat_space_name: space },
        texto: mensajeSemanalCombinado(partes, nombreLocal, { hoyISO, grupoLocal }),
        card: cardSemanalCombinada(partes, nombreLocal, { hoyISO, grupoLocal, info, space, urlApp: process.env.FRONTEND_URL })
      })
    }
  }

  const avisosDepartamento = mensajes.length

  // El resumen a Direccion va ANTES que el escalamiento: es lo primero que
  // conviene leer el lunes; el escalamiento es el detalle de lo mas viejo.
  let resumenDireccion = null
  if (modo === 'semanal' && semanal.semana) {
    // El cumplimiento global sin contar dos veces las tareas compartidas.
    const pasadaTotal = cumplimientoDelTramo(unirSinDuplicados(semanal.items), { ...semanal.semana.pasada, referencia: ahora })
    const ranking = rankingPorResponsable(semanal.vencidasPorDepto)
    const datosDireccion = { semana: semanal.semana, filas: semanal.filas, sinNada: semanal.sinNada, ranking, pasadaTotal, urlApp: process.env.FRONTEND_URL }
    resumenDireccion = { cumplimiento_semana_pasada: pasadaTotal, responsables_con_atrasadas: ranking.length }
    if (direccion) {
      mensajes.push({
        etiqueta: `${direccion.slug} (resumen semanal)`,
        destino: direccion,
        texto: mensajeResumenDireccion(datosDireccion),
        card: cardResumenDireccion(datosDireccion)
      })
    }
  }

  if (paraDireccion.length && direccion) {
    // El encabezado cita el umbral solo si TODOS los departamentos escalados
    // usan el mismo; con overrides mezclados seria un numero falso, y la
    // antiguedad de cada linea ya dice lo que importa.
    const umbrales = new Set(paraDireccion.map((d) => d.umbral))
    mensajes.push({
      etiqueta: `${direccion.slug} (escalamiento)`,
      destino: direccion,
      texto: mensajeDireccion(paraDireccion, nombreLocal, {
        umbral: umbrales.size === 1 ? [...umbrales][0] : null
      })
    })
  }

  // AVISO_DRY_RUN=1 arma y muestra los mensajes sin postear nada: sirve para
  // revisar contra datos reales antes de soltarlo en el horario real.
  const simulacion = process.env.AVISO_DRY_RUN === '1'
  const transporte = simulacion
    ? crearTransporteConsola()
    : crearTransporteChat({ db: prisma, log: console })
  const envio = await enviarEnSerie(transporte, mensajes, { pausaMs: simulacion ? 0 : 1100 })

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
    escaladas_a_direccion: paraDireccion.reduce((n, d) => n + d.items.length, 0),
    direccion_sin_destino: !direccion?.chat_space_name && !direccion?.chat_webhook_url,
    umbral_direccion: umbralDireccion,
    configuracion_ajustada: configuracionAjustada,
    ...envio
  }
}

correr()
  .then((r) => console.log('Avisos de Chat OK:', r))
  .catch((err) => {
    console.error('Avisos de Chat fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
