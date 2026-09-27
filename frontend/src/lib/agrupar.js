import { clasificarInstancia, diasVencida, hoyEnArgentina } from './vencimiento.js'

// Agrupa eventos crudos de Calendar por dia y, dentro de cada dia, por
// nombre de local -- mismo agrupamiento que usa el kiosko (ver
// kiosko/index.html:pintarSemana), para que la vista "Agenda" de gestion
// se sienta la misma pantalla. Los eventos "sin local" (alcance empresa)
// quedan en su propio grupo "Toda la empresa".
// Un evento crudo de Calendar -> la tarea tal como la muestran la agenda y el
// detalle. Exportado para que la vista Semana/Mes abra el mismo detalle.
export function aTarea(ev, mapaLocales, hoyISO = hoyEnArgentina()) {
  const props = ev.extendedProperties?.private || {}
  const idLocal = props.id_local_ext || null
  const { estado, fechaISO } = clasificarInstancia(ev)
  return {
    id: ev.id,
    fechaISO,
    local: idLocal ? mapaLocales.get(idLocal) || 'Local sin nombre' : 'Toda la empresa',
    // El summary lleva el local/grupo (ver backend lib/titulo.js) para que
    // se entienda en Google Calendar; acá se usa el nombre limpio porque
    // esta vista ya agrupa por local. Fallback para eventos previos.
    titulo: props.nombre_tarea || ev.summary,
    estado,
    asignadoA: props.asignado_a || null,
    realizadaPor: props.realizada_por || null,
    realizadaEn: props.realizada_en || null,
    noAplicaMotivo: props.no_aplica_motivo || null,
    noAplicaPor: props.no_aplica_por || null,
    // El departamento del evento, para poder marcar desde una vista que no
    // sea la del departamento propio.
    idDepartamento: props.id_departamento || null,
    // La asignacion (tarea x local) de la que sale esta instancia: la usa el
    // panel Editar del detalle.
    idAsignacion: props.id_asignacion || null,
    diasVencida: estado === 'vencida' ? diasVencida(ev, { hoyISO }) : 0,
    // Prerrequisitos sin cumplir, resueltos en el backend: evaluarlos acá
    // exigiría leer calendarios de otros departamentos (ver dependencias.js).
    esperaA: ev.espera_a || null,
    // Historial append-only del evento (marcas, notas, reasignaciones).
    historial: String(ev.description || '').split('\n').map((l) => l.trim()).filter(Boolean)
  }
}

export function agruparPorDiaYLocal(eventos, mapaLocales) {
  const hoyISO = hoyEnArgentina()
  const dias = new Map() // fechaISO -> { fecha: Date, grupos: Map(local -> tareas[]) }

  for (const ev of eventos) {
    const tarea = aTarea(ev, mapaLocales, hoyISO)
    if (!tarea.fechaISO) continue

    if (!dias.has(tarea.fechaISO)) dias.set(tarea.fechaISO, { fecha: new Date(`${tarea.fechaISO}T00:00:00`), grupos: new Map() })
    const dia = dias.get(tarea.fechaISO)
    if (!dia.grupos.has(tarea.local)) dia.grupos.set(tarea.local, [])
    dia.grupos.get(tarea.local).push(tarea)
  }

  return [...dias.values()].sort((a, b) => a.fecha - b.fecha)
}
