// Agrupa eventos crudos de Calendar por dia y, dentro de cada dia, por
// nombre de local -- mismo agrupamiento que usa el kiosko (ver
// kiosko/index.html:pintarSemana), para que la vista "Agenda" de gestion
// se sienta la misma pantalla. Los eventos "sin local" (alcance empresa)
// quedan en su propio grupo "Toda la empresa".
export function agruparPorDiaYLocal(eventos, mapaLocales) {
  const ahora = new Date()
  const dias = new Map() // fechaISO -> { fecha: Date, grupos: Map(local -> tareas[]) }

  for (const ev of eventos) {
    const props = ev.extendedProperties?.private || {}
    const idLocal = props.id_local_ext || null
    const nombreLocal = idLocal ? mapaLocales.get(idLocal) || 'Local sin nombre' : 'Toda la empresa'
    const inicio = ev.start?.dateTime || ev.start?.date
    const fin = ev.end?.dateTime || ev.end?.date
    const fechaISO = (inicio || '').slice(0, 10)
    if (!fechaISO) continue

    const hecha = props.estado === 'REALIZADA' || props.estado === 'APROBADA'
    const vencida = !hecha && fin && ahora > new Date(fin)

    if (!dias.has(fechaISO)) dias.set(fechaISO, { fecha: new Date(`${fechaISO}T00:00:00`), grupos: new Map() })
    const dia = dias.get(fechaISO)
    if (!dia.grupos.has(nombreLocal)) dia.grupos.set(nombreLocal, [])
    dia.grupos.get(nombreLocal).push({
      id: ev.id,
      titulo: ev.summary,
      estado: hecha ? 'realizada' : vencida ? 'vencida' : 'pendiente'
    })
  }

  return [...dias.values()].sort((a, b) => a.fecha - b.fecha)
}
