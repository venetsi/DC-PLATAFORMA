import { usuarioActual, puede, departamentosDe } from '../lib/permisos.js'
import { hoyEnArgentina, clasificarInstancia } from '../lib/vencimiento.js'
import { marcarInstanciaYPropagar } from '../lib/marcar-instancia.js'
import { reprogramarInstanciaYPropagar } from '../lib/reprogramar-instancia.js'
import { mapaDependencias, cadenaDeInstancia } from '../lib/dependencias.js'
import { ganchosDeDependencias } from '../lib/avisos-dependencias.js'

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

// Suma a cada instancia abierta lo que dicen sus dependencias (ver
// mapaDependencias): `espera_a` (lo que falta), `lista_por` (ya no falta nada)
// y `la_espera` (lo que esta frenando). Sale gratis si no hay dependencias
// cargadas: una sola consulta a Postgres, cero a Calendar.
async function conDependencias(fastify, items, activar) {
  if (!activar) return items
  const mapa = await mapaDependencias(fastify, { instancias: items })
  if (!mapa.size) return items
  return items.map((evento) => {
    const props = evento.extendedProperties?.private || {}
    const fechaISO = evento.start?.date || String(evento.start?.dateTime || '').slice(0, 10)
    const dep = mapa.get(`${props.id_asignacion}|${fechaISO}`)
    if (!dep) return evento
    return {
      ...evento,
      ...(dep.espera ? { espera_a: dep.espera } : {}),
      ...(dep.listas ? { lista_por: dep.listas } : {}),
      ...(dep.la_espera ? { la_espera: dep.la_espera } : {})
    }
  })
}

