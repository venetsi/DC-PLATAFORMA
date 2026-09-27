import { estaHecha } from './vencimiento.js'

// Reprograma UNA instancia puntual (no el maestro, no el resto de la serie) a
// otra fecha, y propaga el mismo corrimiento a las copias de los
// departamentos con los que se comparte la asignacion. Mismo patron y mismo
// shape de retorno que marcar-instancia.js -- `yaEstaba` en vez de reintentar
// silenciosamente, para que la ruta HTTP decida el codigo de respuesta.
//
// `deps` tiene el mismo shape que asegurarDepartamento: desde una ruta se
// pasa `fastify` tal cual.
export async function reprogramarInstanciaYPropagar(deps, {
  calendarId,
  instanceId,
  emailUsuario,
  nuevaFecha,
  motivo = null,
  ahora = new Date()
}) {
  const { gcal, db, log = console } = deps

  const actual = await gcal.leerInstancia({ calendarId, instanceId })
  if (!actual) return { evento: null, noExiste: true, yaEstaba: false, propagadas: [] }

  const propsActuales = actual.extendedProperties?.private || {}
  // Reprogramar una instancia ya cerrada (hecha o no aplica) no tiene sentido
  // -- mismo criterio que "no aplica" sobre una ya cerrada.
  if (estaHecha(propsActuales)) {
    return { evento: actual, noExiste: false, yaEstaba: true, propagadas: [] }
  }

  const idAsignacion = propsActuales.id_asignacion
  const fechaVieja = actual.start?.date
  // Sin cambio real (o evento que no es de dia completo): no-op, nada que
  // escribir ni que propagar.
  if (!fechaVieja || nuevaFecha === fechaVieja) {
    return { evento: actual, noExiste: false, yaEstaba: false, propagadas: [] }
  }

  const ahoraISO = ahora.toISOString()
  const logLine = `${ahoraISO} - REPROGRAMADA de ${fechaVieja} a ${nuevaFecha} por ${emailUsuario}${motivo ? `: ${motivo}` : ''}`

  const evento = await gcal.moverInstancia({ calendarId, instanceId, nuevaFecha, logLine })

  const propagar = async () => {
    if (!idAsignacion) return []
    const asignacion = await db.tareaAsignacion.findUnique({
      where: { id: idAsignacion },
      include: { tarea: { include: { departamento: true } }, compartidas: { include: { departamento: true } } }
    })
    const otros = [asignacion?.tarea?.departamento, ...(asignacion?.compartidas.map((c) => c.departamento) ?? [])]
      .filter((d) => d?.id_calendar_google && d.id_calendar_google !== calendarId)

    const propagadas = []
    for (const departamento of otros) {
      // Una copia que falla no puede tumbar la reprogramacion principal --
      // mismo criterio que marcar-instancia.js.
      try {
        const instancia = await gcal.buscarInstanciaPorFecha({
          calendarId: departamento.id_calendar_google,
          idAsignacion,
          fechaISO: fechaVieja
        })
        if (!instancia) continue
        await gcal.moverInstancia({
          calendarId: departamento.id_calendar_google,
          instanceId: instancia.id,
          nuevaFecha,
          logLine
        })
        propagadas.push({ id_departamento: departamento.id, instanceId: instancia.id })
      } catch (err) {
        log.warn?.({ err: err.message, departamento: departamento.id }, 'no se pudo propagar la reprogramacion')
      }
    }
    return propagadas
  }

  return { evento, noExiste: false, yaEstaba: false, propagadas: await propagar() }
}
