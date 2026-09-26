import { timingSafeEqual } from 'node:crypto'
import { clasificarInstancia, hoyEnArgentina } from '../lib/vencimiento.js'

function clavesCoinciden(a, b) {
  const bufA = Buffer.from(String(a || ''))
  const bufB = Buffer.from(String(b || ''))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Cuantos dias hacia atras se buscan tareas vencidas sin hacer para la
// columna "Atrasadas" -- una tarea que nunca se marca realizada no debe
// desaparecer del kiosko, pero tampoco tiene sentido arrastrar backlog
// indefinido: 30 dias alcanza para ver un mes de atraso real.
const DIAS_ATRASADAS = 60

function lunesDe(fecha) {
  const diaIso = fecha.getUTCDay() === 0 ? 7 : fecha.getUTCDay()
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - (diaIso - 1)))
}

// Lunes-a-viernes de esta semana, la semana que viene, y el inicio del
// rango de atrasadas -- todo en un solo query a Calendar (timeMin/timeMax
// bien anchos) y despues se separa en baldes por fecha.
function rangos() {
  const hoy = new Date()
  const lunesEsta = lunesDe(hoy)
  const viernesEsta = new Date(Date.UTC(lunesEsta.getUTCFullYear(), lunesEsta.getUTCMonth(), lunesEsta.getUTCDate() + 4, 23, 59, 59))
  const lunesProxima = new Date(Date.UTC(lunesEsta.getUTCFullYear(), lunesEsta.getUTCMonth(), lunesEsta.getUTCDate() + 7))
  const viernesProxima = new Date(Date.UTC(lunesProxima.getUTCFullYear(), lunesProxima.getUTCMonth(), lunesProxima.getUTCDate() + 4, 23, 59, 59))
  const desdeAtrasadas = new Date(Date.UTC(lunesEsta.getUTCFullYear(), lunesEsta.getUTCMonth(), lunesEsta.getUTCDate() - DIAS_ATRASADAS))
  return { desdeAtrasadas, lunesEsta, viernesEsta, lunesProxima, viernesProxima }
}

let cacheClima = null // { data, en } -- el clima cambia mucho mas lento que las tareas
const CLIMA_TTL_MS = 30 * 60 * 1000

