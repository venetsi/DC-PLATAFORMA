// Dependencias entre asignaciones: AVISAN, no bloquean.
//
// REGLA (cambiada el 2026-09-28, pedido del usuario): una instancia de la
// tarea que espera (A, fecha d) espera a la ULTIMA instancia del prerrequisito
// (P) desde la fecha anterior de A, sin incluirla, hasta d inclusive. Ejemplo:
// el reporte del 3 espera al CMV del 1. Si en ese tramo P no tiene ninguna,
// la dependencia no aplica ese dia.
//
// Antes era "la instancia de P de la MISMA fecha", y dos tareas con agendas
// distintas (el CMV el 1 y el reporte el 3) no se conectaban nunca. El tramo
// se corta en la fecha anterior de A a proposito: asi un atraso viejo de P no
// se vuelve un aviso eterno (la señal que la gente aprende a ignorar), porque
// la instancia anterior de A ya "consumio" esa P.
//
// Tres miradas sobre la misma regla:
//   - espera / listas: a que P espera una instancia de A, y si ya se hicieron.
//   - la_espera: que instancia de A esta frenando una instancia de P.
//   - liberadas: al marcar una P, que instancias de A quedaron sin nada que
//     esperar (el aviso de Chat "Ya podés hacerla").
//
// El evaluador corre con la service account y lee calendarios de OTROS
// departamentos, a los que quien pregunta puede no tener acceso: hacia afuera
// sale solo lo minimo (nombre, departamento, local, fecha, estado, personas),
// nunca el evento entero ni el calendarId.
import { estaHecha, clasificarInstancia, fechaDeInstancia } from './vencimiento.js'

// Cuanto mira hacia atras (o adelante) una dependencia cuando la tarea que
// espera no tiene fecha anterior cerca. Cubre las mensuales con margen.
export const VENTANA_DIAS = 62

// Hasta cuantos niveles sube la cadena del detalle (A espera B, B espera C...).
export const MAX_NIVELES = 4

const INCLUDE_ASIGNACION = { tarea: { include: { departamento: true } }, local: true }

