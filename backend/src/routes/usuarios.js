import { fuenteMembresia } from '../lib/permisos.js'

// Personas que pueden ser responsables de una tarea. Nunca CRUD: la identidad
// viene del login y, con MEMBRESIA_FUENTE=groups, los departamentos salen de
// los Google Groups (ver lib/membresias.js), que tambien crea a quien esta en
// un grupo y nunca entro.
export default async function usuariosRoutes(fastify) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { departamento } = request.query
    // select acotado: es_admin_global no tiene nada que hacer en un
    // desplegable de "quien es responsable de esta tarea".
    const usuarios = await fastify.db.extUser.findMany({
      where: { activo: true },
      select: { id: true, email: true, nombre: true, id_departamento: true },
      orderBy: { nombre: 'asc' }
    })

    let conDepartamentos
    if (fuenteMembresia() === 'groups') {
      const membresias = await fastify.db.membresiaDepartamento.findMany({ select: { email: true, id_departamento: true } })
      const porEmail = new Map()
      for (const m of membresias) (porEmail.get(m.email) ?? porEmail.set(m.email, []).get(m.email)).push(m.id_departamento)
      conDepartamentos = usuarios.map((u) => ({ ...u, departamentos: porEmail.get(u.email.toLowerCase()) || [] }))
    } else {
      conDepartamentos = usuarios.map((u) => ({ ...u, departamentos: u.id_departamento ? [u.id_departamento] : [] }))
    }
    return departamento ? conDepartamentos.filter((u) => u.departamentos.includes(departamento)) : conDepartamentos
  })
}
