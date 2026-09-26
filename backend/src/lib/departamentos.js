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

// La membresia de los Groups depto-* se administra a mano en Workspace (es la
// fuente de verdad de a que departamento pertenece cada persona). La app ya no
// agrega a nadie al iniciar sesion: lo hacia en un solo sentido, nunca sacaba, y
// deshacia los cambios hechos a mano en los grupos.
