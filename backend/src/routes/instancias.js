import { usuarioActual, puedeGestionarDepartamento } from '../lib/permisos.js'
import { hoyEnArgentina, clasificarInstancia } from '../lib/vencimiento.js'

// El "hoy" del checklist es el dia en curso en Argentina, no en UTC: antes
// cambiaba a las 21:00 hora local (ver lib/vencimiento.js). Los eventos son
// all-day, asi que el rango cubre el dia entero mas el corrimiento de zona.
function inicioDelDia(fecha = new Date()) {
  return `${hoyEnArgentina(fecha)}T00:00:00Z`
}
function finDelDia(fecha = new Date()) {
  return `${hoyEnArgentina(fecha)}T23:59:59Z`
}

function correrDias(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// dev-login guarda el email en minusculas pero el ticket SSO lo tomaba tal
// cual (ya normalizado en auth.js, pero puede haber filas viejas). Comparar
// siempre normalizado o "Mis tareas" queda vacia justo para quien entra por
// SSO real.
function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase()
}

async function resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento) {
  const usuario = await usuarioActual(fastify, request)
  if (!puedeGestionarDepartamento(usuario, idDepartamento)) {
    reply.code(403).send({ error: 'No tenes acceso a este departamento' })
    return null
  }
  const departamento = await fastify.db.departamento.findUnique({ where: { id: idDepartamento } })
  if (!departamento?.id_calendar_google) {
    reply.code(409).send({ error: 'El departamento no tiene calendario configurado' })
    return null
  }
  return departamento
}

export default async function instanciasRoutes(fastify) {
  // Checklist del dia para el departamento del usuario logueado.
  fastify.get('/hoy', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    if (!usuario?.id_departamento) return reply.code(409).send({ error: 'Tu usuario no tiene departamento asignado' })

    const departamento = await fastify.db.departamento.findUnique({ where: { id: usuario.id_departamento } })
    if (!departamento?.id_calendar_google) return { items: [] }

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: inicioDelDia(),
      timeMax: finDelDia()
    })
    return { items }
  })

  // "Mis tareas": lo que le toca a UNA persona, en vez de la agenda entera
  // del departamento.
  //
  // Devuelve dos grupos, y el segundo es el que hace que la pantalla sirva
  // desde el dia uno (hoy casi ninguna asignacion tiene responsable cargado):
  //   - asignadas      -> asignado_a == mi email
  //   - sinResponsable -> asignado_a vacio: le toca al equipo, o sea tambien a mi
  //
  // La persona sale del TOKEN, nunca de un parametro: pedir las tareas de otro
  // seria una fuga. Y como ExtUser.id_departamento es uno solo, alcanza con
  // leer el calendario propio -- las tareas compartidas entre departamentos ya
  // tienen su copia fisica en cada calendario, con el mismo asignado_a.
  fastify.get('/mias', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await usuarioActual(fastify, request)
    if (!usuario?.id_departamento) return reply.code(409).send({ error: 'Tu usuario no tiene departamento asignado' })

    const departamento = await fastify.db.departamento.findUnique({ where: { id: usuario.id_departamento } })
    if (!departamento?.id_calendar_google) {
      return { departamento: null, items: [], resumen: { vencidas: 0, pendientes: 0, realizadas: 0 } }
    }

    // Ventana mirando hacia atras a proposito, al reves que la vista Agenda:
    // el backlog vencido es el corazon de esta pantalla.
    const { desde, hasta, solo_mias } = request.query
    const hoyISO = hoyEnArgentina()
    const timeMin = desde ? `${desde}T00:00:00Z` : `${correrDias(hoyISO, -30)}T00:00:00Z`
    const timeMax = hasta ? `${hasta}T23:59:59Z` : `${correrDias(hoyISO, 14)}T23:59:59Z`

    const todas = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin,
      timeMax
    })

    // Filtrado en JS y no con privateExtendedProperty: multiples valores se
    // combinan con AND (no OR), y no hay forma de expresar "la propiedad no
    // existe" -- que es el caso de todos los eventos creados antes de que
    // asignado_a se empezara a escribir.
    const miEmail = normalizarEmail(usuario.email)
    const soloMias = solo_mias === 'true'
    const items = todas.filter((evento) => {
      const responsable = normalizarEmail(evento.extendedProperties?.private?.asignado_a)
      if (!responsable) return !soloMias
      return responsable === miEmail
    })

    const resumen = { vencidas: 0, pendientes: 0, realizadas: 0 }
    for (const evento of items) {
      const { estado } = clasificarInstancia(evento)
      resumen[estado === 'realizada' ? 'realizadas' : estado === 'vencida' ? 'vencidas' : 'pendientes']++
    }

    return {
      departamento: { id: departamento.id, nombre: departamento.nombre },
      items,
      resumen
    }
  })

  // Filtro general -- ?departamento=<id>&estado=PENDIENTE, acotado a locales via extendedProperties del lado del cliente.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, estado, desde, hasta } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento)
    if (!departamento) return

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: desde ? new Date(desde).toISOString() : undefined,
      timeMax: hasta ? new Date(hasta).toISOString() : undefined,
      estado
    })
    return { items }
  })

  fastify.post('/:instanceId/marcar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento } = request.body || {}
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento)
    if (!departamento) return

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    const ahora = new Date().toISOString()
    const extendedProperties = { estado: 'REALIZADA', realizada_por: usuario.email, realizada_en: ahora }
    const logLine = `${ahora} - REALIZADA por ${usuario.email}`
    const evento = await fastify.gcal.marcarInstancia({
      calendarId: departamento.id_calendar_google,
      instanceId: request.params.instanceId,
      extendedProperties,
      logLine
    })

    // "Un solo evento visible para ambos deptos": si esta asignacion esta
    // compartida (TareaAsignacionDepto), la misma marca se propaga a la
    // copia de cada otro departamento -- cada una vive en su propio
    // Calendar con su propio eventId de instancia, asi que hay que
    // encontrar la instancia correspondiente por fecha en cada uno.
    const idAsignacion = evento.extendedProperties?.private?.id_asignacion
    const fechaISO = evento.start?.date
    if (idAsignacion && fechaISO) {
      const asignacion = await fastify.db.tareaAsignacion.findUnique({
        where: { id: idAsignacion },
        include: { tarea: { include: { departamento: true } }, compartidas: { include: { departamento: true } } }
      })
      const otrosCalendarios = [asignacion?.tarea?.departamento, ...(asignacion?.compartidas.map((c) => c.departamento) ?? [])]
        .filter((d) => d?.id_calendar_google && d.id_calendar_google !== departamento.id_calendar_google)

      for (const otroDepartamento of otrosCalendarios) {
        const instancia = await fastify.gcal.buscarInstanciaPorFecha({
          calendarId: otroDepartamento.id_calendar_google,
          idAsignacion,
          fechaISO
        })
        if (instancia) {
          await fastify.gcal.marcarInstancia({
            calendarId: otroDepartamento.id_calendar_google,
            instanceId: instancia.id,
            extendedProperties,
            logLine
          })
        }
      }
    }

    return evento
  })

  // Preparados para Fase 9 (aprobacion real) -- no expuestos en la UI de v1.
  fastify.post('/:instanceId/aprobar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
  fastify.post('/:instanceId/rechazar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
}
