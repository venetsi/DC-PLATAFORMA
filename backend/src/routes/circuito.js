import { hoyEnArgentina } from '../lib/vencimiento.js'
import { armarCircuitos, estadoDelPaso, completarFila, compararFilas } from '../lib/circuito.js'

// GET /api/circuito?semana=YYYY-MM-DD (cualquier dia de la semana; sin
// parametro, la actual). Ver lib/circuito.js. Ver es de toda la organizacion,
// como el resto de las agendas.

// Cuanto para atras se miran las atrasadas que todavia frenan a un local.
const DIAS_ATRAS = 28

function correr(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

export function lunesDe(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay() // 0 domingo
  return correr(fechaISO, dia === 0 ? -6 : 1 - dia)
}

export default async function circuitoRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const hoyISO = hoyEnArgentina()
    const pedida = /^\d{4}-\d{2}-\d{2}$/.test(request.query.semana || '') ? request.query.semana : hoyISO
    const lunes = lunesDe(pedida)
    const viernes = correr(lunes, 4)

    const deps = await fastify.db.tareaAsignacionDependencia.findMany({
      where: { activa: true, asignacion: { activa: true, tarea: { activa: true } }, prerequisito: { activa: true, tarea: { activa: true } } },
      select: {
        asignacion: { select: { tarea: { select: { id: true, nombre: true, id_departamento: true } } } },
        prerequisito: { select: { tarea: { select: { id: true, nombre: true, id_departamento: true } } } }
      }
    })
    const circuitos = armarCircuitos(deps.map((d) => ({ previa: d.prerequisito.tarea, espera: d.asignacion.tarea })))
    if (!circuitos.length) return { semana: { lunes, viernes }, hoy: hoyISO, circuitos: [], sin_leer: [] }

    const idsTareas = circuitos.flatMap((c) => c.pasos.map((p) => p.id))
    const [asignaciones, departamentos] = await Promise.all([
      fastify.db.tareaAsignacion.findMany({
        where: { id_tarea: { in: idsTareas }, activa: true },
        select: { id: true, id_tarea: true, id_local_ext: true, local: { select: { nombre: true, grupo: true } } }
      }),
      fastify.db.departamento.findMany({
        where: { id: { in: [...new Set(circuitos.flatMap((c) => c.pasos.map((p) => p.id_departamento)))] } },
        select: { id: true, nombre: true, id_calendar_google: true }
      })
    ])

    // Una lectura por calendario, en paralelo; si uno falla, el resto se muestra igual.
    const duenioDe = new Map(asignaciones.map((a) => [a.id, circuitos.flatMap((c) => c.pasos).find((p) => p.id === a.id_tarea).id_departamento]))
    const conCalendario = departamentos.filter((d) => d.id_calendar_google)
    const lecturas = await Promise.allSettled(conCalendario.map((d) => fastify.gcal.listarInstancias({
      calendarId: d.id_calendar_google,
      timeMin: `${correr(lunes, -DIAS_ATRAS)}T00:00:00Z`,
      timeMax: `${viernes}T23:59:59Z`
    })))
    const instanciasDe = new Map()
    lecturas.forEach((l, i) => {
      if (l.status !== 'fulfilled') return
      const idDepto = conCalendario[i].id
      for (const ev of l.value) {
        const props = ev.extendedProperties?.private || {}
        // Solo la copia del calendario dueño: las compartidas repetirian el estado.
        if (!duenioDe.has(props.id_asignacion) || duenioDe.get(props.id_asignacion) !== idDepto) continue
        if (!instanciasDe.has(props.id_asignacion)) instanciasDe.set(props.id_asignacion, [])
        instanciasDe.get(props.id_asignacion).push(ev)
      }
    })
    const sinLeer = lecturas.flatMap((l, i) => (l.status === 'rejected' ? [conCalendario[i].nombre] : []))
    if (sinLeer.length === conCalendario.length && conCalendario.length) {
      return reply.code(502).send({ error: 'Google Calendar no respondió. Probá de nuevo en un rato.' })
    }
    const nombreDepto = new Map(departamentos.map((d) => [d.id, d.nombre]))

    return {
      semana: { lunes, viernes },
      hoy: hoyISO,
      sin_leer: sinLeer,
      circuitos: circuitos.map((c) => {
        const porLocal = new Map()
        for (const a of asignaciones) {
          const i = c.pasos.findIndex((p) => p.id === a.id_tarea)
          if (i < 0) continue
          const clave = a.id_local_ext || ''
          if (!porLocal.has(clave)) {
            porLocal.set(clave, { id_local: a.id_local_ext, local: a.local?.nombre || 'Toda la empresa', grupo: a.local?.grupo || null, pasos: c.pasos.map(() => null) })
          }
          const estado = estadoDelPaso(instanciasDe.get(a.id) || [], { lunes, viernes, hoyISO })
          porLocal.get(clave).pasos[i] = { ...estado, id_asignacion: a.id }
        }
        const filas = [...porLocal.values()].map((f) => ({ ...f, ...completarFila(f.pasos) })).sort(compararFilas)
        return {
          pasos: c.pasos.map((p) => ({ id_tarea: p.id, nombre: p.nombre, departamento: nombreDepto.get(p.id_departamento) || '' })),
          resumen: c.pasos.map((_, i) => {
            const del = filas.map((f) => f.pasos[i]).filter((p) => p && p.estado !== 'sin_fecha')
            return { total: del.length, hechos: del.filter((p) => p.estado === 'hecha' || p.estado === 'no_aplica').length, atrasados: del.filter((p) => p.estado === 'atrasada').length }
          }),
          filas
        }
      })
    }
  })
}
