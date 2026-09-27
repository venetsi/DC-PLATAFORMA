import { SLUG_DIRECCION } from './direccion.js'

// Modelo de permisos. No hay tabla de roles: se resuelve en cada pedido.
//   - Departamentos de una persona y su ROL en cada uno: con
//     MEMBRESIA_FUENTE=groups, los Google Groups depto-* en los que esta y el
//     rol que tiene en cada grupo (MEMBER / MANAGER / OWNER, copiados en
//     MembresiaDepartamento, ver lib/membresias.js). Si no, el unico
//     departamento que manda dcsmart (ExtUser.id_departamento), como MANAGER
//     (es lo que podia hacer antes: crear y editar, no borrar).
//   - Direccion = cualquier miembro de depto-direccion@, con el rol que sea: ve
//     y gestiona TODO, sin restriccion (decision del usuario).
//   - es_admin_global (super_admin de dcsmart, del ticket SSO) queda como acceso
//     de emergencia, igual que Direccion.
//   - El resto, segun su rol en cada departamento (ver ACCIONES).

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

// Roles del Google Group, de menor a mayor.
export const NIVEL_ROL = { MEMBER: 1, MANAGER: 2, OWNER: 3 }

// Rol minimo que pide cada accion (decision del usuario, 2026-09-27):
//   MEMBER  -> ve agendas y tareas de sus grupos y las marca (hecha, no
//              aplica, tomar, nota).
//   MANAGER -> ademas crea y edita tareas y agendas (incluye moverlas de dia y
//              pasarlas a otra persona) y ve los reportes.
//   OWNER   -> todo lo de sus grupos: ademas desactiva/elimina tareas y
//              configura los avisos del departamento.
// Crear departamentos, releer los grupos y los repositorios de documentos
// siguen siendo solo de Direccion / admin.
export const ACCIONES = {
  ver: 'MEMBER',
  marcar: 'MEMBER',
  editar: 'MANAGER',
  reportes: 'MANAGER',
  administrar: 'OWNER'
}

function normalizarRol(rol) {
  return NIVEL_ROL[rol] ? rol : 'MEMBER'
}

// Agrega al ExtUser lo que hace falta para decidir permisos:
// { departamentos: [ids], roles: { id: rol }, esDireccion }. Idempotente: si
// ya lo tiene, no vuelve a consultar.
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
      roles: Object.fromEntries(membresias.map((m) => [m.id_departamento, normalizarRol(m.rol_group)])),
      esDireccion: membresias.some((m) => m.departamento.slug === SLUG_DIRECCION)
    }
  }
  const ids = usuario.id_departamento ? [usuario.id_departamento] : []
  return { ...usuario, departamentos: ids, roles: Object.fromEntries(ids.map((id) => [id, 'MANAGER'])), esDireccion: false }
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

// Rol efectivo en un departamento: Direccion y admin cuentan como OWNER en todos.
export function rolEn(usuario, idDepartamento) {
  if (!usuario) return null
  if (esAdminGlobal(usuario)) return 'OWNER'
  if (usuario.roles) return usuario.roles[idDepartamento] ?? null
  return departamentosDe(usuario).includes(idDepartamento) ? 'MANAGER' : null
}

// ¿Puede `usuario` hacer `accion` (ver ACCIONES) en ese departamento?
export function puede(usuario, accion, idDepartamento) {
  const minimo = ACCIONES[accion]
  if (!minimo) throw new Error(`accion de permiso desconocida: ${accion}`)
  const rol = rolEn(usuario, idDepartamento)
  return !!rol && NIVEL_ROL[rol] >= NIVEL_ROL[minimo]
}

// Ids de los departamentos propios donde puede hacer `accion`. Para un admin
// devuelve null = "todos" (el llamador decide como listar todos).
export function departamentosCon(usuario, accion) {
  if (esAdminGlobal(usuario)) return null
  return departamentosDe(usuario).filter((id) => puede(usuario, accion, id))
}
