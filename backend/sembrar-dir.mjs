import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { hoyEnArgentina } from './src/lib/vencimiento.js'
const prisma = new PrismaClient()
async function api(method, path, body) {
  const u = await prisma.extUser.findUnique({ where: { email: 'admin@dcsmart.app' } })
  const token = jwt.sign({ id: u.id, email: u.email, nombre: u.nombre }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const res = await fetch(`http://localhost:3100/api${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: res.status !== 204 ? await res.json().catch(() => null) : null }
}
const hoy = hoyEnArgentina()
const unDia = (d) => { const [a,m,dd]=hoy.split('-').map(Number); return new Date(Date.UTC(a,m-1,dd+d)).toISOString().slice(0,10) }
const dir = await prisma.departamento.findFirst({ where: { slug: 'direccion' } })
console.log('sembrando en', dir.nombre, '| space:', dir.chat_space_name)
for (const [nombre, fecha] of [
  ['ZZP-Aprobar cierre mensual', hoy],
  ['ZZP-Revisar presupuesto', unDia(-3)],
  ['ZZP-Firmar balance', unDia(-10)]
]) {
  const t = (await api('POST', '/tareas', { nombre, id_departamento: dir.id })).body
  const a = (await api('POST', '/asignaciones', { id_tarea: t.id })).body
  await api('PUT', `/asignaciones/${a.id}/agenda`, { recurrencia_tipo: 'UNICA', recurrencia_config: { fecha }, vigencia_desde: fecha })
  console.log(`  ${nombre} (${fecha})`)
}
await prisma.$disconnect()
