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

async function gcalPlugin(fastify) {
  const auth = await crearAuthClient()
  const calendar = google.calendar({ version: 'v3', auth })

  fastify.decorate('gcal', {
    calendar,

    async crearCalendarioDepartamento(nombre) {
      const { data } = await withBackoff(() =>
        calendar.calendars.insert({ requestBody: { summary: nombre } })
      )
      return data.id
    },

    async crearEventoRecurrente({ calendarId, summary, startDate, endDate, recurrence, extendedProperties }) {
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
    async editarRecurrencia({ calendarId, eventId, recurrence }) {
      const { data } = await withBackoff(() =>
        calendar.events.patch({ calendarId, eventId, requestBody: { recurrence } })
      )
      return data
    },

    // Cierra una serie sin borrar historial (usado al desactivar un local).
    async cerrarRecurrencia({ calendarId, eventId, untilDate }) {
      const untilRule = `UNTIL=${untilDate.replace(/-/g, '')}T000000Z`
      const { data: current } = await withBackoff(() => calendar.events.get({ calendarId, eventId }))
      const recurrence = (current.recurrence || []).map((rule) =>
        /UNTIL=/.test(rule) ? rule.replace(/UNTIL=\d{8}T\d{6}Z/, untilRule) : `${rule};${untilRule}`
      )
      return this.editarRecurrencia({ calendarId, eventId, recurrence })
    },

    async listarInstancias({ calendarId, timeMin, timeMax, estado }) {
      const { data } = await withBackoff(() =>
        calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          ...(estado ? { privateExtendedProperty: [`estado=${estado}`] } : {})
        })
      )
      return data.items || []
    },

    // Marca una instancia puntual (no el maestro) -- crea una excepcion sin
    // afectar al resto de la serie. `nuevoEstado` + `logLine` van a
    // extendedProperties.estado y se agregan a description respectivamente.
    async marcarInstancia({ calendarId, instanceId, extendedProperties, logLine }) {
      const { data: current } = await withBackoff(() => calendar.events.get({ calendarId, eventId: instanceId }))
      const description = [current.description, logLine].filter(Boolean).join('\n')
      const { data } = await withBackoff(() =>
        calendar.events.patch({
          calendarId,
          eventId: instanceId,
          requestBody: {
            description,
            extendedProperties: { private: { ...current.extendedProperties?.private, ...extendedProperties } }
          }
        })
      )
      return data
    },

    async compartirConGroup({ calendarId, groupEmail, role = 'reader' }) {
      await withBackoff(() =>
        calendar.acl.insert({ calendarId, requestBody: { role, scope: { type: 'group', value: groupEmail } } })
      )
    }
  })
}

export default fp(gcalPlugin)
