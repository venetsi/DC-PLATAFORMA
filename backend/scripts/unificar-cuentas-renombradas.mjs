// Unifica en ext_users las cuentas que en Google Workspace se renombraron (el
// email viejo quedo como alias del nuevo). La sincronizacion de grupos ya creo
// la fila del email nuevo; esto le pasa lo que tenia la vieja y desactiva la
// vieja:
//   - es_admin_global (si la vieja lo tenia),
//   - el id real de Chat (users/<numero largo>; los users/1, users/2... son de pruebas),
//   - responsables en tarea_asignaciones y pago_seguimientos.
// El historial (realizada_por en Calendar) queda con el email con que se hizo.
//
// Uso (desde backend/, con el proxy de Cloud SQL levantado):
//   node scripts/unificar-cuentas-renombradas.mjs            -> solo muestra lo que haria
//   node scripts/unificar-cuentas-renombradas.mjs --aplicar  -> lo aplica
//
// Pares detectados el 2026-09-27 consultando los grupos depto-* con cada email
// guardado (members.get resuelve el alias al email principal).
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const PARES = {
  'maximiliano@venetsi.com': 'mmartinez@venetsi.com',
  'calderon@dcmanagement.com.ar': 'dcalderon@dcmanagement.com.ar',
  'admin@dcsmart.app': 'eguzman@dcsmart.app',
  'analisis@dcsmart.app': 'ggonzalez@dcsmart.app',
  'auditoria@dcsmart.app': 'gmalachane@dcsmart.app',
  'estudio@dcsmart.app': 'jherrera@dcsmart.app',
  'operaciones@dcsmart.app': 'gescobar@dcsmart.app',
  'reportes@dcsmart.app': 'jbardinella@dcsmart.app',
  'rrhh@dcsmart.app': 'acorra@dcmanagement.com.ar',
  'tesoreria@dcsmart.app': 'nmeza@dcsmart.app'
}

const aplicar = process.argv.includes('--aplicar')
const db = new PrismaClient()
const chatReal = (c) => /^users\/\d{10,}$/.test(c || '')

console.log(aplicar ? 'APLICANDO cambios\n' : 'MODO PRUEBA (no escribe nada). Agregá --aplicar para aplicarlo.\n')
for (const [viejo, nuevo] of Object.entries(PARES)) {
  const [v, n] = await Promise.all([db.extUser.findUnique({ where: { email: viejo } }), db.extUser.findUnique({ where: { email: nuevo } })])
  if (!v || !n) {
    console.log(`SALTEO ${viejo} -> ${nuevo}: falta la fila ${!v ? 'vieja' : 'nueva'}`)
    continue
  }
  const [pagos, asignaciones] = await Promise.all([
    db.pagoSeguimiento.count({ where: { asignado_a: viejo } }),
    db.tareaAsignacion.count({ where: { asignado_a: viejo } })
  ])
  const cambios = []
  if (v.es_admin_global && !n.es_admin_global) cambios.push('pasa admin')
  if (chatReal(v.chat_user_name) && !n.chat_user_name) cambios.push('pasa id de Chat')
  if (pagos) cambios.push(`${pagos} pago(s)`)
  if (asignaciones) cambios.push(`${asignaciones} asignacion(es)`)
  if (v.activo) cambios.push('desactiva la vieja')

  if (aplicar && cambios.length) {
    await db.$transaction(async (tx) => {
      if (v.es_admin_global && !n.es_admin_global) await tx.extUser.update({ where: { id: n.id }, data: { es_admin_global: true } })
      if (chatReal(v.chat_user_name) && !n.chat_user_name) {
        await tx.extUser.update({ where: { id: v.id }, data: { chat_user_name: null } })
        await tx.extUser.update({ where: { id: n.id }, data: { chat_user_name: v.chat_user_name } })
      }
      await tx.pagoSeguimiento.updateMany({ where: { asignado_a: viejo }, data: { asignado_a: nuevo } })
      await tx.tareaAsignacion.updateMany({ where: { asignado_a: viejo }, data: { asignado_a: nuevo } })
      if (v.activo) await tx.extUser.update({ where: { id: v.id }, data: { activo: false } })
    })
  }
  console.log(`${viejo.padEnd(30)} -> ${nuevo.padEnd(32)} ${cambios.join(', ') || 'nada que hacer'}`)
}
await db.$disconnect()
