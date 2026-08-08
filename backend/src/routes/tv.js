import { timingSafeEqual } from 'node:crypto'

function clavesCoinciden(a, b) {
  const bufA = Buffer.from(String(a || ''))
  const bufB = Buffer.from(String(b || ''))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Semana de lunes a viernes que contiene "hoy" (en UTC -- alcanza para esta
// escala, no hace falta manejo de zona horaria mas fino).
function semanaLaboralActual() {
  const hoy = new Date()
  const diaIso = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay() // 1=lunes .. 7=domingo
  const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - (diaIso - 1)))
  const viernes = new Date(Date.UTC(lunes.getUTCFullYear(), lunes.getUTCMonth(), lunes.getUTCDate() + 4, 23, 59, 59))
  return { desde: lunes, hasta: viernes }
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
      return { departamento: { nombre: departamento.nombre, slug }, estado_general: 'sin_datos', locales: [], eventos: [] }
    }

    const { desde, hasta } = semanaLaboralActual()
    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString()
    })

    const locales = await fastify.db.extLocal.findMany()
    const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))

    const porLocalHoy = {} // solo para el semaforo/KPIs, acotado al dia de hoy
    const eventos = []
    const ahora = new Date()
    const hoyISO = ahora.toISOString().slice(0, 10)

    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const idLocal = props.id_local_ext || null
      const hecha = props.estado === 'REALIZADA' || props.estado === 'APROBADA'
      const vencida = !hecha && ahora > new Date(evento.end?.date || evento.end?.dateTime)
      const fechaEvento = (evento.start?.date || evento.start?.dateTime || '').slice(0, 10)

      if (fechaEvento === hoyISO) {
        porLocalHoy[idLocal || '_general'] ??= { pendientes: 0, realizadas: 0, vencidas: 0 }
        if (hecha) porLocalHoy[idLocal || '_general'].realizadas++
        else porLocalHoy[idLocal || '_general'][vencida ? 'vencidas' : 'pendientes']++
      }

      eventos.push({
        id: evento.id,
        titulo: evento.summary,
        id_local: idLocal,
        nombre_local: idLocal ? nombreLocal.get(idLocal) || 'Local sin nombre' : 'Toda la empresa',
        estado: hecha ? 'realizada' : vencida ? 'vencida' : 'pendiente',
        realizada_por: props.realizada_por || null,
        inicio: evento.start?.dateTime || evento.start?.date,
        fin: evento.end?.dateTime || evento.end?.date
      })
    }

    const totalesHoy = Object.values(porLocalHoy).reduce(
      (acc, l) => ({
        pendientes: acc.pendientes + l.pendientes,
        realizadas: acc.realizadas + l.realizadas,
        vencidas: acc.vencidas + l.vencidas
      }),
      { pendientes: 0, realizadas: 0, vencidas: 0 }
    )
    const estado_general = totalesHoy.vencidas > 0 ? 'rojo' : totalesHoy.pendientes > 0 ? 'amarillo' : 'verde'

    return {
      actualizado: new Date().toISOString(),
      departamento: { nombre: departamento.nombre, slug },
      estado_general,
      totales: totalesHoy,
      semana: { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) },
      eventos
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
