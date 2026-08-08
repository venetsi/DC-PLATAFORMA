// Agrupa eventos crudos de Calendar por nombre de local, para las vistas
// "Agenda" (gestion) y kiosko. Los eventos "sin local" (alcance empresa)
// quedan en su propio grupo.
export function agruparPorLocal(eventos, mapaLocales) {
  const grupos = new Map()
  for (const ev of eventos) {
    const props = ev.extendedProperties?.private || {}
    const idLocal = props.id_local_ext || null
    const nombre = idLocal ? mapaLocales.get(idLocal) || 'Local sin nombre' : 'Toda la empresa'
    if (!grupos.has(nombre)) grupos.set(nombre, [])
    grupos.get(nombre).push({
      id: ev.id,
      titulo: ev.summary,
      estado: props.estado || 'PENDIENTE',
      inicio: ev.start?.dateTime || ev.start?.date,
      realizada_por: props.realizada_por || null
    })
  }
  return grupos
}
