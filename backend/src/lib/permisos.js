import { SLUG_DIRECCION } from './direccion.js'

// Modelo de permisos. No hay tabla de roles: se resuelve en cada pedido.
//   - Departamentos de una persona: con MEMBRESIA_FUENTE=groups, los Google
//     Groups depto-* en los que esta (copiados en MembresiaDepartamento, ver
//     lib/membresias.js). Si no, el unico departamento que manda dcsmart
//     (ExtUser.id_departamento), como fue siempre.
//   - Direccion = miembros de depto-direccion@: ven, administran y operan
//     sobre todos los departamentos (decision del usuario: Direccion es el grupo
//     de administradores).
//   - es_admin_global (super_admin de dcsmart, del ticket SSO) queda como acceso
//     de emergencia, por si alguien vacia el grupo de Direccion.
//   - Usuario de departamento: gestiona solo los suyos.

// MEMBRESIA_PILOTO: emails (separados por coma) que ya usan Groups aunque la
// fuente general siga siendo dcsmart -- para probar con pocas personas antes
// de cambiar para todos.
export function fuenteMembresia(email) {
  if (process.env.MEMBRESIA_FUENTE === 'groups') return 'groups'
  const piloto = String(process.env.MEMBRESIA_PILOTO || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean)
  return email && piloto.includes(String(email).toLowerCase()) ? 'groups' : 'dcsmart'
}

// Email de dev que actua como admin global. Solo con ALLOW_DEV_LOGIN=true.
export const DEV_ADMIN_EMAIL = 'admin@dcsmart.app'

// Agrega al ExtUser lo que hace falta para decidir permisos:
// { departamentos: [ids], esDireccion }. Idempotente: si ya lo tiene, no
// vuelve a consultar.
export async function conPermisos(db, usuario) {
  if (!usuario || Array.isArray(usuario.departamentos)) return usuario
  if (fuenteMembresia(usuario.email) === 'groups') {
    const membresias = await db.membresiaDepartamento.findMany({
      where: { email: usuario.email.toLowerCase(), departamento: { activo: true } },
      include: { departamento: { select: { id: true, slug: true, nombre: true } } },
      orderBy: { departamento: { nombre: 'asc' } }
    })
    return {
      ...usuario,
      departamentos: membresias.map((m) => m.id_departamento),
      esDireccion: membresias.some((m) => m.departamento.slug === SLUG_DIRECCION)
    }
  }
  return { ...usuario, departamentos: usuario.id_departamento ? [usuario.id_departamento] : [], esDireccion: false }
}

export function esAdminGlobal(usuario) {
  if (usuario?.es_admin_global || usuario?.esDireccion) return true
  return process.env.ALLOW_DEV_LOGIN === 'true' && usuario?.email === DEV_ADMIN_EMAIL
}

export async function usuarioActual(fastify, request) {
  const usuario = await fastify.db.extUser.findUnique({ where: { id: request.user.id } })
  return conPermisos(fastify.db, usuario)
}

export function departamentosDe(usuario) {
  return usuario?.departamentos ?? (usuario?.id_departamento ? [usuario.id_departamento] : [])
}

export function puedeGestionarDepartamento(usuario, idDepartamento) {
  return !!usuario && (esAdminGlobal(usuario) || departamentosDe(usuario).includes(idDepartamento))
}
