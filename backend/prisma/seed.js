// Seed de desarrollo: catalogo de departamentos + usuarios de prueba, para
// poder probar toda la plataforma con el login temporal (ALLOW_DEV_LOGIN)
// antes de que exista el ticket SSO real de dcsmart (Fase 8).
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { google } from 'googleapis'
import 'dotenv/config'
import { crearAuthClient } from '../src/lib/gcal-auth.js'
import { getDirectory, emailDeGroup } from '../src/lib/directory-auth.js'

const prisma = new PrismaClient()

// Calcado 1:1 de dcsmart/backend/src/lib/datosUsuario.js (DEPARTAMENTOS) --
// mismas claves en minuscula como slug, para que resolverDepartamento()
// (lib/departamento-alias.js) no necesite alias: users.departamento de
// dcsmart siempre matchea un slug de acá con un simple toLowerCase().
const NOMBRES_POR_SLUG = {
  administracion: 'Administración',
  operaciones: 'Operaciones',
  compras: 'Compras',
  finanzas: 'Finanzas',
  rrhh: 'RRHH',
  sistemas: 'Sistemas',
  comercial: 'Comercial',
  auditoria: 'Auditoría',
  mantenimiento: 'Mantenimiento',
  direccion: 'Dirección'
}
const DEPARTAMENTOS = Object.keys(NOMBRES_POR_SLUG)
const CON_GROUPS = Boolean(process.env.GOOGLE_SA_KEY_PATH) // Fase 7 opcional -- sin la key, solo Calendar (Fase 3)

async function main() {
  const auth = await crearAuthClient()
  const calendar = google.calendar({ version: 'v3', auth })
  const deptosPorSlug = {}
  for (const slug of DEPARTAMENTOS) {
    const existente = await prisma.departamento.findUnique({ where: { slug } })
    const nombre = NOMBRES_POR_SLUG[slug]
    let calendarId = existente?.id_calendar_google
    if (!calendarId) {
      const { data } = await calendar.calendars.insert({ requestBody: { summary: `DC-PLATAFORMA — ${nombre}` } })
      calendarId = data.id
      console.log(`  calendario creado para ${slug}: ${calendarId}`)
    }

    let groupEmail = existente?.email_group_google
    if (CON_GROUPS && !groupEmail) {
      const directory = await getDirectory()
      groupEmail = emailDeGroup(slug)
      try {
        await directory.groups.insert({ requestBody: { email: groupEmail, name: `DC-PLATAFORMA — ${nombre}`, description: `Miembros del departamento ${nombre} (sync automatico, no editar a mano)` } })
        console.log(`  group creado: ${groupEmail}`)
      } catch (err) {
        if (err.code !== 409) throw err
      }
      await calendar.acl.insert({ calendarId, requestBody: { role: 'reader', scope: { type: 'group', value: groupEmail } } })
      console.log(`  calendario de ${slug} compartido (reader) con ${groupEmail}`)
    }

    const depto = await prisma.departamento.upsert({
      where: { slug },
      update: { id_calendar_google: calendarId, ...(groupEmail ? { email_group_google: groupEmail } : {}) },
      create: {
        id: randomUUID(),
        nombre,
        slug,
        id_calendar_google: calendarId,
        email_group_google: groupEmail || null
      }
    })
    deptosPorSlug[slug] = depto
    console.log(`Departamento ${slug} listo`)
  }

  await prisma.extUser.upsert({
    where: { email: 'admin@dcsmart.app' },
    update: {},
    create: { id: randomUUID(), email: 'admin@dcsmart.app', nombre: 'Admin (dev)', id_departamento: null }
  })

  for (const slug of DEPARTAMENTOS) {
    const email = `${slug}@dcsmart.app`
    await prisma.extUser.upsert({
      where: { email },
      update: {},
      create: { id: randomUUID(), email, nombre: `Usuario ${slug} (dev)`, id_departamento: deptosPorSlug[slug].id }
    })
    // Los emails de prueba no son cuentas reales de Workspace -- members.insert
    // va a fallar con 404 y eso esta bien, no es una cuenta real para agregar.
    if (CON_GROUPS && deptosPorSlug[slug].email_group_google) {
      const directory = await getDirectory()
      try {
        await directory.members.insert({ groupKey: deptosPorSlug[slug].email_group_google, requestBody: { email, role: 'MEMBER' } })
      } catch (err) {
        if (err.code !== 409 && err.code !== 404) throw err
      }
    }
  }

  console.log('Seed listo. Login temporal: POST /api/auth/dev-login { "email": "finanzas@dcsmart.app" }')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
