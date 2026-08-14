// Modelo de permisos (mas alla de admin global, que ya resuelve
// server.js#requireAdminGlobal):
//   - super_admin: crea departamentos, y crea/edita/desactiva tareas de
//     CUALQUIER departamento.
//   - usuario de departamento: crea/edita tareas de SU PROPIO departamento
//     nada mas, y no puede desactivarlas (eso es lo unico reservado a admin).
// No hay tabla de permisos propia -- se resuelve leyendo ExtUser en cada
// ruta que lo necesita.

// Email de dev que actua como admin global (equivalente a super_admin/dcsmart
// una vez migrado al ticket real en Fase 8). Solo tiene efecto con
// ALLOW_DEV_LOGIN=true -- nunca usar este mecanismo en produccion.
//
// Vive aca (no en auth.js) porque es "es admin" es una pregunta que varias
// rutas necesitan contestar de la misma forma -- tenerla duplicada en cada
// archivo es exactamente como se filtro el bug real: requireAdminGlobal y
// /me la tenian, este archivo al principio no, y un admin de dev se quedaba
// afuera de crear tareas en otros departamentos.
export const DEV_ADMIN_EMAIL = 'admin@dcsmart.app'

export function esAdminGlobal(usuario) {
  return !!usuario?.es_admin_global || usuario?.email === DEV_ADMIN_EMAIL
}

export async function usuarioActual(fastify, request) {
  return fastify.db.extUser.findUnique({ where: { id: request.user.id } })
}

export function puedeGestionarDepartamento(usuario, idDepartamento) {
  return !!usuario && (esAdminGlobal(usuario) || usuario.id_departamento === idDepartamento)
}
