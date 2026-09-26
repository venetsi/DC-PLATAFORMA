import { google } from 'googleapis'
import { crearAuthClient } from './gcal-auth.js'
import { definirFeriados } from './vencimiento.js'

// Feriados nacionales desde el calendario publico de Google. Solo cuentan los
// marcados "Día festivo": el mismo calendario trae fechas conmemorativas
// ("Celebración": Día de la Madre, Pascuas judías...) que no son no laborables.
const CALENDARIO_FERIADOS = 'es.ar#holiday@group.v.calendar.google.com'

export async function cargarFeriados({ log = console } = {}) {
  try {
    const calendar = google.calendar({ version: 'v3', auth: await crearAuthClient() })
    const anio = new Date().getUTCFullYear()
    const { data } = await calendar.events.list({
      calendarId: CALENDARIO_FERIADOS,
      timeMin: `${anio - 1}-01-01T00:00:00Z`,
      timeMax: `${anio + 2}-01-01T00:00:00Z`,
      singleEvents: true,
      maxResults: 500
    })
    const fechas = (data.items || [])
      .filter((e) => String(e.description || '').startsWith('Día festivo') && e.start?.date)
      .map((e) => e.start.date)
    definirFeriados(fechas)
    log.info?.({ feriados: fechas.length }, 'feriados cargados')
    return fechas
  } catch (err) {
    // Sin feriados se sigue contando lunes a viernes, como antes: no se corta nada.
    log.warn?.({ err: err.message }, 'no se pudieron cargar los feriados')
    return []
  }
}
