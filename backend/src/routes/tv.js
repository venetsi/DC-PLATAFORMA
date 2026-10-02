import QRCode from 'qrcode'
import { clasificarInstancia, hoyEnArgentina } from '../lib/vencimiento.js'
import { infoDepartamentos } from '../lib/colores-depto.js'
import { crearPedido, consultarToken, resolverPantalla, formatearUserCode, vistaTv, VIDA_PEDIDO_SEG, INTERVALO_SEG } from '../lib/tv-conexion.js'
import { mapaDependencias } from '../lib/dependencias.js'

// Cuantos dias hacia atras se buscan tareas vencidas sin hacer para la
// columna "Atrasadas" -- una tarea que nunca se marca realizada no debe
// desaparecer del kiosko, pero tampoco tiene sentido arrastrar backlog
// indefinido: 60 dias alcanza para ver dos meses de atraso real.
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

function sumarDiasISO(iso, n) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}
function diaSemana(iso) { // 1 = lunes ... 7 = domingo
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() || 7
}

// Las vistas Tablero y Calendario piden mas dias que la Semana. Devuelve el
// tramo propio de la vista (fechas inclusive) o null para la Semana.
const TABLERO_ATRAS = 60
const TABLERO_ADELANTE = 30
function tramoDeVista(vista, hoyISO) {
  if (vista === 'tablero') return { desde: sumarDiasISO(hoyISO, -TABLERO_ATRAS), hasta: sumarDiasISO(hoyISO, TABLERO_ADELANTE) }
  if (vista === 'calendario') {
    // La grilla del mes: del lunes de la semana del 1 al domingo de la del ultimo dia.
    const primero = `${hoyISO.slice(0, 8)}01`
    const [a, m] = hoyISO.split('-').map(Number)
    const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
    return { desde: sumarDiasISO(primero, 1 - diaSemana(primero)), hasta: sumarDiasISO(ultimo, 7 - diaSemana(ultimo)), mes: hoyISO.slice(0, 7) }
  }
  return null
}

let cacheClima = null // { data, en } -- el clima cambia mucho mas lento que las tareas
const CLIMA_TTL_MS = 30 * 60 * 1000

// Lo leido de Calendar por departamento, 30 s: la TV consulta cada minuto y
// una de Direccion puede mostrar muchos departamentos; asi varias TVs
// comparten una lectura. 30 y no 60 para que lo que se ve tenga como mucho ~1,5 min.
const CACHE_CALENDARIO_MS = 30 * 1000
const cacheCalendario = new Map() // `${id}|${lunes}` -> { items, en }

async function instanciasDe(fastify, departamento, r) {
  const clave = `${departamento.id}|${r.timeMin}|${r.timeMax}`
  const ahora = Date.now()
  const enCache = cacheCalendario.get(clave)
  if (enCache && ahora - enCache.en < CACHE_CALENDARIO_MS) return enCache.items
  const items = await fastify.gcal.listarInstancias({
    calendarId: departamento.id_calendar_google,
    timeMin: r.timeMin,
    timeMax: r.timeMax
  })
  cacheCalendario.set(clave, { items, en: ahora })
  if (cacheCalendario.size > 200) {
    for (const [k, v] of cacheCalendario) if (ahora - v.en > CACHE_CALENDARIO_MS) cacheCalendario.delete(k)
  }
  return items
}

// Las dependencias de lo que muestra la TV, con el mismo cache de 30 s: si no
// hay ninguna cargada es una sola consulta a Postgres.
const cacheDependencias = new Map() // `${ids}|${timeMin}|${timeMax}` -> { mapa, en }
async function dependenciasDe(fastify, departamentos, r, eventos) {
  const clave = `${departamentos.map((d) => d.id).sort().join(',')}|${r.timeMin}|${r.timeMax}`
  const ahora = Date.now()
  const enCache = cacheDependencias.get(clave)
  if (enCache && ahora - enCache.en < CACHE_CALENDARIO_MS) return enCache.mapa
  const mapa = await mapaDependencias(fastify, { instancias: eventos })
  cacheDependencias.set(clave, { mapa, en: ahora })
  if (cacheDependencias.size > 50) {
    for (const [k, v] of cacheDependencias) if (ahora - v.en > CACHE_CALENDARIO_MS) cacheDependencias.delete(k)
  }
  return mapa
}

// En la TV, cada dependencia va como texto corto: el nombre, y el
// departamento o el local solo si no son los de la propia tarea.
function etiquetaDependencia(nodo, departamento, local) {
  let texto = nodo.nombre_tarea
  if (nodo.departamento && nodo.departamento !== departamento) texto += ` — ${nodo.departamento}`
  if (nodo.local && nodo.local !== local) texto += ` · ${nodo.local}`
  return texto
}

function dependenciaDelItem(dep, departamento, local) {
  if (!dep) return null
  const etiquetas = (nodos) => (nodos || []).map((n) => etiquetaDependencia(n, departamento, local))
  const resultado = {}
  if (dep.espera) resultado.espera = etiquetas(dep.espera)
  if (dep.listas) resultado.lista = etiquetas(dep.listas)
  if (dep.la_espera) resultado.la_espera = etiquetas(dep.la_espera)
  return Object.keys(resultado).length ? resultado : null
}

