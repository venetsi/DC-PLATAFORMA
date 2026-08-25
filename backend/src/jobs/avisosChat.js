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
import { prisma, listarInstancias } from './lib.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'
import { clasificarParaAviso, resolverUmbrales } from '../lib/escalamiento.js'
import { crearTransporteChat, crearTransporteConsola, enviarEnSerie } from '../lib/notificaciones.js'
import { mensajeDepartamento, mensajeDireccion } from '../lib/mensajes-chat.js'
import { cardDepartamento } from '../lib/chat-cards.js'

const SLUG_DIRECCION = process.env.AVISO_SLUG_DIRECCION || 'direccion'
const DIAS_MINIMOS = 14 // piso historico de la ventana, aunque los umbrales sean chicos

// La ventana se deriva de los umbrales en vez de estar hardcodeada: si alguien
// configura "escalar a los 20 dias", una ventana fija de 14 nunca llegaria a
// verlo. El +7 da margen para que la tarea siga apareciendo despues de escalar.
function diasDeVentana(departamentos) {
  const mayor = Math.max(...departamentos.map((d) => resolverUmbrales(d).direccion), 0)
  return Math.max(DIAS_MINIMOS, mayor + 7)
}

function desdeHaceNDias(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

// Fin del dia de hoy en Argentina = 03:00 UTC del dia siguiente (UTC-3 todo el
// año). Con el fin del dia UTC se perdian las tareas de hoy entre las 21:00 y
// la medianoche local.
function finDeHoyArgentina(hoyISO) {
  const [a, m, d] = hoyISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + 1, 3, 0, 0)).toISOString()
}

async function correr() {
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

  const ahora = new Date()
  const hoyISO = hoyEnArgentina(ahora)
  const timeMin = desdeHaceNDias(diasDeVentana(departamentos))
  const timeMax = finDeHoyArgentina(hoyISO)

  const direccion = departamentos.find((d) => d.slug === SLUG_DIRECCION) || null
  const umbralDireccion = resolverUmbrales(direccion).direccion

  const mensajes = []
  const paraDireccion = []
  const configuracionAjustada = []
  let vencidasTotales = 0

  for (const depto of departamentos) {
    const umbrales = resolverUmbrales(depto)
    if (umbrales.ajustado) configuracionAjustada.push(depto.slug)

    // Sin filtro server-side por estado=PENDIENTE: era la definicion divergente
    // que dejaba fuera del query a los eventos SIN la property `estado`, que
    // el kiosko en cambio si contaba como vencidos.
    const items = await listarInstancias({ calendarId: depto.id_calendar_google, timeMin, timeMax })
    const baldes = clasificarParaAviso(items, { umbrales, hoyISO, referencia: ahora })
    vencidasTotales += baldes.vencidas.length

    if (baldes.escala_direccion.length) {
      // Se guarda el umbral CON EL QUE escaló cada departamento: con overrides
      // por departamento no hay un solo numero que describa el consolidado.
      paraDireccion.push({ departamento: depto, items: baldes.escala_direccion, umbral: umbrales.direccion })
    }
    if (!baldes.vencidas.length && !baldes.pendientes_hoy.length) continue

    // Se arman las DOS representaciones: la card va al Space vinculado (con
    // botones para marcar sin salir de Chat) y el texto al webhook viejo.
    mensajes.push({
      etiqueta: depto.slug,
      destino: depto,
      texto: mensajeDepartamento(depto, baldes, nombreLocal, { umbrales }),
      card: cardDepartamento(depto, baldes, nombreLocal, { umbrales, urlApp: process.env.FRONTEND_URL })
    })
  }

  const avisosDepartamento = mensajes.length
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
