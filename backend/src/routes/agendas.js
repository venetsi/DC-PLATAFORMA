import { usuarioActual, puede, esAdminGlobal, departamentosDe, departamentosCon } from '../lib/permisos.js'
import { leerRecurrence } from '../lib/recurrencia.js'
import { clasificarInstancia, fechaDeInstancia, hoyEnArgentina } from '../lib/vencimiento.js'
import { definirAgenda, asegurarAsignacion, cerrarAsignacion, INCLUDES_AGENDA, sumarDias } from '../lib/agenda.js'

// Pantalla "Agendas": ver y gestionar las tareas de uno o todos los
// departamentos en un solo lugar. Direccion (admin) ve y opera todos; cada
// usuario, los suyos. Reusa definirAgenda (la misma escritura en Calendar que
// el formulario de siempre) -- esto solo agrupa y hace en lote.

const DIAS_ATRAS = 60
const DIAS_ADELANTE = 100 // alcanza para ver la proxima de una tarea "cada 3 meses"

function validarAgenda(agenda) {
  if (!agenda) return null
  const { recurrencia_tipo, recurrencia_config, vigencia_desde } = agenda
  if (!recurrencia_tipo || !vigencia_desde) return 'La agenda necesita frecuencia y fecha de inicio'
  if (recurrencia_tipo === 'SEMANAL' && !recurrencia_config?.dias_semana?.length) return 'Elegí al menos un día de la semana'
  if (recurrencia_tipo === 'INTERVALO_MESES' && !recurrencia_config?.dia_hasta) return 'Elegí el día del mes'
  if (recurrencia_tipo === 'UNICA' && !recurrencia_config?.fecha) return 'Elegí la fecha'
  return null
}

// Locales a los que aplica un alcance: [null] = toda la empresa.
async function localesDelAlcance(db, alcance) {
  if (!alcance || alcance.tipo === 'empresa') return [null]
  if (alcance.tipo === 'grupo') {
    const locales = await db.extLocal.findMany({ where: { grupo: alcance.id_grupo, activo: true }, select: { id: true } })
    return locales.map((l) => l.id)
  }
  return [...new Set(alcance.ids_locales || [])]
}

