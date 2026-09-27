// Job diario: escribe un snapshot de CumplimientoDiario por departamento (y
// por local dentro de cada departamento) para el dia que termino. Es la
// unica fuente de reportes historicos/agregados -- /api/reportes SOLO lee
// esta tabla, nunca recalcula agregando eventos de Calendar en vivo.
//
// Ademas escribe CumplimientoInstancia (una fila por tarea x local x dia, ver
// lib/cumplimiento-instancias.js) re-evaluando los ultimos 60 dias, para que
// una atrasada que se hizo despues quede como "hecha tarde".
//
// Uso: node src/jobs/snapshotCumplimiento.js [YYYY-MM-DD] [--instancias-desde=YYYY-MM-DD]
// Sin fecha, usa el dia de ayer en Argentina. --instancias-desde completa
// CumplimientoInstancia hacia atras desde esa fecha (backfill).
import { prisma, listarInstancias } from './lib.js'
import { clasificarInstancia, hoyEnArgentina } from '../lib/vencimiento.js'
import { registrarInstancias } from '../lib/cumplimiento-instancias.js'

const DIAS_REEVALUADOS = 60

function restarDias(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10)
}

function rangoDelDia(fechaISO) {
  // `inicio` se usa ademas como la clave `fecha` (columna DATE) de
  // CumplimientoDiario, asi que se mantiene a medianoche UTC: cambiarlo
  // duplicaria las filas historicas ya escritas.
  const inicio = new Date(`${fechaISO}T00:00:00.000Z`)

  // OJO: dos fechas distintas que es facil confundir (lo confundi al escribirlo).
  //
  // `finQuery` acota el events.list y tiene que quedarse DENTRO del dia UTC:
  // los eventos son all-day, asi que uno del dia siguiente arranca a las
  // 00:00Z y se colaria en el rango si estiraramos el timeMax hasta las
  // 03:00Z -- contando el doble de tareas.
  const finQuery = new Date(`${fechaISO}T23:59:59.999Z`)

  // `referencia` es contra que instante se decide si algo quedo vencido, y
  // ESA si es hora argentina: el dia termina a la medianoche ART (03:00 UTC
  // del dia siguiente). El +1ms es para que una tarea del propio dia cuente
  // como vencida al cierre (clasificarInstancia compara con > estricto).
  const [a, m, d] = fechaISO.split('-').map(Number)
  const referencia = new Date(Date.UTC(a, m - 1, d + 1, 3, 0, 0) + 1)

  return { inicio, finQuery, referencia }
}

function fechaDeAyer() {
  const hoy = hoyEnArgentina()
  const [a, m, d] = hoy.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10)
}

async function correr(fechaISO) {
  const { inicio, finQuery, referencia } = rangoDelDia(fechaISO)
  const departamentos = await prisma.departamento.findMany({ where: { activo: true, id_calendar_google: { not: null } } })

  let escritos = 0
  for (const depto of departamentos) {
    const items = await listarInstancias({
      calendarId: depto.id_calendar_google,
      timeMin: inicio.toISOString(),
      timeMax: finQuery.toISOString()
    })

    const porLocal = new Map() // id_local_ext (o '' para agregado) -> contadores
    const total = { total_tareas: 0, realizadas: 0, vencidas_sin_hacer: 0 }

    for (const evento of items) {
      const props = evento.extendedProperties?.private || {}
      const idLocal = props.id_local_ext || ''
      const bucket = porLocal.get(idLocal) ?? { total_tareas: 0, realizadas: 0, vencidas_sin_hacer: 0 }

      // Mismo criterio que tv.js y avisosChat -- pero la referencia es el
      // cierre del dia snapshoteado, no `now`: el snapshot cierra un dia
      // del pasado y tiene que juzgarlo con el reloj de ese dia.
      const { hecha, vencida, noAplica } = clasificarInstancia(evento, { referencia })
      // "No aplica" no entra en el % de cumplimiento, ni arriba ni abajo.
      if (noAplica) continue
      bucket.total_tareas++
      total.total_tareas++
      if (hecha) {
        bucket.realizadas++
        total.realizadas++
      } else if (vencida) {
        bucket.vencidas_sin_hacer++
        total.vencidas_sin_hacer++
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

const args = process.argv.slice(2)
const fechaArg = args.find((a) => !a.startsWith('--')) || fechaDeAyer()
const desdeInstancias = args.find((a) => a.startsWith('--instancias-desde='))?.split('=')[1] || restarDias(fechaArg, DIAS_REEVALUADOS - 1)

correr(fechaArg)
  .then(async (r) => {
    console.log('Snapshot de cumplimiento OK:', r)
    const inst = await registrarInstancias({ db: prisma, listarInstancias }, { desde: desdeInstancias, hasta: fechaArg })
    console.log('Cumplimiento por instancia OK:', inst)
  })
  .catch((err) => {
    console.error('Snapshot de cumplimiento fallo:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