function tokenDe(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization || '')
  return m ? m[1] : null
}

// La TV muestra solo la parte antes de la @: no hace falta mandar el email entero.
function nombreCorto(email) {
  return email ? String(email).split('@')[0] : null
}

// Resumen del kiosko para uno o varios departamentos juntos. Cada item lleva
// su departamento (nombre, abreviatura y color, los mismos que en Mi agenda).
async function armarResumen(fastify, departamentos, vista = 'semana') {
  const r = rangos()
  const tramo = tramoDeVista(vista, hoyEnArgentina())
  const minISO = (a, b) => (a < b ? a : b)
  const maxISO = (a, b) => (a > b ? a : b)
  r.timeMin = tramo ? `${minISO(r.desdeAtrasadas.toISOString().slice(0, 10), tramo.desde)}T00:00:00.000Z` : r.desdeAtrasadas.toISOString()
  r.timeMax = tramo ? `${maxISO(r.viernesProxima.toISOString().slice(0, 10), tramo.hasta)}T23:59:59.000Z` : r.viernesProxima.toISOString()
  const activos = await fastify.db.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true } })
  const info = infoDepartamentos(activos)
  const etiqueta = (d) => ({ id: d.id, ...(info.get(d.id) || { nombre: d.nombre, abreviatura: d.nombre.slice(0, 3).toUpperCase(), color: '#8fb3bd' }) })

  // Un departamento sin calendario se saltea (antes hacia caer al kiosko), y
  // uno que falla no tumba a los demas: se informa en `sin_leer`.
  const conCalendario = departamentos.filter((d) => d.id_calendar_google)
  const lecturas = await Promise.allSettled(conCalendario.map((d) => instanciasDe(fastify, d, r)))
  const fallidas = lecturas.filter((l) => l.status === 'rejected')
  if (conCalendario.length && fallidas.length === conCalendario.length) throw fallidas[0].reason
  for (const [i, l] of lecturas.entries()) {
    if (l.status === 'rejected') fastify.log.warn({ departamento: conCalendario[i].slug, err: l.reason?.message }, 'tv: no se pudo leer el calendario')
  }

  const locales = await fastify.db.extLocal.findMany({ select: { id: true, nombre: true, grupo: true } })
  const nombreLocal = new Map(locales.map((l) => [l.id, l.nombre]))
  // Con el grupo, la TV junta la misma tarea del mismo dia en varios locales
  // del grupo: "P&L › GRUPO TITA ×3" (igual que Mi agenda).
  const grupoLocal = new Map(locales.filter((l) => l.grupo).map((l) => [l.id, l.grupo]))
  const dependencias = await dependenciasDe(
    fastify,
    conCalendario,
    r,
    lecturas.flatMap((l) => (l.status === 'fulfilled' ? l.value : []))
  )

  const porLocalHoy = {} // solo para el semaforo/KPIs, acotado al dia de hoy
  const eventos = []
  const atrasadas = []
  const proximaSemana = []
  const deLaVista = [] // Tablero: abiertas del tramo; Calendario: todo el mes
  const ahora = new Date()
  // Dia en curso en Argentina, no en UTC: con toISOString() el "hoy" del
  // kiosko cambiaba a las 21:00 hora local (ver lib/vencimiento.js).
  const hoyISO = hoyEnArgentina(ahora)
  const finEsta = r.viernesEsta.getTime()
  const inicioProxima = r.lunesProxima.getTime()
  const finProxima = r.viernesProxima.getTime()
  // Una tarea de hoy recien vence a la medianoche, asi que "vencidas de
  // hoy" es siempre 0: el rojo tiene que mirar todo lo atrasado de la
  // ventana, no solo el dia en curso.
  let vencidasEnVentana = 0

  for (const [i, lectura] of lecturas.entries()) {
    if (lectura.status !== 'fulfilled') continue
    const departamento = etiqueta(conCalendario[i])
    for (const evento of lectura.value) {
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

      const localDelItem = idLocal ? nombreLocal.get(idLocal) || 'Local sin nombre' : 'Toda la empresa'
      const dependencia = dependenciaDelItem(dependencias.get(`${props.id_asignacion}|${fechaEvento}`), departamento.nombre, localDelItem)
      const item = {
        id: evento.id,
        // El summary del evento lleva el local/grupo (ver lib/titulo.js) para
        // que se entienda en el propio Google Calendar; acá se usa el nombre
        // limpio porque el kiosko ya agrupa por local. Fallback al summary
        // para eventos creados antes de que existiera nombre_tarea.
        titulo: props.nombre_tarea || evento.summary,
        id_local: idLocal,
        nombre_local: localDelItem,
        grupo: (idLocal && grupoLocal.get(idLocal)) || null,
        estado,
        departamento,
        asignado_a: nombreCorto(props.asignado_a),
        prioridad: props.prioridad || null,
        realizada_por: nombreCorto(props.realizada_por),
        inicio: evento.start?.dateTime || evento.start?.date,
        fin: evento.end?.dateTime || evento.end?.date,
        ...(dependencia ? { dependencia } : {})
      }

      if (tramo && fechaEvento >= tramo.desde && fechaEvento <= tramo.hasta) {
        if (vista === 'calendario' || estado === 'pendiente' || estado === 'vencida') deLaVista.push({ ...item, fecha: fechaEvento })
      }

      if (fechaMs < r.lunesEsta.getTime()) {
        // Atrasadas: solo lo que sigue sin hacerse -- lo ya realizado en el
        // pasado no aporta nada a "que falta resolver ya mismo".
        if (vencida) atrasadas.push(item)
      } else if (fechaMs <= finEsta) {
        eventos.push(item)
      } else if (fechaMs >= inicioProxima && fechaMs <= finProxima) {
        proximaSemana.push(item)
      }
    }
  }

  const totalesHoy = Object.values(porLocalHoy).reduce(
    (acc, l) => ({ ...acc, pendientes: acc.pendientes + l.pendientes, realizadas: acc.realizadas + l.realizadas }),
    { pendientes: 0, realizadas: 0, vencidas: vencidasEnVentana }
  )
  const estado_general = vencidasEnVentana > 0 ? 'rojo' : totalesHoy.pendientes > 0 ? 'amarillo' : 'verde'

  return {
    actualizado: new Date().toISOString(),
    departamentos: departamentos.map(etiqueta),
    estado_general,
    totales: totalesHoy,
    semana: { desde: r.lunesEsta.toISOString().slice(0, 10), hasta: r.viernesEsta.toISOString().slice(0, 10) },
    eventos,
    atrasadas,
    proximaSemana,
    sin_leer: lecturas.flatMap((l, i) => (l.status === 'rejected' ? [conCalendario[i].nombre] : [])),
    vista,
    ...(tramo ? { tramo, items: deLaVista.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.titulo).localeCompare(String(b.titulo))) } : {})
  }
}

