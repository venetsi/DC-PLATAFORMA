import { clasificarInstancia, diasVencida, hoyEnArgentina } from './vencimiento.js'

// Agrupa eventos crudos de Calendar por dia y, dentro de cada dia, por
// nombre de local -- mismo agrupamiento que usa el kiosko (ver
// kiosko/index.html:pintarSemana), para que la vista "Agenda" de gestion
// se sienta la misma pantalla. Los eventos "sin local" (alcance empresa)
// quedan en su propio grupo "Toda la empresa".
export function agruparPorDiaYLocal(eventos, mapaLocales) {
  const hoyISO = hoyEnArgentina()
  const dias = new Map() // fechaISO -> { fecha: Date, grupos: Map(local -> tareas[]) }

  for (const ev of eventos) {
    const props = ev.extendedProperties?.private || {}
    const idLocal = props.id_local_ext || null
    const nombreLocal = idLocal ? mapaLocales.get(idLocal) || 'Local sin nombre' : 'Toda la empresa'
    const { estado, fechaISO } = clasificarInstancia(ev)
    if (!fechaISO) continue

    if (!dias.has(fechaISO)) dias.set(fechaISO, { fecha: new Date(`${fechaISO}T00:00:00`), grupos: new Map() })
    const dia = dias.get(fechaISO)
    if (!dia.grupos.has(nombreLocal)) dia.grupos.set(nombreLocal, [])
    dia.grupos.get(nombreLocal).push({
      id: ev.id,
      // El summary lleva el local/grupo (ver backend lib/titulo.js) para que
      // se entienda en Google Calendar; acá se usa el nombre limpio porque
      // esta vista ya agrupa por local. Fallback para eventos previos.
      titulo: props.nombre_tarea || ev.summary,
      estado,
      asignadoA: props.asignado_a || null,
      realizadaPor: props.realizada_por || null,
      realizadaEn: props.realizada_en || null,
      // El departamento del evento, para poder marcar desde una vista que no
      // sea la del departamento propio. Se escribe desde siempre en
      // asignaciones.js pero hasta ahora no se leía.
      idDepartamento: props.id_departamento || null,
      diasVencida: estado === 'vencida' ? diasVencida(ev, { hoyISO }) : 0,
      // Prerrequisitos sin cumplir, resueltos en el backend: evaluarlos acá
      // exigiría leer calendarios de otros departamentos (ver dependencias.js).
      esperaA: ev.espera_a || null
    })
  }

  return [...dias.values()].sort((a, b) => a.fecha - b.fecha)
}