export function correrDias(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// ── Reglas puras (sin I/O, ver dependencias.test.js) ─────────────────────────
// `instancias` son { fecha, ... } ordenadas por fecha; `fechas`, strings ISO ordenados.

// La instancia de P que le corresponde a la de A en `fecha`: la ultima de P con
// fecha en (anterior de A, fecha], y nunca mas atras que VENTANA_DIAS.
export function prerequisitoQueCorresponde(instanciasP, fechasA, fecha) {
  let anterior = null
  for (const f of fechasA) {
    if (f < fecha) anterior = f
    else break
  }
  const tope = correrDias(fecha, -VENTANA_DIAS)
  const piso = anterior && anterior > tope ? anterior : tope
  let elegida = null
  for (const p of instanciasP) {
    if (p.fecha > piso && p.fecha <= fecha) elegida = p
  }
  return elegida
}

// La inversa: que instancia de A "consume" la instancia de P en `fechaP`. Es la
// primera de A en esa fecha o despues, salvo que antes de ella haya otra de P
// mas nueva (entonces la que manda es esa otra) o que quede fuera de la ventana.
export function dependienteQueCorresponde(instanciasA, fechasP, fechaP) {
  const w = instanciasA.find((a) => a.fecha >= fechaP)
  if (!w) return null
  if (fechaP <= correrDias(w.fecha, -VENTANA_DIAS)) return null
  if (fechasP.some((f) => f > fechaP && f <= w.fecha)) return null
  return w
}

// ── Lectura de Calendar ──────────────────────────────────────────────────────

// Una asignacion vale para evaluar si sigue activa, tiene agenda, y su
// departamento tiene calendario. Si no, la dependencia "no aplica": nunca
// avisa ni rompe.
function aplicable(asignacion) {
  return Boolean(
    asignacion?.activa &&
    asignacion.tarea?.activa &&
    asignacion.id_calendar_event &&
    asignacion.tarea.departamento?.id_calendar_google
  )
}

// Las instancias de UNA asignacion, leidas del calendario de su departamento
// dueño (las copias de los compartidos tienen las mismas fechas y el marcado se
// propaga).
//
// Se lee CADA CALENDARIO una sola vez por pedido y se reparte por
// id_asignacion. Antes era una lectura por asignacion (filtrando por
// extendedProperty): con el cronograma de informes cargado (31 P&L que
// esperan a 18 Auditar) eran 36 lecturas de Calendar por listado, ~5 s; asi
// son 2 (Reportes y Auditoria).
function lectorDeInstancias(gcal, { desde, hasta }, log = console, { esperaReintentoMs = 800 } = {}) {
  const porCalendario = new Map() // calendarId -> Promise<Map<idAsignacion, instancias[]>>
  // Calendarios que NO se pudieron leer enteros (error de Calendar o lectura
  // truncada). Una lectura fallida NO es "no tiene instancias": quien evalua
  // tiene que poder distinguirlas, o un error de red se lee como "todo listo"
  // y sale un "Ya podés hacerla" falso (ver leer.fallo).
  const fallidos = new Set()
  function leerCalendario(calendarId) {
    if (!porCalendario.has(calendarId)) {
      // Un error transitorio de Calendar (5xx, red) se reintenta UNA vez: esto
      // corre al marcar, una sola vez, y un fallo pierde el "Ya podés hacerla"
      // para siempre. Una lectura truncada no se reintenta: daria lo mismo.
      const leerUnaVez = () => leerCalendarioEntero(gcal, calendarId, desde, hasta)
      const conReintento = leerUnaVez().catch(async (err) => {
        if (err.truncada) throw err
        await new Promise((resolve) => setTimeout(resolve, esperaReintentoMs))
        return leerUnaVez()
      })
      porCalendario.set(calendarId, conReintento.catch((err) => {
        fallidos.add(calendarId)
        log.warn?.({ err: err.message, calendarId }, 'dependencias: no se pudo leer la agenda')
        return new Map()
      }))
    }
    return porCalendario.get(calendarId)
  }
  const leer = async (asignacion) => {
    if (!aplicable(asignacion)) return []
    const porAsignacion = await leerCalendario(asignacion.tarea.departamento.id_calendar_google)
    return porAsignacion.get(asignacion.id) || []
  }
  // ¿Fallo la lectura de la agenda de esta asignacion? Solo vale despues de
  // haberla leido con `leer` (la lectura es lo que llena el registro).
  leer.fallo = (asignacion) => aplicable(asignacion) && fallidos.has(asignacion.tarea.departamento.id_calendar_google)
  return leer
}

async function leerCalendarioEntero(gcal, calendarId, desde, hasta) {
  // Un dia de margen a cada lado: los eventos son de dia completo y el corte
  // de timeMin/timeMax depende de la zona del calendario. Despues se filtra
  // por la fecha real de cada instancia.
  // maxPaginas alto a proposito: aca una lectura truncada apaga las
  // dependencias del departamento, y las ventanas son anchas (hasta ~370 dias
  // en el detalle de la cadena). 40 paginas son 100.000 eventos.
  const items = await gcal.listarInstancias({
    calendarId,
    timeMin: `${correrDias(desde, -1)}T00:00:00Z`,
    timeMax: `${correrDias(hasta, 1)}T23:59:59Z`,
    maxPaginas: 40
  })
  // listarInstancias marca el resultado como truncado cuando llega al tope de
  // paginas: faltan eventos, asi que no se puede afirmar que algo "no existe".
  if (items.truncado) throw Object.assign(new Error('lectura truncada: hay mas eventos de los que se pudieron traer'), { truncada: true })
  const porAsignacion = new Map()
  for (const evento of items) {
    const props = evento.extendedProperties?.private || {}
    const fecha = fechaDeInstancia(evento)
    if (!props.id_asignacion || !fecha || fecha < desde || fecha > hasta) continue
    if (!porAsignacion.has(props.id_asignacion)) porAsignacion.set(props.id_asignacion, [])
    porAsignacion.get(props.id_asignacion).push({ id: evento.id, fecha, props, evento })
  }
  for (const lista of porAsignacion.values()) lista.sort((a, b) => a.fecha.localeCompare(b.fecha))
  return porAsignacion
}

// ── Lo que sale hacia afuera ─────────────────────────────────────────────────

function resumenAsignacion(asignacion) {
  return {
    id_asignacion: asignacion.id,
    nombre_tarea: asignacion.tarea.nombre,
    departamento: asignacion.tarea.departamento?.nombre || '',
    local: asignacion.local?.nombre || 'Toda la empresa'
  }
}

function detalleDeInstancia(instancia, { hechaAhora = null } = {}) {
  const p = instancia.props
  if (hechaAhora) {
    return { fecha: instancia.fecha, estado: hechaAhora.estado === 'NO_APLICA' ? 'no_aplica' : 'realizada', responsable: p.asignado_a || null, hecha_por: hechaAhora.por || null, hecha_en: hechaAhora.en || null }
  }
  return {
    fecha: instancia.fecha,
    estado: clasificarInstancia(instancia.evento).estado,
    responsable: p.asignado_a || null,
    hecha_por: p.realizada_por || p.no_aplica_por || null,
    hecha_en: p.realizada_en || p.no_aplica_en || null
  }
}

// ¿Esta la instancia que se acaba de marcar? El marcado recien hecho puede no
// verse todavia en un events.list (o haberse hecho en la copia de otro
// departamento, con la propagacion al dueño en background): se da por hecha
// igual en vez de depender de esa lectura.
function esLaRecienMarcada(hechaAhora, asignacion, instancia) {
  return Boolean(hechaAhora && hechaAhora.idAsignacion === asignacion.id && hechaAhora.fecha === instancia.fecha)
}

// Para la instancia de A en `fecha`: que prerrequisitos faltan (espera) y
// cuales ya estan (listas). Un prerrequisito sin instancia en el tramo no
// aparece en ninguna de las dos.
//
// `noVerificadas`: los prerrequisitos que NO se pudo evaluar porque fallo la
// lectura de su agenda (o la de la propia tarea, que fija el tramo). No son
// "listos" ni "pendientes": quien llama decide, y nunca debe tratarlos como
// listos (un "Ya podés hacerla" falso es peor que no avisar).
async function evaluarEspera(leer, asignacion, prerequisitos, fecha, { hechaAhora = null } = {}) {
  const espera = []
  const listas = []
  const noVerificadas = []
  if (!prerequisitos.length) return { espera, listas, noVerificadas }
  // Cada calendario se lee una sola vez por pedido (ver lectorDeInstancias);
  // pedirlos todos juntos evita esperarlos uno detras del otro (~1 s cada uno).
  await Promise.all([asignacion, ...prerequisitos].map((a) => leer(a)))
  const fechasA = (await leer(asignacion)).map((i) => i.fecha)
  const tramoIncierto = leer.fallo?.(asignacion)
  for (const prerequisito of prerequisitos) {
    if (!aplicable(prerequisito)) continue
    const instanciasP = await leer(prerequisito)
    if (tramoIncierto || leer.fallo?.(prerequisito)) {
      noVerificadas.push(resumenAsignacion(prerequisito))
      continue
    }
    const instancia = prerequisitoQueCorresponde(instanciasP, fechasA, fecha)
    if (!instancia) continue
    const recien = esLaRecienMarcada(hechaAhora, prerequisito, instancia)
    const nodo = { ...resumenAsignacion(prerequisito), ...detalleDeInstancia(instancia, { hechaAhora: recien ? hechaAhora : null }) }
    if (recien || estaHecha(instancia.props)) listas.push(nodo)
    else espera.push(nodo)
  }
  return { espera, listas, noVerificadas }
}

// ── API del modulo ───────────────────────────────────────────────────────────

// Prerrequisitos NO cumplidos de (idAsignacion, fechaISO). [] = nada que
// avisar: o esta todo listo, o no se pudo leer Calendar (en ese caso queda un
// warn en el log y no se avisa nada: es una comodidad, no puede romper el marcado).
// Lo usa el marcado para avisar "se marco, pero ojo". NUNCA tira: avisar es
// una comodidad, no puede romper el marcado.
export async function prerrequisitosPendientes(deps, { idAsignacion, fechaISO }) {
  const { db, gcal, log = console } = deps
  try {
    const filas = await db.tareaAsignacionDependencia.findMany({
      where: { id_asignacion: idAsignacion, activa: true },
      include: { asignacion: { include: INCLUDE_ASIGNACION }, prerequisito: { include: INCLUDE_ASIGNACION } }
    })
    if (!filas.length) return []
    const leer = lectorDeInstancias(gcal, { desde: correrDias(fechaISO, -VENTANA_DIAS), hasta: fechaISO }, log, { esperaReintentoMs: deps.esperaReintentoMs })
    const { espera } = await evaluarEspera(leer, filas[0].asignacion, filas.map((f) => f.prerequisito), fechaISO)
    return espera.map((p) => ({ tipo: 'prerrequisito_pendiente', ...p }))
  } catch (err) {
    log.warn?.({ err: err.message, idAsignacion }, 'no se pudieron evaluar prerrequisitos')
    return []
  }
}

// Version batch para los listados y la TV: Map<`${idAsignacion}|${fecha}`,
// { espera?, listas?, la_espera? }>, solo para instancias abiertas.
//   - espera:    los prerrequisitos que faltan.
//   - listas:    solo si ya no falta ninguno (la etiqueta "Lista").
//   - la_espera: las tareas que esta instancia esta frenando.
//
// Primero se pregunta a Postgres si hay alguna dependencia: si no hay -- el
// caso de casi todas las pantallas -- son CERO llamadas a Calendar.
export async function mapaDependencias(deps, { instancias }) {
  const { db, gcal, log = console } = deps
  const mapa = new Map()
  try {
    const abiertas = []
    for (const evento of instancias) {
      const props = evento.extendedProperties?.private || {}
      const fecha = fechaDeInstancia(evento)
      if (!props.id_asignacion || !fecha || estaHecha(props)) continue
      abiertas.push({ idAsignacion: props.id_asignacion, fecha })
    }
    if (!abiertas.length) return mapa

    const ids = [...new Set(abiertas.map((a) => a.idAsignacion))]
    const filas = await db.tareaAsignacionDependencia.findMany({
      where: { activa: true, OR: [{ id_asignacion: { in: ids } }, { id_asignacion_prerequisito: { in: ids } }] },
      include: { asignacion: { include: INCLUDE_ASIGNACION }, prerequisito: { include: INCLUDE_ASIGNACION } }
    })
    if (!filas.length) return mapa

    const enPantalla = new Set(ids)
    const asignaciones = new Map()
    const prerequisitosDe = new Map()
    const dependientesDe = new Map()
    const agregar = (mapaLista, clave, valor) => {
      if (!mapaLista.has(clave)) mapaLista.set(clave, [])
      mapaLista.get(clave).push(valor)
    }
    for (const f of filas) {
      asignaciones.set(f.asignacion.id, f.asignacion)
      asignaciones.set(f.prerequisito.id, f.prerequisito)
      if (enPantalla.has(f.id_asignacion)) agregar(prerequisitosDe, f.id_asignacion, f.prerequisito)
      if (enPantalla.has(f.id_asignacion_prerequisito)) agregar(dependientesDe, f.id_asignacion_prerequisito, f.asignacion)
    }

    const fechas = abiertas.map((a) => a.fecha).sort()
    const leer = lectorDeInstancias(gcal, {
      desde: correrDias(fechas[0], -VENTANA_DIAS),
      hasta: correrDias(fechas[fechas.length - 1], VENTANA_DIAS)
    }, log, { esperaReintentoMs: deps.esperaReintentoMs })
    // Todas las lecturas en paralelo de entrada; despues se evalua en memoria.
    await Promise.all([...asignaciones.values()].map((a) => leer(a)))

    for (const { idAsignacion, fecha } of abiertas) {
      const clave = `${idAsignacion}|${fecha}`
      if (mapa.has(clave)) continue
      const resultado = {}

      const prerequisitos = prerequisitosDe.get(idAsignacion)
      if (prerequisitos) {
        const { espera, listas, noVerificadas } = await evaluarEspera(leer, asignaciones.get(idAsignacion), prerequisitos, fecha)
        if (espera.length) resultado.espera = espera
        // "Lista" solo si TODO se pudo verificar: con una agenda sin leer, un
        // ✅ podria esconder un paso pendiente.
        else if (listas.length && !noVerificadas.length) resultado.listas = listas
      }

      const dependientes = dependientesDe.get(idAsignacion)
      // Si la agenda de esta tarea no se pudo leer, sus fechas estan
      // incompletas y la regla de "a cual frena" daria una etiqueta falsa.
      if (dependientes && !leer.fallo(asignaciones.get(idAsignacion))) {
        const fechasP = (await leer(asignaciones.get(idAsignacion))).map((i) => i.fecha)
        const laEspera = []
        for (const dependiente of dependientes) {
          if (!aplicable(dependiente)) continue
          const w = dependienteQueCorresponde(await leer(dependiente), fechasP, fecha)
          if (w && !estaHecha(w.props)) laEspera.push({ ...resumenAsignacion(dependiente), ...detalleDeInstancia(w) })
        }
        if (laEspera.length) resultado.la_espera = laEspera
      }

      if (Object.keys(resultado).length) mapa.set(clave, resultado)
    }
    return mapa
  } catch (err) {
    log.warn?.({ err: err.message }, 'no se pudo armar el mapa de dependencias')
    return mapa
  }
}

// Al marcar la instancia (idAsignacion, fechaISO) de un prerrequisito: las
// instancias de las tareas que la esperaban y que ahora ya no esperan a nada.
// Es la base del aviso de Chat "Ya podés hacerla" (avisos-dependencias.js).
//
// Una que todavia espera a OTRO prerrequisito no se devuelve: el aviso sale
// cuando se completa el ultimo. Una que ya estaba hecha (se marco fuera de
// orden) tampoco.
export async function liberadasPor(deps, { idAsignacion, fechaISO, estado = 'REALIZADA', emailUsuario = null, ahora = new Date() }) {
  const { db, gcal, log = console } = deps
  const filas = await db.tareaAsignacionDependencia.findMany({
    where: { id_asignacion_prerequisito: idAsignacion, activa: true },
    include: {
      prerequisito: { include: INCLUDE_ASIGNACION },
      asignacion: {
        include: {
          ...INCLUDE_ASIGNACION,
          dependencias: { where: { activa: true }, include: { prerequisito: { include: INCLUDE_ASIGNACION } } }
        }
      }
    }
  })
  if (!filas.length) return { prerequisito: null, liberadas: [], incompletas: [] }

  const prerequisito = filas[0].prerequisito
  const hechaAhora = { idAsignacion, fecha: fechaISO, estado, por: emailUsuario, en: ahora.toISOString() }
  const leer = lectorDeInstancias(gcal, { desde: correrDias(fechaISO, -VENTANA_DIAS), hasta: correrDias(fechaISO, VENTANA_DIAS) }, log, { esperaReintentoMs: deps.esperaReintentoMs })
  // Todas las agendas que se van a necesitar, de una vez (cada calendario se lee
  // una sola vez por pedido): antes se esperaban una detras de la otra.
  await Promise.all([
    prerequisito,
    ...filas.flatMap((f) => [f.asignacion, ...f.asignacion.dependencias.map((d) => d.prerequisito)])
  ].map((a) => leer(a)))
  const fechasP = (await leer(prerequisito)).map((i) => i.fecha)
  if (!fechasP.includes(fechaISO)) fechasP.push(fechaISO)
  fechasP.sort()
  // Si no se pudo leer la agenda de la tarea recien marcada, las fechas de P
  // quedan incompletas y la regla de "cual espera a cual" puede errar.
  const agendaDePIncierta = leer.fallo(prerequisito)

  // `incompletas`: las que no se pudo confirmar (fallo la lectura de alguna
  // agenda). No se avisan: se informan, para que no queden en silencio.
  const liberadas = []
  const incompletas = []
  for (const fila of filas) {
    const asignacion = fila.asignacion
    if (!aplicable(asignacion)) continue
    const instanciasA = await leer(asignacion)
    if (agendaDePIncierta || leer.fallo(asignacion)) {
      incompletas.push({ ...resumenAsignacion(asignacion), faltan_verificar: [] })
      continue
    }
    const w = dependienteQueCorresponde(instanciasA, fechasP, fechaISO)
    if (!w || estaHecha(w.props)) continue
    const { espera, noVerificadas } = await evaluarEspera(leer, asignacion, asignacion.dependencias.map((d) => d.prerequisito), w.fecha, { hechaAhora })
    if (espera.length) continue
    if (noVerificadas.length) {
      incompletas.push({ ...resumenAsignacion(asignacion), faltan_verificar: noVerificadas.map((n) => n.nombre_tarea) })
      continue
    }
    liberadas.push({ asignacion, instancia: w, ...resumenAsignacion(asignacion), ...detalleDeInstancia(w) })
  }
  return { prerequisito: { ...resumenAsignacion(prerequisito), ...hechaAhora }, liberadas, incompletas }
}

// La cadena de una instancia para el detalle: hacia atras, sus prerrequisitos
// (y los de ellos, hasta MAX_NIVELES); hacia adelante, quienes la esperan.
// A diferencia de los listados (un solo nivel), aca se sube la cadena entera:
// se pide una sola vez, al abrir el detalle.
export async function cadenaDeInstancia(deps, { idAsignacion, fechaISO }) {
  const { db, gcal, log = console } = deps
  const asignacion = await db.tareaAsignacion.findUnique({ where: { id: idAsignacion }, include: INCLUDE_ASIGNACION })
  if (!asignacion) return { antes: [], despues: [] }

  const leer = lectorDeInstancias(gcal, {
    desde: correrDias(fechaISO, -(MAX_NIVELES + 1) * VENTANA_DIAS),
    hasta: correrDias(fechaISO, VENTANA_DIAS)
  }, log, { esperaReintentoMs: deps.esperaReintentoMs })

  // `camino` corta los ciclos que se hubieran colado (el alta ya los rechaza).
  async function previos(actual, fecha, nivel, camino) {
    if (nivel > MAX_NIVELES) return []
    const filas = await db.tareaAsignacionDependencia.findMany({
      where: { id_asignacion: actual.id, activa: true },
      include: { prerequisito: { include: INCLUDE_ASIGNACION } },
      orderBy: { created_at: 'asc' }
    })
    if (!filas.length) return []
    leidas.add(actual)
    const fechasA = (await leer(actual)).map((i) => i.fecha)
    const nodos = []
    for (const { prerequisito } of filas) {
      if (!aplicable(prerequisito) || camino.has(prerequisito.id)) continue
      leidas.add(prerequisito)
      const instancia = prerequisitoQueCorresponde(await leer(prerequisito), fechasA, fecha)
      if (!instancia) continue
      nodos.push({
        ...resumenAsignacion(prerequisito),
        ...detalleDeInstancia(instancia),
        previos: await previos(prerequisito, instancia.fecha, nivel + 1, new Set([...camino, prerequisito.id]))
      })
    }
    return nodos
  }

  // Todas las asignaciones que se leyeron: si la agenda de alguna fallo, la
  // cadena que se arma esta incompleta (antes salia vacia, sin error).
  const leidas = new Set([asignacion])
  const antes = await previos(asignacion, fechaISO, 1, new Set([asignacion.id]))

  const dependientes = await db.tareaAsignacionDependencia.findMany({
    where: { id_asignacion_prerequisito: asignacion.id, activa: true },
    include: { asignacion: { include: INCLUDE_ASIGNACION } },
    orderBy: { created_at: 'asc' }
  })
  const despues = []
  if (dependientes.length) {
    const fechasX = (await leer(asignacion)).map((i) => i.fecha)
    if (!fechasX.includes(fechaISO)) fechasX.push(fechaISO)
    fechasX.sort()
    for (const { asignacion: dependiente } of dependientes) {
      if (!aplicable(dependiente)) continue
      leidas.add(dependiente)
      const w = dependienteQueCorresponde(await leer(dependiente), fechasX, fechaISO)
      if (w) despues.push({ ...resumenAsignacion(dependiente), ...detalleDeInstancia(w) })
    }
  }
  const incompleta = [...leidas].some((a) => leer.fallo(a))
  return { antes, despues, ...(incompleta ? { incompleta: true } : {}) }
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