export default async function tvRoutes(fastify) {
  // Publicas y sin cookies: la TV se identifica con su token (header
  // Authorization), no con una sesion. En produccion quedan same-origin via
  // el rewrite /api/** del sitio del kiosko. Las rutas con sesion (aprobar una
  // conexion, administrar pantallas) viven aparte, en routes/pantallas.js,
  // para no quedar debajo de este header que refleja cualquier origen.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', request.headers.origin || '*')
  })

  // --- Conectar la TV (RFC 8628) ---

  // Pide un codigo para mostrar en la TV (QR + codigo corto). Una TV sin
  // conectar pide uno cada 10 minutos, asi que 10 por IP alcanza y sobra.
  fastify.post('/conexion', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    if (!base) return reply.code(503).send({ error: 'FRONTEND_URL no está configurada' })
    const { deviceCode, userCode } = await crearPedido(fastify.db, { userAgent: request.headers['user-agent'] })
    const codigo = formatearUserCode(userCode)
    const verification_uri = `${base}/tv`
    const verification_uri_complete = `${verification_uri}?codigo=${codigo}`
    const qr_svg = await QRCode.toString(verification_uri_complete, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    return { device_code: deviceCode, user_code: codigo, verification_uri, verification_uri_complete, expires_in: VIDA_PEDIDO_SEG, interval: INTERVALO_SEG, qr_svg }
  })

  // La TV pregunta cada `interval` segundos si ya la aprobaron. Errores con la
  // forma de la RFC (400 + { error }); el ritmo lo controla slow_down.
  fastify.post('/conexion/token', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const r = await consultarToken(fastify.db, request.body?.device_code)
    if (r.error) return reply.code(400).send(r)
    return r
  })

  // --- Datos del kiosko ---

  // Reemplaza a ?departamento=&key= (la clave en la URL quedaba en los logs y
  // era una sola para todas las TVs del departamento). 401 = la pantalla ya
  // no esta conectada (se desconecto, o quien la conecto ya no ve ninguno de
  // sus departamentos): la TV borra su token y vuelve a mostrar el QR.
  fastify.get('/resumen', async (request, reply) => {
    const resuelto = await resolverPantalla(fastify.db, tokenDe(request))
    if (!resuelto) return reply.code(401).send({ error: 'pantalla_desconectada' })
    const { pantalla, departamentos } = resuelto

    // "Ultima conexion" para la lista de pantallas, como mucho cada 10 min.
    if (!pantalla.ultima_conexion_at || Date.now() - pantalla.ultima_conexion_at.getTime() > 10 * 60 * 1000) {
      fastify.db.tvPantalla.update({ where: { id: pantalla.id }, data: { ultima_conexion_at: new Date() } })
        .catch((err) => request.log.warn({ err: err.message }, 'tv: no se pudo guardar la ultima conexion'))
    }

    const vista = vistaTv(pantalla.vista)
    const resumen = await armarResumen(fastify, departamentos, vista)
    return { ...resumen, pantalla: { nombre: pantalla.nombre, vista } }
  })

  // Clima del kiosko (Google Weather API), cacheado en memoria -- cambia
  // mucho mas lento que las tareas, no tiene sentido pedirlo cada minuto.
  // Publico: no hay nada sensible en el pronostico del tiempo.
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
