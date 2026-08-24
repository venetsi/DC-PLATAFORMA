// El `summary` del evento es lo unico que identifica a una tarea cuando se
// la mira desde el propio Google Calendar (via el Group compartido del
// departamento), donde -- a diferencia del kiosko y de la vista Agenda -- no
// hay agrupamiento por local: sin sufijo, la misma tarea asignada a 8 locales
// son 8 eventos "CMV" indistinguibles entre si.
//
// El nombre limpio de la tarea viaja aparte en extendedProperties.nombre_tarea
// para que kiosko/app puedan seguir mostrando solo "CMV" dentro del grupo del
// local, sin repetir el local en cada bullet.
export function componerTitulo(nombreTarea, local) {
  if (!local) return `${nombreTarea} — Toda la empresa`
  // El grupo (ExtLocal.grupo, la App/marca de dcsmart) va ademas del local
  // porque es lo que da contexto a una asignacion creada "por grupo": el
  // local solo ya identifica, pero el grupo explica por que esta ahi.
  return local.grupo
    ? `${nombreTarea} — ${local.nombre} (${local.grupo})`
    : `${nombreTarea} — ${local.nombre}`
}
