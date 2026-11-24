import { crearianCiclo } from './dependencias.js'

// Al sumar un local a una tarea, el local nuevo entra al mismo circuito que
// los demas locales de esa tarea. Si los otros locales de "CMV" esperan a
// "VTA/OP", el CMV del local nuevo espera al VTA/OP DEL MISMO LOCAL; y si el
// "Informe" de los otros locales espera a su CMV, el Informe del local nuevo
// pasa a esperar a este CMV.
//
// Antes cada local nuevo quedaba suelto y habia que acordarse de cargar las
// esperas a mano: en noviembre de 2026 faltaban en varios locales del
// circuito VTA/OP -> CMV -> Informe.
//
// Solo crea lo que tiene par en el mismo local (o "Toda la empresa" con
// "Toda la empresa"), y nunca algo que cierre un ciclo. Devuelve cuantas creo.
export async function heredarDependencias(db, asignacion) {
  const hermanas = await db.tareaAsignacion.findMany({
    where: { id_tarea: asignacion.id_tarea, activa: true, NOT: { id: asignacion.id } },
    select: { id: true }
  })
  if (!hermanas.length) return { creadas: 0 }
  const idsHermanas = new Set(hermanas.map((h) => h.id))

  const filas = await db.tareaAsignacionDependencia.findMany({
    where: {
      activa: true,
      OR: [{ id_asignacion: { in: [...idsHermanas] } }, { id_asignacion_prerequisito: { in: [...idsHermanas] } }]
    },
    select: {
      id_asignacion: true,
      id_asignacion_prerequisito: true,
      asignacion: { select: { id_tarea: true, activa: true } },
      prerequisito: { select: { id_tarea: true, activa: true } }
    }
  })

  // Tareas a las que esperan los otros locales, y tareas que los esperan a ellos.
  const tareasPrevias = new Set()
  const tareasSiguientes = new Set()
  for (const f of filas) {
    if (idsHermanas.has(f.id_asignacion) && f.prerequisito?.activa) tareasPrevias.add(f.prerequisito.id_tarea)
    if (idsHermanas.has(f.id_asignacion_prerequisito) && f.asignacion?.activa) tareasSiguientes.add(f.asignacion.id_tarea)
  }
  tareasPrevias.delete(asignacion.id_tarea)
  tareasSiguientes.delete(asignacion.id_tarea)

  const parDe = (idTarea) => db.tareaAsignacion.findFirst({
    where: { id_tarea: idTarea, id_local_ext: asignacion.id_local_ext ?? null, activa: true },
    select: { id: true }
  })

  let creadas = 0
  async function crear(idEspera, idPrevia) {
    if (await crearianCiclo(db, { idAsignacion: idEspera, idPrerequisito: idPrevia })) return
    try {
      await db.tareaAsignacionDependencia.create({ data: { id_asignacion: idEspera, id_asignacion_prerequisito: idPrevia } })
      creadas++
    } catch (err) {
      if (err.code !== 'P2002') throw err
      // Ya estaba (de cuando este local tuvo la tarea antes): vuelve a valer.
      const r = await db.tareaAsignacionDependencia.updateMany({
        where: { id_asignacion: idEspera, id_asignacion_prerequisito: idPrevia, activa: false },
        data: { activa: true }
      })
      creadas += r.count
    }
  }

  for (const idTarea of tareasPrevias) {
    const par = await parDe(idTarea)
    if (par) await crear(asignacion.id, par.id)
  }
  for (const idTarea of tareasSiguientes) {
    const par = await parDe(idTarea)
    if (par) await crear(par.id, asignacion.id)
  }
  return { creadas }
}