export default async function tvRoutes(fastify) {
  // Publica y sin cookies (auth por clave de departamento en la query, no
  // por sesion) -- header de CORS puesto a mano en vez de via @fastify/cors
  // (que ya esta registrado global con FRONTEND_URL fijo para el resto de
  // la API con credentials). Un GET simple sin headers custom no dispara
  // preflight, asi que el header en la respuesta alcanza. En produccion
  // esto ademas queda same-origin via el rewrite de Firebase Hosting.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', request.headers.origin || '*')
  })

  fastify.get('/resumen', async (request, reply) => {
    const { departamento: slug, key } = request.query
    if (!slug || !key) return reply.code(400).send({ error: 'departamento y key son requeridos' })

    const departamento = await fastify.db.departamento.findUnique({ where: { slug } })
    if (!departamento || !clavesCoinciden(key, departamento.kiosko_key)) {
      return reply.code(403).send({ error: 'Clave invalida' })
    }
    if (!departamento.id_calendar_google) {
      return { departamento: { nombre: departamento.nombre, slug }, estado_general: 'sin_datos', locales: [], eventos: [], atrasadas: [], proximaSemana: [] }
    }

    const { desdeAtrasadas, lunesEsta, viernesEsta, lunesProxima, viernesProxima } = rangos()
    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: desdeAtrasadas.toISOString(),
      timeMax: viernesProxima.toISOString()
    })

    const locales = await fastify.db.extLocal.findMany()
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))

    const porLocalHoy = {} // solo para el semaforo/KPIs, acotado al dia de hoy
    const eventos = []
    const atrasadas = []
    const proximaSemana = []
    const ahora = new Date()
    // Dia en curso en Argentina, no en UTC: con toISOString() el "hoy" del
    // kiosko cambiaba a las 21:00 hora local (ver lib/vencimiento.js).
    const hoyISO = hoyEnArgentina(ahora)
    const finEsta = viernesEsta.getTime()
    const inicioProxima = lunesProxima.getTime()
    const finProxima = viernesProxima.getTime()
    // Una tarea de hoy recien vence a la medianoche, asi que "vencidas de
    // hoy" es siempre 0: el rojo tiene que mirar todo lo atrasado de la
    // ventana, no solo el dia en curso.
    let vencidasEnVentana = 0

    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const idLocal = props.id_local_ext || null
      const { hecha, vencida, estado, noAplica, fechaISO: fechaEvento } = clasificarInstancia(evento, { referencia: ahora })
      if (noAplica) continue
      const fechaMs = new Date(`${fechaEvento}T00:00:00Z`).getTime()

      if (vencida) vencidasEnVentana++
      if (fechaEvento === hoyISO) {
        porLocalHoy[idLocal || '_general'] ??= { pendientes: 0, realizadas: 0 }
        if (hecha) porLocalHoy[idLocal || '_general'].realizadas++
        else if (!vencida) porLocalHoy[idLocal || '_general'].pendientes++
      }

      const item = {
        id: evento.id,
        // El summary del evento lleva el local/grupo (ver lib/titulo.js) para
        // que se entienda en el propio Google Calendar; acá se usa el nombre
        // limpio porque el kiosko ya agrupa por local. Fallback al summary
        // para eventos creados antes de que existiera nombre_tarea.
        titulo: props.nombre_tarea || evento.summary,
        id_local: idLocal,
        nombre_local: idLocal ? nombreLocal.get(idLocal) || 'Local sin nombre' : 'Toda la empresa',
        estado,
        asignado_a: props.asignado_a || null,
        realizada_por: props.realizada_por || null,
        inicio: evento.start?.dateTime || evento.start?.date,
        fin: evento.end?.dateTime || evento.end?.date
      }

      if (fechaMs < lunesEsta.getTime()) {
        // Atrasadas: solo lo que sigue sin hacerse -- lo ya realizado en el
        // pasado no aporta nada a "que falta resolver ya mismo".
        if (vencida) atrasadas.push(item)
      } else if (fechaMs <= finEsta) {
        eventos.push(item)
      } else if (fechaMs >= inicioProxima && fechaMs <= finProxima) {
        proximaSemana.push(item)
      }
    }

    const totalesHoy = Object.values(porLocalHoy).reduce(
      (acc, l) => ({ ...acc, pendientes: acc.pendientes + l.pendientes, realizadas: acc.realizadas + l.realizadas }),
      { pendientes: 0, realizadas: 0, vencidas: vencidasEnVentana }
    )
    const estado_general = vencidasEnVentana > 0 ? 'rojo' : totalesHoy.pendientes > 0 ? 'amarillo' : 'verde'

    return {
      actualizado: new Date().toISOString(),
      departamento: { nombre: departamento.nombre, slug },
      estado_general,
      totales: totalesHoy,
      semana: { desde: lunesEsta.toISOString().slice(0, 10), hasta: viernesEsta.toISOString().slice(0, 10) },
      eventos,
      atrasadas,
      proximaSemana
    }
  })

  // Clima del kiosko (Google Weather API), cacheado en memoria -- cambia
  // mucho mas lento que las tareas, no tiene sentido pedirlo cada 2 min.
  // Publico como /resumen: no hay nada sensible en el pronostico del tiempo.
  fastify.get('/clima', async (request, reply) => {
    if (!process.env.GOOGLE_WEATHER_API_KEY) return reply.code(501).send({ error: 'Clima no configurado' })

    if (cacheClima && Date.now() - cacheClima.en < CLIMA_TTL_MS) {
      return cacheClima.data
    }

    const url = `https://weather.googleapis.com/v1/forecast/hours:lookup`
      + `?key=${process.env.GOOGLE_WEATHER_API_KEY}`
      + `&location.latitude=${process.env.GOOGLE_WEATHER_LAT}&location.longitude=${process.env.GOOGLE_WEATHER_LON}`
      + `&hours=3&languageCode=es`
    const res = await fetch(url)
    if (!res.ok) return reply.code(502).send({ error: `Weather API respondio ${res.status}` })
    const json = await res.json()
    const horas = (json.forecastHours || []).slice(0, 3).map((h) => ({
      hora: h.displayDateTime?.hours,
      temperatura: h.temperature?.degrees != null ? Math.round(h.temperature.degrees) : null,
      icono: h.weatherCondition?.iconBaseUri ? `${h.weatherCondition.iconBaseUri}_dark.svg` : null,
      descripcion: h.weatherCondition?.description?.text || ''
    }))

    const data = { horas }
    cacheClima = { data, en: Date.now() }
    return data
  })
}
