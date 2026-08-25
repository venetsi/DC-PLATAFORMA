// Bootstrap compartido para jobs standalone (Cloud Run Job, sin servidor
// Fastify) -- mismos clientes que usan las rutas HTTP, pero instanciados
// directo aca en vez de via plugin.
import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'
import 'dotenv/config'
import { crearAuthClient } from '../lib/gcal-auth.js'

export const prisma = new PrismaClient()

let calendarPromise
export function getCalendar() {
  calendarPromise ??= crearAuthClient().then((auth) => google.calendar({ version: 'v3', auth }))
  return calendarPromise
}

// Misma paginacion que plugins/gcal.js:listarInstancias -- ver el comentario
// largo alla. Sin esto, events.list corta en 250 sin avisar y a los jobs les
// faltan tareas en silencio. (Sigue sin backoff a proposito: los jobs corren
// desatendidos y un 429 se resuelve en la corrida siguiente.)
export async function listarInstancias({ calendarId, timeMin, timeMax, estado, propiedades, maxPaginas = 10 }) {
  const calendar = await getCalendar()
  const filtros = { ...(estado ? { estado } : {}), ...propiedades }
  const privateExtendedProperty = Object.entries(filtros).map(([k, v]) => `${k}=${v}`)

  const items = []
  let pageToken
  let paginas = 0
  do {
    const { data } = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      ...(pageToken ? { pageToken } : {}),
      ...(privateExtendedProperty.length ? { privateExtendedProperty } : {})
    })
    items.push(...(data.items || []))
    pageToken = data.nextPageToken
    paginas++
  } while (pageToken && paginas < maxPaginas)

  if (pageToken) {
    console.warn(`[listarInstancias] corto en ${maxPaginas} paginas (${items.length} eventos) -- hay mas sin traer`)
  }
  return items
}
