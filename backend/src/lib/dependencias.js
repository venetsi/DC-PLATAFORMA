// Dependencias entre asignaciones: AVISAN, no bloquean.
//
// Semantica elegida (ver docs del plan): el prerrequisito esta cumplido si la
// instancia de LA MISMA FECHA esta REALIZADA/APROBADA. Si el prerrequisito no
// tiene instancia ese dia, la dependencia NO APLICA y no se avisa nada.
//
// Por que la misma fecha y no "la ultima anterior" ni "alguna pendiente":
//   - Se resuelve con buscarInstanciaPorFecha, que ya existe y esta probada
//     (es la que usa la propagacion entre departamentos). Cero codigo nuevo de
//     acceso a Calendar.
//   - Coincide con el mundo real: el CMV del dia X habilita el reporte del dia X.
//   - "Alguna pendiente en cualquier fecha" convierte cualquier atraso viejo en
//     un aviso permanente que la gente aprende a ignorar. Mata la señal.
//   - Recurrencias que no coinciden (una diaria que depende de una mensual)
//     quedan cubiertas por "sin instancia ese dia = no aplica": para un aviso
//     que no bloquea, el costo de un falso negativo es cero y el de un falso
//     positivo es que dejen de leerlos.
import { estaHecha } from './vencimiento.js'

const INCLUDE_PREREQ = {
  prerequisito: {
    include: {
      tarea: { include: { departamento: true } },
      local: true
    }
  }
}

// Prerrequisitos NO cumplidos de (idAsignacion, fechaISO). [] = todo listo.
// NUNCA tira: avisar es una comodidad, no puede romper el marcado.
export async function prerrequisitosPendientes(deps, { idAsignacion, fechaISO }) {
  const { db, gcal, log = console } = deps
  try {
    const filas = await db.tareaAsignacionDependencia.findMany({
      where: { id_asignacion: idAsignacion, activa: true },
      include: INCLUDE_PREREQ
    })
    if (!filas.length) return []

    const avisos = []
    for (const fila of filas) {
      const aviso = await evaluarUna(gcal, fila.prerequisito, fechaISO)
      if (aviso) avisos.push(aviso)
    }
    return avisos
  } catch (err) {
    log.warn?.({ err: err.message, idAsignacion }, 'no se pudieron evaluar prerrequisitos')
    return []
  }
}

async function evaluarUna(gcal, prerequisito, fechaISO) {
  // Casos que NO aplican: la asignacion se dio de baja, la tarea se desactivo,
  // todavia no tiene agenda definida, o su departamento no tiene calendario.
  if (!prerequisito?.activa || !prerequisito.tarea?.activa) return null
  if (!prerequisito.id_calendar_event) return null
  const calendarId = prerequisito.tarea.departamento?.id_calendar_google
  if (!calendarId) return null

  const instancia = await gcal.buscarInstanciaPorFecha({
    calendarId,
    idAsignacion: prerequisito.id,
    fechaISO
  })
  // Sin instancia ese dia -> la dependencia no aplica.
  if (!instancia) return null
  if (estaHecha(instancia.extendedProperties?.private)) return null

  // Solo lo minimo indispensable: el evaluador corre con la service account y
  // lee el calendario de OTRO departamento, al que quien pregunta puede no
  // tener acceso. Nunca devolver el evento entero ni el calendarId.
  return {
    tipo: 'prerrequisito_pendiente',
    id_asignacion: prerequisito.id,
    nombre_tarea: prerequisito.tarea.nombre,
    departamento: prerequisito.tarea.departamento?.nombre || '',
    local: prerequisito.local?.nombre || 'Toda la empresa'
  }
}

// Version batch para los listados. Devuelve Map<`${idAsignacion}|${fecha}`, aviso[]>.
//
// El orden importa por performance: primero se pregunta a Postgres si hay
// alguna dependencia para esas asignaciones. Si no hay -- que va a ser el 95%
// de los casos -- se devuelven CERO llamadas a Calendar.
export async function mapaPrerrequisitos(deps, { instancias }) {
  const { db, gcal, log = console } = deps
  const mapa = new Map()
  try {
    const claves = []
    const idsAsignacion = new Set()
    for (const evento of instancias) {
      const props = evento.extendedProperties?.private || {}
      const idAsignacion = props.id_asignacion
      const fechaISO = evento.start?.date || String(evento.start?.dateTime || '').slice(0, 10)
      if (!idAsignacion || !fechaISO) continue
      if (estaHecha(props)) continue // ya esta hecha: no tiene sentido avisar
      idsAsignacion.add(idAsignacion)
      claves.push({ idAsignacion, fechaISO })
    }
    if (!idsAsignacion.size) return mapa

    const filas = await db.tareaAsignacionDependencia.findMany({
      where: { id_asignacion: { in: [...idsAsignacion] }, activa: true },
      include: INCLUDE_PREREQ
    })
    if (!filas.length) return mapa

    const porAsignacion = new Map()
    for (const fila of filas) {
      if (!porAsignacion.has(fila.id_asignacion)) porAsignacion.set(fila.id_asignacion, [])
      porAsignacion.get(fila.id_asignacion).push(fila.prerequisito)
    }

    // Cache por (prerequisito, fecha): la misma dependencia se repite en
    // muchas instancias del rango, no tiene sentido preguntarle a Calendar
    // una vez por bullet.
    const cache = new Map()
    for (const { idAsignacion, fechaISO } of claves) {
      const prerequisitos = porAsignacion.get(idAsignacion)
      if (!prerequisitos?.length) continue

      const avisos = []
      for (const prerequisito of prerequisitos) {
        const cacheKey = `${prerequisito.id}|${fechaISO}`
        if (!cache.has(cacheKey)) cache.set(cacheKey, await evaluarUna(gcal, prerequisito, fechaISO))
        const aviso = cache.get(cacheKey)
        if (aviso) avisos.push(aviso)
      }
      if (avisos.length) mapa.set(`${idAsignacion}|${fechaISO}`, avisos)
    }
    return mapa
  } catch (err) {
    log.warn?.({ err: err.message }, 'no se pudo armar el mapa de prerrequisitos')
    return mapa
  }
}

// true si agregar (idAsignacion -> idPrerequisito) cerraria un ciclo.
//
// La tabla es chica (decenas de filas), asi que se carga entera y se recorre
// en memoria: evita una CTE recursiva que Prisma no expresa bien.
export async function crearianCiclo(db, { idAsignacion, idPrerequisito }) {
  if (idAsignacion === idPrerequisito) return true

  const filas = await db.tareaAsignacionDependencia.findMany({
    where: { activa: true },
    select: { id_asignacion: true, id_asignacion_prerequisito: true }
  })
  const prerequisitosDe = new Map()
  for (const f of filas) {
    if (!prerequisitosDe.has(f.id_asignacion)) prerequisitosDe.set(f.id_asignacion, [])
    prerequisitosDe.get(f.id_asignacion).push(f.id_asignacion_prerequisito)
  }

  // Desde el prerrequisito propuesto, ¿se llega a la asignacion que espera?
  // Si se llega, agregarla cerraria el ciclo.
  const vistos = new Set()
  const pila = [idPrerequisito]
  while (pila.length) {
    const actual = pila.pop()
    if (actual === idAsignacion) return true
    if (vistos.has(actual)) continue
    vistos.add(actual)
    pila.push(...(prerequisitosDe.get(actual) || []))
  }
  return false
}
