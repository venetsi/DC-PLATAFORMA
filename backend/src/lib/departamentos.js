import { randomBytes } from 'node:crypto'

// Provisioning de un Departamento: Calendar (Fase 3) + Group compartido en
// modo lectura (Fase 7) + clave de kiosko (Fase 6). Idempotente -- se puede
// llamar cada vez que se ve el departamento (sync perezoso desde el ticket
// SSO, el seed de dev, o /admin/departamentos).
export async function asegurarDepartamento(fastify, { id, nombre, slug }) {
  let departamento = await fastify.db.departamento.findUnique({ where: { slug } })

  if (!departamento?.id_calendar_google) {
    const calendarId = await fastify.gcal.crearCalendarioDepartamento(`DC-PLATAFORMA — ${nombre}`)
    departamento = await fastify.db.departamento.upsert({
      where: { slug },
      create: { id, nombre, slug, id_calendar_google: calendarId, kiosko_key: randomBytes(16).toString('hex') },
      update: { id_calendar_google: calendarId }
    })
  }

  if (!departamento.email_group_google) {
    const groupEmail = await fastify.groups.asegurarGroup(slug, nombre)
    await fastify.gcal.compartirConGroup({ calendarId: departamento.id_calendar_google, groupEmail, role: 'reader' })
    departamento = await fastify.db.departamento.update({ where: { slug }, data: { email_group_google: groupEmail } })
  }

  return departamento
}

// Nuestra base (ExtUser.id_departamento, que viene de dcsmart) es la fuente
// de verdad -- esto solo refleja esa membresia hacia el Group. Si falla (ej.
// el usuario todavia no existe como cuenta real de Workspace en dev), no
// bloquea el login: el Group es una comodidad de distribucion, no el
// mecanismo de permisos real de la plataforma.
export async function sincronizarMembresiaGroup(fastify, usuario) {
  if (!usuario.id_departamento) return
  try {
    const departamento = await fastify.db.departamento.findUnique({ where: { id: usuario.id_departamento } })
    if (!departamento?.email_group_google) return
    await fastify.groups.agregarMiembro(departamento.email_group_google, usuario.email)
  } catch (err) {
    fastify.log.warn({ err: err.message, usuario: usuario.email }, 'No se pudo sincronizar membresia de Group (no bloqueante)')
  }
}