// `accion` = lo que pide la ruta (ver ACCIONES en lib/permisos.js): mirar la
// agenda es 'ver', marcar es 'marcar', mover de dia es 'editar'.
const SIN_PERMISO = {
  ver: 'No tenés acceso a este departamento',
  marcar: 'No tenés permiso para marcar tareas de este departamento',
  editar: 'Mover o editar tareas de este departamento lo puede hacer un MANAGER u OWNER del grupo'
}
async function resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, accion) {
  const usuario = await usuarioActual(fastify, request)
  if (!puede(usuario, accion, idDepartamento)) {
    reply.code(403).send({ error: SIN_PERMISO[accion] })
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
    const usuario = await usuarioActual(fastify, request)
    const [idPrincipal] = departamentosDe(usuario)
    if (!idPrincipal) return reply.code(409).send({ error: 'Tu usuario no tiene departamento asignado' })

    const departamento = await fastify.db.departamento.findUnique({ where: { id: idPrincipal } })
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
  // seria una fuga. Se leen los calendarios de TODOS los departamentos de la
  // persona (con Groups como fuente, puede estar en varios); una tarea
  // compartida entre dos de ellos tiene una copia en cada uno y se muestra una vez.
  // A proposito no incluye a Direccion "todo": son SUS tareas, no las de la empresa.
  fastify.get('/mias', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await usuarioActual(fastify, request)
    const ids = departamentosDe(usuario)
    if (!ids.length) return reply.code(409).send({ error: 'Tu usuario no tiene departamento asignado' })

    const departamentos = (await fastify.db.departamento.findMany({ where: { id: { in: ids }, activo: true }, orderBy: { nombre: 'asc' } }))
      .filter((d) => d.id_calendar_google)
    if (!departamentos.length) {
      return { departamento: null, departamentos: [], items: [], resumen: { vencidas: 0, pendientes: 0, realizadas: 0 } }
    }

    // Ventana mirando hacia atras a proposito, al reves que la vista Agenda:
    // el backlog vencido es el corazon de esta pantalla.
    const { desde, hasta, solo_mias } = request.query
    const hoyISO = hoyEnArgentina()
    const timeMin = desde ? `${desde}T00:00:00Z` : `${correrDias(hoyISO, -60)}T00:00:00Z`
    const timeMax = hasta ? `${hasta}T23:59:59Z` : `${correrDias(hoyISO, 14)}T23:59:59Z`

    const porCalendario = await Promise.all(
      departamentos.map((d) => fastify.gcal.listarInstancias({ calendarId: d.id_calendar_google, timeMin, timeMax }))
    )
    const vistas = new Set()
    const todas = porCalendario.flat().filter((evento) => {
      const props = evento.extendedProperties?.private || {}
      const fecha = evento.start?.date || String(evento.start?.dateTime || '').slice(0, 10)
      const clave = props.id_asignacion ? `${props.id_asignacion}|${fecha}` : evento.id
      if (vistas.has(clave)) return false
      vistas.add(clave)
      return true
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
      if (estado === 'no_aplica') continue
      resumen[estado === 'realizada' ? 'realizadas' : estado === 'vencida' ? 'vencidas' : 'pendientes']++
    }

    return {
      departamento: { id: departamentos[0].id, nombre: departamentos.map((d) => d.nombre).join(' + ') },
      departamentos: departamentos.map((d) => ({ id: d.id, nombre: d.nombre })),
      items: await conDependencias(fastify, items, request.query.con_dependencias !== 'false'),
      resumen
    }
  })

  // Filtro general -- ?departamento=<id>&estado=PENDIENTE, acotado a locales via extendedProperties del lado del cliente.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, estado, desde, hasta } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, 'ver')
    if (!departamento) return

    const items = await fastify.gcal.listarInstancias({
      calendarId: departamento.id_calendar_google,
      timeMin: desde ? new Date(desde).toISOString() : undefined,
      timeMax: hasta ? new Date(hasta).toISOString() : undefined,
      estado
    })
    return { items: await conDependencias(fastify, items, request.query.con_dependencias !== 'false') }
  })

  fastify.post('/:instanceId/marcar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento } = request.body || {}
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, 'marcar')
    if (!departamento) return

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })

    // El marcado + la propagacion a los departamentos compartidos viven en
    // lib/marcar-instancia.js (lo comparten esta ruta y la Chat App). Los
    // prerrequisitos AVISAN: la marca se aplica igual. Y si esta tarea era lo
    // ultimo que otra esperaba, sale el aviso de Chat "Ya podés hacerla".
    const { evento, avisos } = await marcarInstanciaYPropagar(fastify, {
      calendarId: departamento.id_calendar_google,
      instanceId: request.params.instanceId,
      emailUsuario: usuario.email,
      ...ganchosDeDependencias(fastify)
    })

    return { evento, avisos }
  })

  // La cadena de una tarea para su detalle: lo que espera (y lo que esperan
  // esas, hasta 4 niveles) y quien la espera a ella. Los otros departamentos
  // se leen con la service account, pero solo sale lo minimo (dependencias.js).
  fastify.get('/:instanceId/cadena', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, 'ver')
    if (!departamento) return

    const instancia = await fastify.gcal.leerInstancia({ calendarId: departamento.id_calendar_google, instanceId: request.params.instanceId })
    if (!instancia) return reply.code(404).send({ error: 'La tarea no existe' })
    const idAsignacion = instancia.extendedProperties?.private?.id_asignacion
    const fechaISO = instancia.start?.date || String(instancia.start?.dateTime || '').slice(0, 10)
    if (!idAsignacion || !fechaISO) return { antes: [], despues: [] }
    return cadenaDeInstancia(fastify, { idAsignacion, fechaISO })
  })

  // "No aplica": cierra la instancia sin contarla como hecha (local cerrado,
  // feriado, mes sin movimiento). Motivo obligatorio: queda en el historial.
  // Mismo permiso y misma propagacion a departamentos compartidos que marcar.
  fastify.post('/:instanceId/no-aplica', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, motivo } = request.body || {}
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    const motivoLimpio = String(motivo || '').trim().replace(/\s+/g, ' ').slice(0, 300)
    if (!motivoLimpio) return reply.code(400).send({ error: 'Contá por qué no aplica' })
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, 'marcar')
    if (!departamento) return

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    // "No aplica" tambien libera a las que esperaban (no frena dependencias).
    const { evento, yaEstaba } = await marcarInstanciaYPropagar(fastify, {
      calendarId: departamento.id_calendar_google,
      instanceId: request.params.instanceId,
      emailUsuario: usuario.email,
      estado: 'NO_APLICA',
      motivo: motivoLimpio,
      alMarcar: ganchosDeDependencias(fastify).alMarcar
    })
    if (yaEstaba) return reply.code(409).send({ error: 'Esa tarea ya estaba cerrada' })
    return { evento }
  })

  // Reprograma UNA instancia puntual a otra fecha (no el resto de la serie).
  // Mismo permiso y misma propagacion a departamentos compartidos que marcar;
  // motivo es opcional (a diferencia de "no aplica", esto no cierra nada).
  fastify.post('/:instanceId/fecha', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, fecha, motivo } = request.body || {}
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) || Number.isNaN(Date.parse(fecha))) {
      return reply.code(400).send({ error: 'fecha inválida (formato AAAA-MM-DD)' })
    }
    const departamento = await resolverDepartamentoConAcceso(fastify, request, reply, idDepartamento, 'editar')
    if (!departamento) return

    const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
    const { evento, noExiste, yaEstaba, propagadas } = await reprogramarInstanciaYPropagar(fastify, {
      calendarId: departamento.id_calendar_google,
      instanceId: request.params.instanceId,
      emailUsuario: usuario.email,
      nuevaFecha: fecha,
      motivo: motivo ? String(motivo).trim().replace(/\s+/g, ' ').slice(0, 300) : null
    })
    if (noExiste) return reply.code(404).send({ error: 'La tarea no existe' })
    if (yaEstaba) return reply.code(409).send({ error: 'Esa tarea ya está cerrada, no se puede reprogramar' })
    return { evento, propagadas }
  })

  // Preparados para Fase 9 (aprobacion real) -- no expuestos en la UI de v1.
  fastify.post('/:instanceId/aprobar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
  fastify.post('/:instanceId/rechazar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    return reply.code(501).send({ error: 'Aprobacion no activa en v1 (Fase 9)' })
  })
}
