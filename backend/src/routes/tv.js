import { timingSafeEqual } from 'node:crypto'

function clavesCoinciden(a, b) {
  const bufA = Buffer.from(String(a || ''))
  const bufB = Buffer.from(String(b || ''))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function inicioDelDia() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}
function finDelDia() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString()
}

// Publico, sin login -- protegido por una clave privada POR DEPARTAMENTO (no
// una unica clave global), asi filtrar la de un departamento no compromete a
// los demas. Ver docs/superpowers/plans -- pantalla kiosko.
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
      return { departamento: { nombre: departamento.nombre, slug }, estado_general: 'sin_datos', locales: [] }
    }

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: inicioDelDia(),
      timeMax: finDelDia()
    })

    const porLocal = {}
    const eventos = []
    const ahora = new Date()
    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const idLocal = props.id_local_ext || '_general'
      porLocal[idLocal] ??= { pendientes: 0, realizadas: 0, vencidas: 0 }

      const hecha = props.estado === 'REALIZADA' || props.estado === 'APROBADA'
      const vencida = !hecha && ahora > new Date(evento.end?.date || evento.end?.dateTime)
      if (hecha) porLocal[idLocal].realizadas++
      else porLocal[idLocal][vencida ? 'vencidas' : 'pendientes']++

      // Detalle crudo -- lo consume el kiosko para pintar la agenda tipo
      // calendario (no solo los conteos agregados).
      eventos.push({
        id: evento.id,
        titulo: evento.summary,
        id_local: idLocal === '_general' ? null : idLocal,
        estado: hecha ? 'realizada' : vencida ? 'vencida' : 'pendiente',
        realizada_por: props.realizada_por || null,
        inicio: evento.start?.dateTime || evento.start?.date,
        fin: evento.end?.dateTime || evento.end?.date
      })
    }

    const totales = Object.values(porLocal).reduce(
      (acc, l) => ({
        pendientes: acc.pendientes + l.pendientes,
        realizadas: acc.realizadas + l.realizadas,
        vencidas: acc.vencidas + l.vencidas
      }),
      { pendientes: 0, realizadas: 0, vencidas: 0 }
    )
    const estado_general = totales.vencidas > 0 ? 'rojo' : totales.pendientes > 0 ? 'amarillo' : 'verde'

    return {
      actualizado: new Date().toISOString(),
      departamento: { nombre: departamento.nombre, slug },
      estado_general,
      totales,
      locales: Object.entries(porLocal).map(([id_local, c]) => ({ id_local, ...c })),
      eventos
    }
  })
}
