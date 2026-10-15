// Marcar una tarea como hecha EN PANTALLA, al instante, sin esperar a Calendar.
//
// Marcar en el servidor encadena varias llamadas a Google Calendar y puede
// tardar varios segundos. La persona ve la tarea hecha apenas toca el boton; si
// el servidor despues rechaza la marca, se vuelve a lo que habia (ver los
// llamadores). Los datos reales llegan con la recarga que sigue.
//
// Marca el evento y sus copias en otros departamentos (la misma asignacion el
// mismo dia): el servidor tambien las propaga.

const fechaDe = (ev) => ev.start?.date || String(ev.start?.dateTime || '').slice(0, 10)

export function marcarEnLocal(eventos, { idDepto, instanceId, email, ahora = new Date() }) {
  const objetivo = eventos.find((e) => e.id === instanceId && (idDepto == null || e.__depto == null || e.__depto === idDepto))
  if (!objetivo) return eventos
  const idAsignacion = objetivo.extendedProperties?.private?.id_asignacion
  const fecha = fechaDe(objetivo)
  return eventos.map((e) => {
    const copia = idAsignacion && e.extendedProperties?.private?.id_asignacion === idAsignacion && fechaDe(e) === fecha
    if (e !== objetivo && !copia) return e
    const props = e.extendedProperties?.private || {}
    if (props.estado === 'REALIZADA') return e
    return {
      ...e,
      extendedProperties: {
        ...e.extendedProperties,
        private: { ...props, estado: 'REALIZADA', realizada_por: email || props.realizada_por, realizada_en: ahora.toISOString() }
      }
    }
  })
}
