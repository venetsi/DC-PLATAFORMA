import { usuarioActual, puede } from '../lib/permisos.js'
import { crearianCiclo } from '../lib/dependencias.js'

// CRUD de dependencias entre asignaciones. Mismo modelo de permisos que el
// resto: se gestiona la asignacion que ESPERA (la que muestra el aviso), asi
// que se valida contra el departamento de esa tarea. El prerrequisito puede
// ser de otro departamento -- ese es justamente el caso de uso.
export default async function dependenciasRoutes(fastify) {
  async function cargarAsignacion(id) {
    return fastify.db.tareaAsignacion.findUnique({
      where: { id },
      include: { tarea: { include: { departamento: true } }, local: true }
    })
  }

  const resumir = (a) => ({
    id_asignacion: a.id,
    nombre_tarea: a.tarea.nombre,
    departamento: a.tarea.departamento.nombre,
    local: a.local?.nombre || 'Toda la empresa'
  })

  // GET /api/dependencias?asignacion=<id>
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { asignacion: idAsignacion } = request.query
    if (!idAsignacion) return reply.code(400).send({ error: 'asignacion requerida' })

    const filas = await fastify.db.tareaAsignacionDependencia.findMany({
      where: { id_asignacion: idAsignacion, activa: true },
      include: { prerequisito: { include: { tarea: { include: { departamento: true } }, local: true } } },
      orderBy: { created_at: 'asc' }
    })
    return filas.map((f) => ({ id: f.id, ...resumir(f.prerequisito) }))
  })

  // POST /api/dependencias  { id_asignacion, id_asignacion_prerequisito }
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id_asignacion, id_asignacion_prerequisito } = request.body || {}
    if (!id_asignacion || !id_asignacion_prerequisito) {
      return reply.code(400).send({ error: 'id_asignacion e id_asignacion_prerequisito son requeridos' })
    }
    if (id_asignacion === id_asignacion_prerequisito) {
      return reply.code(400).send({ error: 'Una tarea no puede depender de sí misma' })
    }

    const [asignacion, prerequisito] = await Promise.all([
      cargarAsignacion(id_asignacion),
      cargarAsignacion(id_asignacion_prerequisito)
    ])
    if (!asignacion || !prerequisito) return reply.code(404).send({ error: 'Asignación no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Definir dependencias lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    if (await crearianCiclo(fastify.db, { idAsignacion: id_asignacion, idPrerequisito: id_asignacion_prerequisito })) {
      return reply.code(409).send({
        error: `Esa dependencia crearía un ciclo: "${prerequisito.tarea.nombre}" ya depende (directa o indirectamente) de "${asignacion.tarea.nombre}"`
      })
    }

    try {
      const fila = await fastify.db.tareaAsignacionDependencia.create({
        data: { id_asignacion, id_asignacion_prerequisito }
      })
      return reply.code(201).send({ id: fila.id, ...resumir(prerequisito) })
    } catch (err) {
      if (err.code === 'P2002') return reply.code(409).send({ error: 'Esa dependencia ya existe' })
      throw err
    }
  })

  // POST /api/dependencias/lote  { id_asignacion, id_tarea_prerequisito }
  //
  // El atajo "En todos los locales": cada local de la tarea de `id_asignacion`
  // pasa a esperar a la tarea prerrequisito DEL MISMO LOCAL (y "Toda la
  // empresa" a "Toda la empresa"). Crea solo lo que falta; lo que no tiene par
  // o cerraria un ciclo se informa en vez de fallar entero.
  fastify.post('/lote', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id_asignacion, id_tarea_prerequisito } = request.body || {}
    if (!id_asignacion || !id_tarea_prerequisito) {
      return reply.code(400).send({ error: 'id_asignacion e id_tarea_prerequisito son requeridos' })
    }
    const base = await cargarAsignacion(id_asignacion)
    if (!base) return reply.code(404).send({ error: 'Asignación no encontrada' })
    if (base.id_tarea === id_tarea_prerequisito) {
      return reply.code(400).send({ error: 'Una tarea no puede depender de sí misma' })
    }

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', base.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Definir dependencias lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    const [propias, delPrerequisito] = await Promise.all([
      fastify.db.tareaAsignacion.findMany({ where: { id_tarea: base.id_tarea, activa: true }, include: { local: true } }),
      fastify.db.tareaAsignacion.findMany({ where: { id_tarea: id_tarea_prerequisito, activa: true }, include: { tarea: true } })
    ])
    if (!delPrerequisito.length) return reply.code(404).send({ error: 'Esa tarea no tiene locales asignados' })
    const EMPRESA = '__empresa__'
    const parDe = new Map(delPrerequisito.map((a) => [a.id_local_ext || EMPRESA, a]))

    const resultado = { creadas: 0, ya_existian: 0, sin_par: [], ciclos: [] }
    for (const propia of propias) {
      const nombreLocal = propia.local?.nombre || 'Toda la empresa'
      const par = parDe.get(propia.id_local_ext || EMPRESA)
      if (!par) {
        resultado.sin_par.push(nombreLocal)
        continue
      }
      if (await crearianCiclo(fastify.db, { idAsignacion: propia.id, idPrerequisito: par.id })) {
        resultado.ciclos.push(nombreLocal)
        continue
      }
      try {
        await fastify.db.tareaAsignacionDependencia.create({ data: { id_asignacion: propia.id, id_asignacion_prerequisito: par.id } })
        resultado.creadas++
      } catch (err) {
        if (err.code !== 'P2002') throw err
        // Ya estaba: si habia quedado inactiva, vuelve a valer.
        await fastify.db.tareaAsignacionDependencia.updateMany({
          where: { id_asignacion: propia.id, id_asignacion_prerequisito: par.id, activa: false },
          data: { activa: true }
        })
        resultado.ya_existian++
      }
    }
    return reply.code(201).send(resultado)
  })

  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const fila = await fastify.db.tareaAsignacionDependencia.findUnique({
      where: { id: request.params.id },
      include: { asignacion: { include: { tarea: true } } }
    })
    if (!fila) return reply.code(404).send({ error: 'Dependencia no encontrada' })

    const usuario = await usuarioActual(fastify, request)
    if (!puede(usuario, 'editar', fila.asignacion.tarea.id_departamento)) {
      return reply.code(403).send({ error: 'Borrar dependencias lo puede hacer un MANAGER u OWNER del grupo del departamento' })
    }

    await fastify.db.tareaAsignacionDependencia.delete({ where: { id: fila.id } })
    return reply.code(204).send()
  })
}
