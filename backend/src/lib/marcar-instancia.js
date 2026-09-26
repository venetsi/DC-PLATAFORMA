import { estaHecha } from './vencimiento.js'

// Marcar una instancia como realizada + propagarla a las copias de los
// departamentos con los que se comparte la asignacion.
//
// Vivia inline dentro del handler HTTP de instancias.js, y ese mismo patron
// esta repetido a mano en varios lugares del repo. Se extrae porque hay dos
// consumidores mas que no pasan por HTTP: la Chat App (marcar desde un boton
// de Chat) y las dependencias (que necesitan un punto de intercepcion ANTES
// del patch -- antes no existia ninguno, el handler patcheaba sin validar
// nada).
//
// `deps` tiene el mismo shape que usa asegurarDepartamento: desde una ruta se
// pasa `fastify` tal cual; desde un job standalone, { db, gcal, log }.

// Se le pasa desde afuera (routes/instancias.js) para no acoplar este modulo
// a las dependencias: si no viene, no evalua nada y `avisos` queda vacio.
export async function marcarInstanciaYPropagar(deps, {
  calendarId,
  instanceId,
  emailUsuario,
  ahora = new Date(),
  evaluarAvisos = null,
  propagarEnBackground = false,
  // NO_APLICA cierra la instancia sin contarla como hecha (ver lib/vencimiento.js).
  estado = 'REALIZADA',
  motivo = null
}) {
  const { gcal, db, log = console } = deps
  const ahoraISO = ahora.toISOString()

  // Se lee ANTES de patchear: hace falta el id_asignacion y la fecha para
  // evaluar prerrequisitos, y ademas permite cortar temprano si ya estaba
  // marcada (un doble click desde Chat no debe duplicar la linea de historial).
  const actual = await gcal.leerInstancia({ calendarId, instanceId })
  const propsActuales = actual?.extendedProperties?.private || {}
  const idAsignacion = propsActuales.id_asignacion
  const fechaISO = actual?.start?.date || String(actual?.start?.dateTime || '').slice(0, 10) || null

  if (estaHecha(propsActuales)) {
    return { evento: actual, yaEstaba: true, propagadas: [], avisos: [] }
  }

  // Punto de intercepcion: las dependencias avisan, NO bloquean. El resultado
  // viaja a la respuesta Y al historial del evento, para que quede asentado
  // que se marco fuera de orden.
  const avisos = estado === 'REALIZADA' && evaluarAvisos && idAsignacion && fechaISO
    ? await evaluarAvisos({ idAsignacion, fechaISO })
    : []

  const sufijoAviso = avisos.length
    ? ` (sin: ${avisos.map((a) => `${a.nombre_tarea} — ${a.departamento}`).join('; ')})`
    : ''

  const extendedProperties = estado === 'NO_APLICA'
    ? { estado, no_aplica_por: emailUsuario, no_aplica_en: ahoraISO, no_aplica_motivo: motivo || '' }
    : {
        estado: 'REALIZADA',
        realizada_por: emailUsuario,
        realizada_en: ahoraISO,
        ...(avisos.length ? { marcada_fuera_de_orden: '1' } : {})
      }
  const logLine = estado === 'NO_APLICA'
    ? `${ahoraISO} - NO APLICA por ${emailUsuario}: ${motivo}`
    : `${ahoraISO} - REALIZADA por ${emailUsuario}${sufijoAviso}`

  const evento = await gcal.marcarInstancia({ calendarId, instanceId, extendedProperties, logLine })

  const propagar = async () => {
    if (!idAsignacion || !fechaISO) return []
    const asignacion = await db.tareaAsignacion.findUnique({
      where: { id: idAsignacion },
      include: { tarea: { include: { departamento: true } }, compartidas: { include: { departamento: true } } }
    })
    const otros = [asignacion?.tarea?.departamento, ...(asignacion?.compartidas.map((c) => c.departamento) ?? [])]
      .filter((d) => d?.id_calendar_google && d.id_calendar_google !== calendarId)

    const propagadas = []
    for (const departamento of otros) {
      // Una copia que falla no puede tumbar el marcado principal: antes, si
      // fallaba la del tercer departamento, el usuario veia un error aunque
      // su marca SI se habia aplicado.
      try {
        const instancia = await gcal.buscarInstanciaPorFecha({
          calendarId: departamento.id_calendar_google,
          idAsignacion,
          fechaISO
        })
        if (!instancia) continue
        await gcal.marcarInstancia({
          calendarId: departamento.id_calendar_google,
          instanceId: instancia.id,
          extendedProperties,
          logLine
        })
        propagadas.push({ id_departamento: departamento.id, instanceId: instancia.id })
      } catch (err) {
        log.warn?.({ err: err.message, departamento: departamento.id }, 'no se pudo propagar el marcado')
      }
    }
    return propagadas
  }

  // Chat corta a los 30s y `withBackoff` puede dormir hasta 30s por si solo
  // ante un 429: ahi conviene responder apenas termino el marcado principal.
  if (propagarEnBackground) {
    propagar().catch((err) => log.error?.({ err: err.message }, 'propagacion en background fallo'))
    return { evento, yaEstaba: false, propagadas: [], avisos }
  }

  return { evento, yaEstaba: false, propagadas: await propagar(), avisos }
}
