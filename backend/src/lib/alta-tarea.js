// Piezas del alta de una tarea (POST /api/agendas/tareas) que no dependen de
// Fastify, para poder probarlas sin servidor.

// La tarea del mismo departamento con ese nombre, sin importar mayusculas ni
// espacios de mas. El nombre es unico POR DEPARTAMENTO: "CMV" de Costos y
// "CMV" de Auditoria son dos tareas distintas. Antes era unico en toda la
// empresa y eso llevaba a inventar nombres por local ("CMV ALDO",
// "PDP Perros") que quedaban fuera del circuito.
export function buscarMismoNombre(db, { idDepartamento, nombre }) {
  return db.tarea.findFirst({
    where: { id_departamento: idDepartamento, nombre: { equals: nombre.trim(), mode: 'insensitive' } },
    select: { id: true, nombre: true, id_departamento: true, activa: true, departamento: { select: { nombre: true } } }
  })
}

export function resumirExistente(t) {
  return t && {
    id: t.id,
    nombre: t.nombre,
    id_departamento: t.id_departamento,
    departamento: t.departamento?.nombre || '',
    activa: t.activa
  }
}

// Lo que se le muestra a la persona cuando no se pudo agendar un local. Los
// errores propios ya vienen en castellano (llevan `status`); los de Google
// vienen en ingles y con codigos, y no le sirven a nadie en pantalla.
export function motivoDeError(err) {
  if (err?.status && !err.response) return err.message
  return 'Google Calendar no respondió'
}

// Deshace el alta de una tarea NUEVA que no llego a agendarse en ningun
// local: borra la tarea y lo que se creo en la base, para que reintentar con
// el mismo nombre no choque con un "ya existe" de algo que nunca funciono.
// Si algun local SI quedo agendado no toca nada (devuelve false): eso ya
// existe en Calendar y se completa con "Sumar".
export async function deshacerAlta(db, idTarea) {
  const asignaciones = await db.tareaAsignacion.findMany({ where: { id_tarea: idTarea }, select: { id: true, id_calendar_event: true } })
  if (asignaciones.some((a) => a.id_calendar_event)) return false
  const ids = asignaciones.map((a) => a.id)
  await db.$transaction([
    db.tareaAsignacionDependencia.deleteMany({ where: { OR: [{ id_asignacion: { in: ids } }, { id_asignacion_prerequisito: { in: ids } }] } }),
    db.tareaAsignacionDepto.deleteMany({ where: { id_asignacion: { in: ids } } }),
    db.tareaAsignacion.deleteMany({ where: { id_tarea: idTarea } }),
    db.tarea.delete({ where: { id: idTarea } })
  ])
  return true
}
