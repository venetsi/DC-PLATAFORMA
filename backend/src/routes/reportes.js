import { usuarioActual, puede, esAdminGlobal, departamentosCon } from '../lib/permisos.js'
import { hoyEnArgentina } from '../lib/vencimiento.js'

// Lee CumplimientoDiario (snapshot escrito por el job diario) -- nunca
// recalcula agregando eventos de Calendar en vivo, ver docs/superpowers.
export default async function reportesRoutes(fastify) {
  fastify.get('/cumplimiento', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { departamento: idDepartamento, local: idLocal, desde, hasta } = request.query
    if (!idDepartamento) return reply.code(400).send({ error: 'departamento requerido' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'reportes', idDepartamento)) {
      return reply.code(403).send({ error: 'Los reportes los ven los MANAGER y OWNER del grupo del departamento' })
    }

    // id_local_ext = '' trae la fila agregada de todo el departamento (default);
    // pasar ?local=<id> trae el desglose de un local especifico -- nunca ambos
    // a la vez, para no duplicar el conteo (ver nota en schema.prisma).
    const snapshots = await fastify.db.cumplimientoDiario.findMany({
      where: {
        id_departamento: idDepartamento,
        id_local_ext: idLocal || '',
        fecha: {
          gte: desde ? new Date(desde) : undefined,
          lte: hasta ? new Date(hasta) : undefined
        }
      },
      orderBy: { fecha: 'asc' }
    })

    const totales = snapshots.reduce(
      (acc, s) => ({ total: acc.total + s.total_tareas, realizadas: acc.realizadas + s.realizadas }),
      { total: 0, realizadas: 0 }
    )
    const porcentajeCumplimiento = totales.total > 0 ? Math.round((totales.realizadas / totales.total) * 100) : null

    return { snapshots, porcentajeCumplimiento }
  })

  // Tablero de cumplimiento: un mes, con filtros de departamento/grupo/local.
  // Lee CumplimientoInstancia (dias ya cerrados; lo escribe el job diario) --
  // nunca Calendar en vivo. Cumplimiento = hechas / (hechas + atrasadas sin
  // hacer); "no aplica" no suma ni resta.
  fastify.get('/tablero', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const usuario = await usuarioActual(fastify, request)
    const mes = /^\d{4}-\d{2}$/.test(request.query.mes || '') ? request.query.mes : hoyEnArgentina().slice(0, 7)
    const { departamento: idDepto, grupo, local } = request.query

    const visibles = await fastify.db.departamento.findMany({
      where: { activo: true, ...(esAdminGlobal(usuario) ? {} : { id: { in: departamentosCon(usuario, 'reportes') } }) },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    })
    if (!visibles.length) return reply.code(403).send({ error: 'Los reportes los ven los MANAGER y OWNER de cada grupo' })
    if (idDepto && !visibles.some((d) => d.id === idDepto)) return reply.code(403).send({ error: 'No tenes acceso a este departamento' })
    const idsDepto = idDepto ? [idDepto] : visibles.map((d) => d.id)

    const locales = await fastify.db.extLocal.findMany({ select: { id: true, nombre: true, grupo: true } })
    const localPorId = new Map(locales.map((l) => [l.id, l]))
    const EMPRESA = 'Toda la empresa'
    const grupoDe = (idLocal) => (idLocal ? localPorId.get(idLocal)?.grupo || 'Sin grupo' : EMPRESA)
    const pasaFiltro = (f) => (!grupo || grupoDe(f.id_local_ext) === grupo) && (!local || f.id_local_ext === local)

    // 6 meses hasta el elegido (para la tabla por mes) en una sola lectura.
    const [a, m] = mes.split('-').map(Number)
    const inicio6 = new Date(Date.UTC(a, m - 6, 1))
    const finMes = new Date(Date.UTC(a, m, 1))
    const filas = (await fastify.db.cumplimientoInstancia.findMany({
      where: { id_departamento: { in: idsDepto }, fecha: { gte: inicio6, lt: finMes } },
      orderBy: { fecha: 'asc' }
    })).filter(pasaFiltro)

    // Sin un departamento puntual, una tarea compartida apareceria una vez por
    // cada calendario: se cuenta una sola (la del dueño si esta a la vista).
    const vistas = new Map()
    for (const f of filas) {
      const clave = `${f.id_asignacion}|${f.fecha.toISOString().slice(0, 10)}`
      const previa = vistas.get(clave)
      if (!previa || (previa.compartida && !f.compartida)) vistas.set(clave, f)
    }
    const unicas = idDepto ? filas : [...vistas.values()]

    const contar = (lista) => {
      const c = { total: 0, hechas: 0, a_tiempo: 0, tarde: 0, vencidas: 0, no_aplica: 0 }
      for (const f of lista) {
        c.total++
        if (f.estado === 'NO_APLICA') c.no_aplica++
        else if (f.estado === 'REALIZADA') { c.hechas++; if (f.a_tiempo === true) c.a_tiempo++; else if (f.a_tiempo === false) c.tarde++ }
        else c.vencidas++
      }
      const base = c.hechas + c.vencidas
      c.cumplimiento = base ? Math.round((c.hechas / base) * 100) : null
      return c
    }
    const mesDe = (f) => f.fecha.toISOString().slice(0, 7)
    const delMes = unicas.filter((f) => mesDe(f) === mes)
    const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7)

    // Por mes x departamento: lo que ve cada departamento (con sus copias compartidas).
    const meses = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(a, m - 6 + i, 1)).toISOString().slice(0, 7))
    const porMes = visibles
      .filter((d) => idsDepto.includes(d.id))
      .map((d) => ({
        id: d.id,
        nombre: d.nombre,
        meses: meses.map((mm) => {
          const c = contar(filas.filter((f) => f.id_departamento === d.id && mesDe(f) === mm))
          return { mes: mm, total: c.total, cumplimiento: c.cumplimiento }
        })
      }))
      .filter((d) => d.meses.some((x) => x.total))

    // Solo los dias que tuvieron alguna tarea.
    const porDia = new Map()
    for (const f of delMes) {
      const dia = f.fecha.toISOString().slice(0, 10)
      if (!porDia.has(dia)) porDia.set(dia, [])
      porDia.get(dia).push(f)
    }
    const dias = [...porDia.entries()].sort(([x], [y]) => y.localeCompare(x)).map(([fecha, lista]) => ({ fecha, ...contar(lista) }))

    // Por grupo -> local -> tarea.
    const arbol = new Map()
    for (const f of delMes) {
      const g = grupoDe(f.id_local_ext)
      if (!arbol.has(g)) arbol.set(g, new Map())
      const locs = arbol.get(g)
      if (!locs.has(f.id_local_ext)) locs.set(f.id_local_ext, [])
      locs.get(f.id_local_ext).push(f)
    }
    const grupos = [...arbol.entries()].map(([nombre, locs]) => {
      const todas = [...locs.values()].flat()
      return {
        grupo: nombre,
        ...contar(todas),
        locales: [...locs.entries()].map(([idLocal, lista]) => {
          const porTarea = new Map()
          for (const f of lista) {
            if (!porTarea.has(f.nombre_tarea)) porTarea.set(f.nombre_tarea, [])
            porTarea.get(f.nombre_tarea).push(f)
          }
          return {
            id_local_ext: idLocal,
            nombre: idLocal ? localPorId.get(idLocal)?.nombre || idLocal : EMPRESA,
            ...contar(lista),
            tareas: [...porTarea.entries()].map(([nombreTarea, l]) => ({ nombre: nombreTarea, ...contar(l) })).sort((x, y) => y.vencidas - x.vencidas || x.nombre.localeCompare(y.nombre))
          }
        }).sort((x, y) => (x.cumplimiento ?? 101) - (y.cumplimiento ?? 101) || x.nombre.localeCompare(y.nombre))
      }
    }).sort((x, y) => (x.cumplimiento ?? 101) - (y.cumplimiento ?? 101) || x.grupo.localeCompare(y.grupo))

    // Por responsable y departamento -> tarea. El responsable es el de la
    // asignacion (asignado_a); sin responsable fijo es el equipo del departamento.
    // Una fila por (responsable, departamento, tarea): el front arma los dos
    // ordenes (por responsable o por departamento) sin otra consulta.
    const nombreDepto = new Map(visibles.map((d) => [d.id, d.nombre]))
    const emails = [...new Set(delMes.map((f) => (f.asignado_a || '').toLowerCase().trim()).filter(Boolean))]
    const personas = emails.length
      ? await fastify.db.extUser.findMany({ where: { email: { in: emails } }, select: { email: true, nombre: true } })
      : []
    const nombrePersona = new Map(personas.map((p) => [p.email.toLowerCase(), p.nombre]))
    const porResp = new Map()
    for (const f of delMes) {
      const email = (f.asignado_a || '').toLowerCase().trim()
      const clave = `${email}|${f.id_departamento}|${f.nombre_tarea}`
      if (!porResp.has(clave)) porResp.set(clave, { email, id_departamento: f.id_departamento, tarea: f.nombre_tarea, filas: [] })
      porResp.get(clave).filas.push(f)
    }
    const por_responsable = [...porResp.values()].map((x) => ({
      responsable: x.email || null,
      nombre: x.email ? nombrePersona.get(x.email) || x.email.split('@')[0] : null,
      id_departamento: x.id_departamento,
      departamento: nombreDepto.get(x.id_departamento) || '—',
      tarea: x.tarea,
      locales: new Set(x.filas.map((f) => f.id_local_ext)).size,
      ...contar(x.filas)
    }))

    // Ultimo dia que proceso el job (CumplimientoDiario tiene fila por
    // departamento todos los dias, aunque no haya tareas) -- no el ultimo dia
    // que tuvo alguna tarea, que haria parecer que faltan datos.
    const ultimo = await fastify.db.cumplimientoDiario.findFirst({ where: { id_departamento: { in: idsDepto } }, orderBy: { fecha: 'desc' }, select: { fecha: true } })
    const gruposDisponibles = [...new Set(filas.map((f) => grupoDe(f.id_local_ext)))].sort()

    return {
      mes,
      datos_hasta: ultimo?.fecha.toISOString().slice(0, 10) ?? null,
      departamentos: visibles,
      grupos_disponibles: gruposDisponibles,
      resumen: contar(delMes),
      resumen_mes_anterior: contar(unicas.filter((f) => mesDe(f) === anterior)),
      por_mes: { meses, departamentos: porMes },
      dias,
      grupos,
      por_responsable
    }
  })
}