export default async function agendasRoutes(fastify) {
  async function visiblesPara(usuario) {
    return fastify.db.departamento.findMany({
      where: { activo: true, ...(esAdminGlobal(usuario) ? {} : { id: { in: departamentosDe(usuario) } }) },
      select: { id: true, nombre: true, slug: true, id_calendar_google: true },
      orderBy: { nombre: 'asc' }
    })
  }

  // Todo lo que necesita la pantalla, en un pedido: tareas -> asignaciones con
  // su frecuencia (del maestro de Calendar), la proxima fecha y las atrasadas
  // de los ultimos 60 dias. Sin ?departamento = todos los visibles.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await usuarioActual(fastify, request)
    const visibles = await visiblesPara(usuario)
    const { departamento: idDepto, inactivas } = request.query
    if (idDepto && !visibles.some((d) => d.id === idDepto)) return reply.code(403).send({ error: 'No tenes acceso a este departamento' })
    const enAlcance = idDepto ? visibles.filter((d) => d.id === idDepto) : visibles

    const conteo = await fastify.db.tarea.groupBy({ by: ['id_departamento'], where: { activa: true, id_departamento: { in: visibles.map((d) => d.id) } }, _count: true })
    const tareasPorDepto = new Map(conteo.map((c) => [c.id_departamento, c._count]))

    // Las desactivadas solo para quien las puede eliminar: OWNER de ese
    // departamento, o Direccion/admin (departamentosCon devuelve null = todos).
    const administrables = departamentosCon(usuario, 'administrar')
    const filtroActiva = inactivas !== 'true'
      ? { activa: true }
      : administrables === null ? {} : { OR: [{ activa: true }, { id_departamento: { in: administrables } }] }
    const tareas = await fastify.db.tarea.findMany({
      where: { id_departamento: { in: enAlcance.map((d) => d.id) }, ...filtroActiva },
      include: {
        asignaciones: {
          where: { activa: true },
          include: { local: true, compartidas: { include: { departamento: { select: { id: true, nombre: true, activo: true } } } } }
        }
      },
      orderBy: { nombre: 'asc' }
    })

    // Una lectura de maestros + una de instancias por calendario, en paralelo.
    const hoy = hoyEnArgentina()
    const porCalendario = await Promise.all(
      enAlcance.filter((d) => d.id_calendar_google).map(async (d) => {
        const [maestros, instancias] = await Promise.all([
          fastify.gcal.listarMaestros({ calendarId: d.id_calendar_google }),
          fastify.gcal.listarInstancias({
            calendarId: d.id_calendar_google,
            timeMin: `${sumarDias(hoy, -DIAS_ATRAS)}T00:00:00Z`,
            timeMax: `${sumarDias(hoy, DIAS_ADELANTE)}T23:59:59Z`
          })
        ])
        return { maestros, instancias }
      })
    )
    const duenioPorAsignacion = new Map(tareas.flatMap((t) => t.asignaciones.map((a) => [a.id, t.id_departamento])))
    const maestroPorId = new Map(porCalendario.flatMap((c) => c.maestros).map((m) => [m.id, m]))
    const estadoPorAsignacion = new Map()
    for (const ev of porCalendario.flatMap((c) => c.instancias)) {
      const props = ev.extendedProperties?.private || {}
      // Solo la copia del calendario dueño: las compartidas repetirian el mismo estado.
      const duenio = duenioPorAsignacion.get(props.id_asignacion)
      if (!duenio || (props.id_departamento && props.id_departamento !== duenio)) continue
      const e = estadoPorAsignacion.get(props.id_asignacion) ?? { proxima: null, atrasadas: 0, ultima_hecha: null }
      const { estado } = clasificarInstancia(ev)
      const fecha = fechaDeInstancia(ev)
      if (estado === 'vencida') e.atrasadas++
      if (estado === 'pendiente' && fecha >= hoy && (!e.proxima || fecha < e.proxima)) e.proxima = fecha
      if (estado === 'realizada' && (!e.ultima_hecha || fecha > e.ultima_hecha)) e.ultima_hecha = fecha
      estadoPorAsignacion.set(props.id_asignacion, e)
    }

    return {
      departamentos: visibles.map((d) => ({ id: d.id, nombre: d.nombre, tareas: tareasPorDepto.get(d.id) || 0 })),
      tareas: tareas.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        descripcion: t.descripcion,
        activa: t.activa,
        id_departamento: t.id_departamento,
        asignaciones: t.asignaciones.map((a) => {
          const maestro = a.id_calendar_event ? maestroPorId.get(a.id_calendar_event) : null
          const estado = estadoPorAsignacion.get(a.id) ?? { proxima: null, atrasadas: 0, ultima_hecha: null }
          return {
            id: a.id,
            id_local_ext: a.id_local_ext,
            local: a.local?.nombre ?? null,
            grupo: a.local?.grupo ?? null,
            asignado_a: a.asignado_a,
            compartidas: a.compartidas.filter((c) => c.departamento.activo).map((c) => ({ id: c.departamento.id, nombre: c.departamento.nombre })),
            agenda: maestro ? leerRecurrence(maestro.recurrence, maestro.start?.date) : null,
            agendada: !!a.id_calendar_event,
            ...estado
          }
        })
      }))
    }
  })

  // Crear una tarea completa en un paso: nombre + donde + cuando + quien.
  fastify.post('/tareas', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { nombre: nombreRaw, descripcion, id_departamento, alcance, agenda, asignado_a = null, compartir_con = [] } = request.body || {}
    const nombre = String(nombreRaw || '').trim()
    if (!nombre || !id_departamento) return reply.code(400).send({ error: 'Poné un nombre y elegí el departamento' })
    const errorAgenda = validarAgenda(agenda)
    if (errorAgenda) return reply.code(400).send({ error: errorAgenda })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', id_departamento)) return reply.code(403).send({ error: 'Crear tareas lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    const locales = await localesDelAlcance(fastify.db, alcance)
    if (!locales.length) return reply.code(400).send({ error: 'Ese grupo no tiene locales activos' })

    let tarea
    try {
      tarea = await fastify.db.tarea.create({ data: { nombre, descripcion: descripcion || null, id_departamento } })
    } catch (err) {
      if (err.code === 'P2002') return reply.code(409).send({ error: `Ya existe una tarea llamada "${nombre}"` })
      throw err
    }
    const r = await aplicarAlcance(tarea, { locales, agenda, asignado_a, compartir_con })
    return reply.code(201).send({ tarea, ...r })
  })

  // Sumar locales (o un grupo, o toda la empresa) a una tarea existente.
  fastify.post('/tareas/:id/alcance', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const tarea = await fastify.db.tarea.findUnique({ where: { id: request.params.id } })
    if (!tarea?.activa) return reply.code(404).send({ error: 'Tarea no encontrada' })
    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', tarea.id_departamento)) return reply.code(403).send({ error: 'Editar tareas lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    const { alcance, agenda, asignado_a = null, compartir_con = [] } = request.body || {}
    const errorAgenda = validarAgenda(agenda)
    if (errorAgenda) return reply.code(400).send({ error: errorAgenda })
    const locales = await localesDelAlcance(fastify.db, alcance)
    if (!locales.length) return reply.code(400).send({ error: 'Elegí al menos un local' })
    return aplicarAlcance(tarea, { locales, agenda, asignado_a, compartir_con })
  })

  async function aplicarAlcance(tarea, { locales, agenda, asignado_a, compartir_con }) {
    const r = { asignaciones: 0, agendadas: 0, ya_existian: 0, errores: [] }
    for (const idLocal of locales) {
      try {
        const { asignacion, yaActiva } = await asegurarAsignacion(fastify, { tarea, idLocal, asignadoA: asignado_a, compartirCon: compartir_con })
        if (yaActiva) { r.ya_existian++; continue }
        r.asignaciones++
        if (agenda) {
          await definirAgenda(fastify, asignacion, { ...agenda, vigencia_hasta: null, asignado_a: asignado_a || '' })
          r.agendadas++
        }
      } catch (err) {
        fastify.log.warn({ err: err.message, idLocal }, 'agendas: no se pudo agregar un local')
        r.errores.push(`${idLocal || 'Toda la empresa'}: ${err.message}`)
      }
    }
    return r
  }

  // Carga las asignaciones pedidas y verifica permiso sobre cada una.
  async function cargarPermitidas(request, ids) {
    const usuario = await usuarioActual(fastify, request)
    const asignaciones = await fastify.db.tareaAsignacion.findMany({ where: { id: { in: ids || [] }, activa: true }, include: INCLUDES_AGENDA })
    return asignaciones.filter((a) => puede(usuario, 'editar', a.tarea.id_departamento))
  }

  // En lote: cambiar la frecuencia y/o el responsable de varias asignaciones.
  // Sin `agenda`, cada una conserva la suya (se lee del maestro) y cambia solo
  // el responsable -- definirAgenda no toca la recurrencia en ese caso.
  fastify.post('/asignaciones/agenda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { ids, agenda, asignado_a } = request.body || {}
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: 'Elegí al menos un local' })
    if (!agenda && asignado_a === undefined) return reply.code(400).send({ error: 'No hay nada para cambiar' })
    const errorAgenda = validarAgenda(agenda)
    if (errorAgenda) return reply.code(400).send({ error: errorAgenda })

    const asignaciones = await cargarPermitidas(request, ids)
    const r = { actualizadas: 0, sin_agenda: 0, errores: [] }
    for (const a of asignaciones) {
      try {
        let regla = agenda
        if (!regla) {
          const maestro = a.id_calendar_event
            ? await fastify.gcal.leerInstancia({ calendarId: a.tarea.departamento.id_calendar_google, instanceId: a.id_calendar_event })
            : null
          regla = maestro ? leerRecurrence(maestro.recurrence, maestro.start?.date) : null
        }
        if (!regla) {
          // Sin agenda todavia: el responsable se guarda igual, sin evento.
          await fastify.db.tareaAsignacion.update({ where: { id: a.id }, data: { asignado_a: asignado_a || null } })
          r.sin_agenda++
          continue
        }
        await definirAgenda(fastify, a, {
          ...regla,
          ...(agenda ? { vigencia_hasta: null } : {}),
          asignado_a: asignado_a === undefined ? a.asignado_a || '' : asignado_a || ''
        })
        r.actualizadas++
      } catch (err) {
        fastify.log.warn({ err: err.message, asignacion: a.id }, 'agendas: no se pudo actualizar')
        r.errores.push(`${a.local?.nombre || 'Toda la empresa'}: ${err.message}`)
      }
    }
    return r
  })

  // En lote: sacar locales de una tarea (cierra su serie hacia adelante).
  fastify.post('/asignaciones/quitar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { ids } = request.body || {}
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: 'Elegí al menos un local' })
    const asignaciones = await cargarPermitidas(request, ids)
    const r = { quitadas: 0, errores: [] }
    for (const a of asignaciones) {
      try {
        await cerrarAsignacion(fastify, a)
        r.quitadas++
      } catch (err) {
        r.errores.push(`${a.local?.nombre || 'Toda la empresa'}: ${err.message}`)
      }
    }
    return r
  })
}
