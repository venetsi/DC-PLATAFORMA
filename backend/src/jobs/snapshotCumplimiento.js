// Job diario: escribe un snapshot de CumplimientoDiario por departamento (y
// por local dentro de cada departamento) para el dia que termino. Es la
// unica fuente de reportes historicos/agregados -- /api/reportes SOLO lee
// esta tabla, nunca recalcula agregando eventos de Calendar en vivo.
//
// Uso: node src/jobs/snapshotCumplimiento.js [YYYY-MM-DD]
// Sin argumento, usa el dia de ayer (UTC).
import { prisma, listarInstancias } from './lib.js'

function rangoDelDia(fechaISO) {
  const inicio = new Date(`${fechaISO}T00:00:00.000Z`)
  const fin = new Date(`${fechaISO}T23:59:59.999Z`)
  return { inicio, fin }
}

function fechaDeAyer() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function correr(fechaISO) {
  const { inicio, fin } = rangoDelDia(fechaISO)
  const departamentos = await prisma.departamento.findMany({ where: { activo: true, id_calendar_google: { not: null } } })

  let escritos = 0
  for (const depto of departamentos) {
    const items = await listarInstancias({
      calendarId: depto.id_calendar_google,
      timeMin: inicio.toISOString(),
      timeMax: fin.toISOString()
    })

    const porLocal = new Map() // id_local_ext (o '' para agregado) -> contadores
    const total = { total_tareas: 0, realizadas: 0, vencidas_sin_hacer: 0 }

    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const idLocal = props.id_local_ext || ''
      const bucket = porLocal.get(idLocal) ?? { total_tareas: 0, realizadas: 0, vencidas_sin_hacer: 0 }

      bucket.total_tareas++
      total.total_tareas++
      const hecha = props.estado === 'REALIZADA' || props.estado === 'APROBADA'
      if (hecha) {
        bucket.realizadas++
        total.realizadas++
      } else {
        const finEvento = new Date(evento.end?.date || evento.end?.dateTime)
        if (fin > finEvento) {
          bucket.vencidas_sin_hacer++
          total.vencidas_sin_hacer++
        }
      }
      porLocal.set(idLocal, bucket)
    }

    // Fila agregada del departamento completo (id_local_ext = '', ver nota en schema.prisma).
    await prisma.cumplimientoDiario.upsert({
      where: { id_departamento_id_local_ext_fecha: { id_departamento: depto.id, id_local_ext: '', fecha: inicio } },
      create: { id_departamento: depto.id, id_local_ext: '', fecha: inicio, ...total },
      update: total
    })
    escritos++

    // Filas por local (si hubo alguna tarea con id_local_ext real).
    for (const [idLocal, counts] of porLocal) {
      if (!idLocal) continue
      await prisma.cumplimientoDiario.upsert({
        where: { id_departamento_id_local_ext_fecha: { id_departamento: depto.id, id_local_ext: idLocal, fecha: inicio } },
        create: { id_departamento: depto.id, id_local_ext: idLocal, fecha: inicio, ...counts },
        update: counts
      })
      escritos++
    }
  }
  return { fecha: fechaISO, departamentos: departamentos.length, filas_escritas: escritos }
}

const fechaArg = process.argv[2] || fechaDeAyer()
correr(fechaArg)
  .then((r) => {
    console.log('Snapshot de cumplimiento OK:', r)
  })
  .catch((err) => {
    console.error('Snapshot de cumplimiento fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
