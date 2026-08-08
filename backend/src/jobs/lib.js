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

export async function listarInstancias({ calendarId, timeMin, timeMax, estado }) {
  const calendar = await getCalendar()
  const { data } = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    ...(estado ? { privateExtendedProperty: [`estado=${estado}`] } : {})
  })
  return data.items || []
}
