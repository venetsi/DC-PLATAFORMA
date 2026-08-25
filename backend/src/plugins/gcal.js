import fp from 'fastify-plugin'
import { google } from 'googleapis'
import { crearAuthClient } from '../lib/gcal-auth.js'

// Backoff exponencial simple para 403/429 de cuota (recomendación de Google:
// min((2^n)+random_ms, max)). No reintenta otros códigos de error.
async function withBackoff(fn, { maxAttempts = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = err?.code || err?.response?.status
      const isQuota = status === 403 || status === 429
      if (!isQuota || attempt >= maxAttempts - 1) throw err
      const waitMs = Math.min(2 ** attempt * 1000 + Math.random() * 250, 30_000)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

// Perezoso a proposito: crearAuthClient() (impersonation) puede tardar ~15s
// en resolver, mas que el pluginTimeout default de Fastify/avvio (10s) --
// si se espera en el registro del plugin, el arranque del server falla
// intermitentemente. Se resuelve una sola vez, en el primer uso real.
let calendarPromise
function getCalendarClient() {
  calendarPromise ??= crearAuthClient().then((auth) => google.calendar({ version: 'v3', auth }))
  return calendarPromise
}

async function gcalPlugin(fastify) {
  fastify.decorate('gcal', {
    async crearCalendarioDepartamento(nombre) {
      const calendar = await getCalendarClient()
      const { data } = await withBackoff(() =>
        calendar.calendars.insert({ requestBody: { summary: nombre } })
      )
      return data.id
    },

    async crearEventoRecurrente({ calendarId, summary, startDate, endDate, recurrence, extendedProperties }) {
      const calendar = await getCalendarClient()
      const { data } = await withBackoff(() =>
        calendar.events.insert({
          calendarId,
          requestBody: {
            summary,
            start: { date: startDate },
            end: { date: endDate },
            recurrence,
            extendedProperties: { private: extendedProperties }
          }
        })
      )
      return data
    },

    // Solo el maestro -- para reprogramar toda la serie hacia adelante.
    // `summary`/`extendedProperties` son opcionales: se usan cuando ademas de
    // la recurrencia cambio el titulo o el responsable de la asignacion.
    // Las instancias ya modificadas (una marcada REALIZADA es una excepcion
    // puntual) conservan lo suyo -- Calendar no las pisa al patchear el maestro.
    async editarRecurrencia({ calendarId, eventId, recurrence, summary, extendedProperties }) {
      const calendar = await getCalendarClient()

      // Merge en vez de reemplazo: un patch con extendedProperties.private
      // completo pisa el objeto entero, y ahi se perderian las claves que
      // esta llamada no controla (estado, realizada_por, realizada_en...).
      let privateProps
      if (extendedProperties) {
        const { data: current } = await withBackoff(() => calendar.events.get({ calendarId, eventId }))
        privateProps = { ...current.extendedProperties?.private, ...extendedProperties }
      }

      const { data } = await withBackoff(() =>
        calendar.events.patch({
          calendarId,
          eventId,
          requestBody: {
            ...(recurrence ? { recurrence } : {}),
            ...(summary ? { summary } : {}),
            ...(privateProps ? { extendedProperties: { private: privateProps } } : {})
          }
        })
      )
      return data
    },

    // Cierra una serie sin borrar historial (usado al desactivar un local).
    async cerrarRecurrencia({ calendarId, eventId, untilDate }) {
      const calendar = await getCalendarClient()
      const untilRule = `UNTIL=${untilDate.replace(/-/g, '')}T000000Z`
      const { data: current } = await withBackoff(() => calendar.events.get({ calendarId, eventId }))
      const recurrence = (current.recurrence || []).map((rule) =>
        /UNTIL=/.test(rule) ? rule.replace(/UNTIL=\d{8}T\d{6}Z/, untilRule) : `${rule};${untilRule}`
      )
      return this.editarRecurrencia({ calendarId, eventId, recurrence })
    },

    // Borrado real, no reversible (a diferencia de cerrarRecurrencia) --
    // usado solo en el paso 2 de "eliminar definitivamente" una tarea, nunca
    // en la desactivacion normal. Tolera el evento ya borrado (404/410): el
    // resultado que importa (que no exista mas) ya se cumplio.
    async eliminarEvento({ calendarId, eventId }) {
      const calendar = await getCalendarClient()
      try {
        await withBackoff(() => calendar.events.delete({ calendarId, eventId }))
      } catch (err) {
        const status = err?.code || err?.response?.status
        if (status !== 404 && status !== 410) throw err
      }
    },

    // Encuentra la instancia de un dia puntual que corresponde al mismo
    // id_asignacion pero en OTRO calendario -- usado para propagar "marcar
    // realizada" entre las copias de una asignacion compartida (ver
    // TareaAsignacionDepto): cada copia vive en su propio Calendar con su
    // propio eventId de instancia, asi que no alcanza con reusar el mismo id.
    async buscarInstanciaPorFecha({ calendarId, idAsignacion, fechaISO }) {
      const calendar = await getCalendarClient()
      const { data } = await withBackoff(() =>
        calendar.events.list({
          calendarId,
          timeMin: `${fechaISO}T00:00:00Z`,
          timeMax: `${fechaISO}T23:59:59Z`,
          singleEvents: true,
          privateExtendedProperty: [`id_asignacion=${idAsignacion}`]
        })
      )
      return data.items?.[0] ?? null
    },

    // Pagina de verdad: events.list devuelve 250 por defecto y corta en
    // SILENCIO. Con 59 locales, una sola tarea diaria asignada por grupo son
    // ~1770 instancias en la ventana de 30 dias que ya usa tv.js -- sin
    // paginar, al kiosko y a los reportes simplemente les faltarian tareas
    // sin ningun error a la vista. `propiedades` generaliza el filtro por
    // extendedProperty que buscarInstanciaPorFecha ya usaba solo para
    // id_asignacion (ojo: multiples valores se combinan con AND, no OR).
    async listarInstancias({ calendarId, timeMin, timeMax, estado, propiedades, maxPaginas = 10 }) {
      const calendar = await getCalendarClient()
      const filtros = { ...(estado ? { estado } : {}), ...propiedades }
      const privateExtendedProperty = Object.entries(filtros).map(([k, v]) => `${k}=${v}`)

      const items = []
      let pageToken
      let paginas = 0
      do {
        const { data } = await withBackoff(() =>
          calendar.events.list({
            calendarId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            ...(pageToken ? { pageToken } : {}),
            ...(privateExtendedProperty.length ? { privateExtendedProperty } : {})
          })
        )
        items.push(...(data.items || []))
        pageToken = data.nextPageToken
        paginas++
      } while (pageToken && paginas < maxPaginas)

      // Nunca truncar callado: si se llego al tope, que quede en los logs.
      if (pageToken) {
        fastify.log.warn(
          { calendarId, paginas, items: items.length },
          'listarInstancias corto en maxPaginas -- hay mas eventos sin traer'
        )
      }
      return items
    },

    // Marca una instancia puntual (no el maestro) -- crea una excepcion sin
    // afectar al resto de la serie. `nuevoEstado` + `logLine` van a
    // extendedProperties.estado y se agregan a description respectivamente.
    // Al quedar REALIZADA, ademas se distingue a simple vista en el propio
    // Google Calendar (para quien la mira desde ahi via el Group compartido,
    // no solo en el checklist/kiosko de la app): gris (colorId 8=Graphite) +
    // check antepuesto al titulo. No se oculta -- events.delete/cancelar
    // la sacaria tambien de los events.list que usa la propia app.
    async marcarInstancia({ calendarId, instanceId, extendedProperties, logLine }) {
      const calendar = await getCalendarClient()
      const { data: current } = await withBackoff(() => calendar.events.get({ calendarId, eventId: instanceId }))
      const description = [current.description, logLine].filter(Boolean).join('\n')
      const esRealizada = extendedProperties?.estado === 'REALIZADA'
      const summary = esRealizada && !current.summary?.startsWith('✓ ') ? `✓ ${current.summary}` : current.summary
      const { data } = await withBackoff(() =>
        calendar.events.patch({
          calendarId,
          eventId: instanceId,
          requestBody: {
            summary,
            ...(esRealizada ? { colorId: '8' } : {}),
            description,
            extendedProperties: { private: { ...current.extendedProperties?.private, ...extendedProperties } }
          }
        })
      )
      return data
    },

    async compartirConGroup({ calendarId, groupEmail, role = 'reader' }) {
      const calendar = await getCalendarClient()
      await withBackoff(() =>
        calendar.acl.insert({ calendarId, requestBody: { role, scope: { type: 'group', value: groupEmail } } })
      )
    }
  })
}

export default fp(gcalPlugin)
