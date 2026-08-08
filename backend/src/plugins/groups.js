import fp from 'fastify-plugin'
import { getDirectory, emailDeGroup } from '../lib/directory-auth.js'

// Google Groups solo sirve para compartir el Calendar de cada departamento
// en modo lectura -- la membresia real sigue viviendo en dcsmart.users
// (ExtUser.id_departamento). El sync es siempre EN ESE SENTIDO (de nuestra
// base hacia el Group), nunca al reves.
async function groupsPlugin(fastify) {
  fastify.decorate('groups', {
    // Crea el Group si no existe. Idempotente: un 409 (ya existe) no es error.
    async asegurarGroup(slug, nombre) {
      const directory = await getDirectory()
      const email = emailDeGroup(slug)
      try {
        await directory.groups.insert({ requestBody: { email, name: `DC-PLATAFORMA — ${nombre}`, description: `Miembros del departamento ${nombre} (sync automatico, no editar a mano)` } })
        fastify.log.info({ email }, 'Group creado')
      } catch (err) {
        if (err.code !== 409) throw err
      }
      return email
    },

    async agregarMiembro(groupEmail, userEmail, role = 'MEMBER') {
      const directory = await getDirectory()
      try {
        await directory.members.insert({ groupKey: groupEmail, requestBody: { email: userEmail, role } })
      } catch (err) {
        if (err.code !== 409 && err.code !== 404) throw err // 409 = ya es miembro; 404 (el usuario no existe en Workspace) se ignora en dev
      }
    },

    async quitarMiembro(groupEmail, userEmail) {
      const directory = await getDirectory()
      try {
        await directory.members.delete({ groupKey: groupEmail, memberKey: userEmail })
      } catch (err) {
        if (err.code !== 404) throw err // ya no era miembro
      }
    }
  })
}

export default fp(groupsPlugin)
