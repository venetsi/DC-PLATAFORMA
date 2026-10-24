import { usuarioActual, puede, esAdminGlobal } from '../lib/permisos.js'
import { definirAgenda, cerrarAsignacion, reabrirAsignacion } from '../lib/agenda.js'
import { leerRecurrence } from '../lib/recurrencia.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'

// CRUD del catalogo de Tarea (nombre + departamento fijo). Admin global
// gestiona cualquier departamento; un usuario de departamento gestiona
// solo el propio -- y ninguno de los dos puede desactivarla salvo admin
// (ver el chequeo de `activa` en PATCH).
export default async function tareasRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento, incluirInactivas } = request.query
    const usuario = await usuarioActual(fastify, request)
    // Las inactivas solo las pide un admin (para llegar a "Eliminar
    // definitivamente") -- todos los demas listados del resto de la app
    // siguen viendo solo el catalogo activo, sin cambios.
    const soloActivas = !(incluirInactivas === 'true' && esAdminGlobal(usuario))
    return fastify.db.tarea.findMany({
      where: { ...(soloActivas ? { activa: true } : {}), ...(departamento ? { id_departamento: departamento } : {}) },
      orderBy: { nombre: 'asc' }
    })
  })

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { nombre, id_departamento, descripcion } = request.body || {}
    if (!nombre || !id_departamento) {
      return reply.code(400).send({ error: 'nombre e id_departamento son requeridos' })
    }

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', id_departamento)) {
      return reply.code(403).send({ error: 'Crear tareas lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    const tarea = await fastify.db.tarea.create({ data: { nombre, id_departamento, descripcion } })
    return reply.code(201).send(tarea)
  })

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const existente = await fastify.db.tarea.findUnique({
      where: { id: request.params.id },
      include: { departamento: true }
    })
    if (!existente) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', existente.id_departamento)) {
      return reply.code(403).send({ error: 'Editar tareas lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    const { nombre, descripcion, activa } = request.body || {}
    // Desactivar pide OWNER del grupo (o Direccion): un MANAGER crea y edita, no borra.
    if (activa !== undefined && !puede(usuario, 'administrar', existente.id_departamento)) {
      return reply.code(403).send({ error: 'Desactivar una tarea lo puede hacer un OWNER del grupo del departamento' })
    }

    // Al desactivar, cierra hacia adelante (UNTIL, nunca events.delete) la
    // recurrencia de cada asignacion activa con evento propio -- mismo
    // patron que reconciliar.js ya usa al desactivarse un local. Sin esto,
    // el evento seguia apareciendo en el checklist/kiosko para siempre: la
    // tarea solo desaparecia del catalogo de admin, nada mas. Si alguna
    // asignacion esta compartida con otros departamentos (TareaAsignacionDepto),
    // tambien se cierra la copia de cada uno -- son el mismo evento
    // conceptualmente, tienen que dejar de repetirse juntas.
    if (activa === false && existente.activa !== false) {
      const asignaciones = await fastify.db.tareaAsignacion.findMany({
        where: { id_tarea: existente.id, activa: true },
        include: { compartidas: { include: { departamento: true } } }
      })
      for (const asignacion of asignaciones) {
        await cerrarAsignacion(fastify, { ...asignacion, tarea: existente })
      }
    }

    // Reactivar: vuelven los locales que se apagaron JUNTO con la tarea (los
    // que se cerraron en ese mismo momento; `updated_at` de la tarea es el de
    // la desactivacion). Los que ya se habian quitado antes, uno por uno, siguen
    // afuera. Existe porque "Desactivar" en la fila de la tarea se confundia con
    // sacar un local, y no habia forma de volver atras (2026-09-29).
    let reactivadas = null
    if (activa === true && existente.activa === false) {
      const momento = existente.updated_at.getTime()
      const asignaciones = await fastify.db.tareaAsignacion.findMany({
        where: {
          id_tarea: existente.id,
          activa: false,
          updated_at: { gte: new Date(momento - 30 * 60 * 1000), lte: new Date(momento + 60 * 1000) }
        },
        include: { tarea: { include: { departamento: true } }, local: true, compartidas: { include: { departamento: true } } }
      })
      reactivadas = { locales: 0, errores: [] }
      for (const asignacion of asignaciones) {
        try {
          await reabrirAsignacion(fastify, asignacion)
          reactivadas.locales++
        } catch (err) {
          fastify.log.warn({ err: err.message, idAsignacion: asignacion.id }, 'tareas: no se pudo reactivar un local')
          reactivadas.errores.push(`${asignacion.local?.nombre || 'Toda la empresa'}: ${err.message}`)
        }
      }
    }

    const tarea = await fastify.db.tarea.update({
      where: { id: request.params.id },
      data: { nombre, descripcion, ...(activa !== undefined ? { activa } : {}) }
    })
    return reactivadas ? { ...tarea, reactivadas } : tarea
  })

  // Duplica una tarea: nombre nuevo (Tarea.nombre es unico global), mismo o
  // otro departamento, y opcionalmente la misma agenda -- una asignacion nueva
  // por cada asignacion activa del original (mismo local, responsable y
  // departamentos compartidos), agendada con la regla del original leida de su
  // maestro en Calendar y definirAgenda (la misma logica que el formulario).
  // La agenda copiada rige desde hoy: nunca crea vencidas retroactivas. Las
  // dependencias NO se copian (apuntan a asignaciones puntuales del original).
  fastify.post('/:id/duplicar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const original = await fastify.db.tarea.findUnique({ where: { id: request.params.id }, include: { departamento: true } })
    if (!original) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const { nombre: nombreRaw, id_departamento: idDestinoRaw, copiar_agenda = true } = request.body || {}
    const nombre = String(nombreRaw || '').trim()
    if (!nombre) return reply.code(400).send({ error: 'Poné un nombre para la copia' })
    const idDestino = idDestinoRaw || original.id_departamento

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', original.id_departamento) || !puede(usuario, 'editar', idDestino)) {
      return reply.code(403).send({ error: 'Solo podés duplicar tareas entre tus departamentos' })
    }
    const destino = await fastify.db.departamento.findUnique({ where: { id: idDestino } })
    if (!destino?.activo) return reply.code(400).send({ error: 'Departamento de destino inválido' })

    let copia
    try {
      copia = await fastify.db.tarea.create({ data: { nombre, id_departamento: idDestino, descripcion: original.descripcion } })
    } catch (err) {
      if (err.code === 'P2002') return reply.code(409).send({ error: `Ya existe una tarea llamada "${nombre}"` })
      throw err
    }

    const resultado = { tarea: copia, asignaciones: 0, agendadas: 0, sin_agenda: 0, errores: [] }
    if (!copiar_agenda) return reply.code(201).send(resultado)

    const asignaciones = await fastify.db.tareaAsignacion.findMany({
      where: { id_tarea: original.id, activa: true },
      include: { local: true, compartidas: { include: { departamento: true } } }
    })
    const hoy = hoyEnArgentina()

    for (const origen of asignaciones) {
      const etiqueta = origen.local?.nombre || 'Toda la empresa'
      try {
        const nueva = await fastify.db.tareaAsignacion.create({
          data: { id_tarea: copia.id, id_local_ext: origen.id_local_ext, asignado_a: origen.asignado_a }
        })
        const compartidas = origen.compartidas
          .filter((c) => c.departamento.activo && c.id_departamento !== idDestino)
          .map((c) => ({ id_asignacion: nueva.id, id_departamento: c.id_departamento }))
        if (compartidas.length) await fastify.db.tareaAsignacionDepto.createMany({ data: compartidas, skipDuplicates: true })
        resultado.asignaciones++

        // Agenda del original, leida de su maestro (la base no la guarda).
        const maestro = origen.id_calendar_event && original.departamento.id_calendar_google
          ? await fastify.gcal.leerInstancia({ calendarId: original.departamento.id_calendar_google, instanceId: origen.id_calendar_event })
          : null
        const agenda = maestro ? leerRecurrence(maestro.recurrence, maestro.start?.date) : null
        // Una fecha unica que ya paso no se copia: naceria vencida.
        if (!agenda || (agenda.recurrencia_tipo === 'UNICA' && agenda.recurrencia_config?.fecha < hoy)) {
          resultado.sin_agenda++
          continue
        }

        const conIncludes = await fastify.db.tareaAsignacion.findUnique({
          where: { id: nueva.id },
          include: { tarea: { include: { departamento: true } }, local: true, compartidas: { include: { departamento: true } } }
        })
        await definirAgenda(fastify, conIncludes, {
          recurrencia_tipo: agenda.recurrencia_tipo,
          recurrencia_config: agenda.recurrencia_config,
          vigencia_desde: agenda.vigencia_desde > hoy ? agenda.vigencia_desde : hoy,
          vigencia_hasta: null, // horizonte nuevo de 3 meses, lo renueva reconciliar.js
          asignado_a: origen.asignado_a || ''
        })
        resultado.agendadas++
      } catch (err) {
        // Una asignacion que falla no tumba la copia entera: queda la tarea con
        // lo que se pudo, y el detalle vuelve para mostrarlo.
        fastify.log.warn({ err: err.message, origen: origen.id }, 'duplicar: no se pudo copiar una asignacion')
        resultado.errores.push(`${etiqueta}: ${err.message}`)
      }
    }

    return reply.code(201).send(resultado)
  })

  // Paso 2 de "desactivar y despues eliminar": borrado real e irreversible
  // -- events.delete() de Calendar (se pierde el historial/description) +
  // borra las filas de TareaAsignacion/Tarea de la base. A diferencia de
  // desactivar (soft, reversible), esto es a proposito la excepcion a la
  // convencion "activo en vez de hard-delete" del resto de la app: solo
  // llega hasta acá quien ya la desactivó primero y lo confirma de nuevo.
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const existente = await fastify.db.tarea.findUnique({
      where: { id: request.params.id },
      include: { departamento: true }
    })
    if (!existente) return reply.code(404).send({ error: 'Tarea no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'administrar', existente.id_departamento)) {
      return reply.code(403).send({ error: 'Eliminar una tarea lo puede hacer un OWNER del grupo del departamento' })
    }
    if (existente.activa) {
      return reply.code(409).send({ error: 'Desactivá la tarea primero' })
    }

    const asignaciones = await fastify.db.tareaAsignacion.findMany({
      where: { id_tarea: existente.id },
      include: { compartidas: { include: { departamento: true } } }
    })
    const calendarId = existente.departamento.id_calendar_google
    for (const asignacion of asignaciones) {
      if (calendarId && asignacion.id_calendar_event) {
        await fastify.gcal.eliminarEvento({ calendarId, eventId: asignacion.id_calendar_event })
      }
      // Las copias compartidas hay que borrarlas de la base antes que la
      // asignacion original -- la FK de TareaAsignacionDepto es RESTRICT.
      for (const compartida of asignacion.compartidas) {
        const calIdCompartida = compartida.departamento.id_calendar_google
        if (calIdCompartida && compartida.id_calendar_event) {
          await fastify.gcal.eliminarEvento({ calendarId: calIdCompartida, eventId: compartida.id_calendar_event })
        }
      }
      await fastify.db.tareaAsignacionDepto.deleteMany({ where: { id_asignacion: asignacion.id } })
      // Las dependencias hay que borrarlas por LOS DOS lados: esta asignacion
      // puede ser el prerrequisito de una tarea de otro departamento, y la FK
      // es RESTRICT -- sin esto el borrado definitivo falla.
      await fastify.db.tareaAsignacionDependencia.deleteMany({
        where: {
          OR: [{ id_asignacion: asignacion.id }, { id_asignacion_prerequisito: asignacion.id }]
        }
      })
    }

    await fastify.db.tareaAsignacion.deleteMany({ where: { id_tarea: existente.id } })
    await fastify.db.tarea.delete({ where: { id: existente.id } })
    return reply.code(204).send()
  })
}
