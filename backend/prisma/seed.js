// Seed de desarrollo: catalogo de departamentos + usuarios de prueba, para
// poder probar toda la plataforma con el login temporal (ALLOW_DEV_LOGIN)
// antes de que exista el ticket SSO real de dcsmart (Fase 8).
import { PrismaClient } from '@prisma/client'
import { randomUUID, randomBytes } from 'node:crypto'
import { google } from 'googleapis'
import 'dotenv/config'
import { crearAuthClient } from '../src/lib/gcal-auth.js'

const prisma = new PrismaClient()

const DEPARTAMENTOS = ['auditoria', 'reportes', 'costos', 'tesoreria', 'rrhh']

async function main() {
  const auth = await crearAuthClient()
  const calendar = google.calendar({ version: 'v3', auth })
  const deptosPorSlug = {}
  for (const slug of DEPARTAMENTOS) {
    const existente = await prisma.departamento.findUnique({ where: { slug } })
    let calendarId = existente?.id_calendar_google
    if (!calendarId) {
      const nombre = slug[0].toUpperCase() + slug.slice(1)
      const { data } = await calendar.calendars.insert({ requestBody: { summary: `DC-PLATAFORMA — ${nombre}` } })
      calendarId = data.id
      console.log(`  calendario creado para ${slug}: ${calendarId}`)
    }
    const depto = await prisma.departamento.upsert({
      where: { slug },
      update: { id_calendar_google: calendarId },
      create: {
        id: randomUUID(),
        nombre: slug[0].toUpperCase() + slug.slice(1),
        slug,
        id_calendar_google: calendarId,
        kiosko_key: randomBytes(16).toString('hex')
      }
    })
    deptosPorSlug[slug] = depto
    console.log(`Departamento ${slug} -- kiosko_key=${depto.kiosko_key}`)
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
  }

  console.log('Seed listo. Login temporal: POST /api/auth/dev-login { "email": "tesoreria@dcsmart.app" }')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
