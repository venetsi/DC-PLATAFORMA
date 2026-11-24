// Cache corta de las LECTURAS grandes de Google Calendar (listarInstancias y
// listarMaestros), para que las pantallas no relean todos los calendarios en
// cada pedido. Medido en noviembre de 2026: /api/tv/resumen tardaba 1,9 s y lo
// piden las TVs ~120 veces por dia; /api/instancias 1,5 s; /api/agendas ~1 s.
//
// - Vive TTL_MS (60 s: la TV pide cada minuto) por calendario y rango; dos pedidos iguales al mismo tiempo
//   comparten una sola lectura.
// - Cualquier ESCRITURA en un calendario (marcar, mover, editar, crear,
//   cerrar, eliminar) descarta lo guardado de ese calendario: quien marca ve
//   el cambio en el acto. Con varias instancias de Cloud Run, otra instancia
//   puede mostrar lo viejo hasta TTL_MS como mucho.
// - Devuelve copias: nadie puede ensuciar lo guardado modificando eventos.

export const TTL_MS = 60_000
const MAXIMO = 300

const LECTURAS = ['listarInstancias', 'listarMaestros']
const ESCRITURAS = ['crearEventoRecurrente', 'editarRecurrencia', 'cerrarRecurrencia', 'restaurarSerie', 'eliminarEvento', 'marcarInstancia', 'moverInstancia']

export function envolverConCache(gcal, { ttlMs = TTL_MS, ahora = () => Date.now() } = {}) {
  const guardado = new Map() // clave -> { vence, promesa, calendarId }

  function olvidar(calendarId) {
    for (const [clave, e] of guardado) if (e.calendarId === calendarId) guardado.delete(clave)
  }

  const envuelto = { ...gcal, olvidarCalendario: olvidar, _cache: guardado }

  for (const nombre of LECTURAS) {
    const original = gcal[nombre]
    if (typeof original !== 'function') continue
    envuelto[nombre] = async (args = {}) => {
      const clave = `${nombre}|${JSON.stringify(args)}`
      const t = ahora()
      const e = guardado.get(clave)
      if (e && e.vence > t) return structuredClone(await e.promesa)
      if (guardado.size >= MAXIMO) guardado.delete(guardado.keys().next().value)
      const promesa = original.call(gcal, args)
      guardado.set(clave, { vence: t + ttlMs, promesa, calendarId: args.calendarId })
      try {
        return structuredClone(await promesa)
      } catch (err) {
        // Un error no se guarda: el proximo pedido vuelve a intentar.
        if (guardado.get(clave)?.promesa === promesa) guardado.delete(clave)
        throw err
      }
    }
  }

  for (const nombre of ESCRITURAS) {
    const original = gcal[nombre]
    if (typeof original !== 'function') continue
    envuelto[nombre] = async (args = {}) => {
      // Antes Y despues: una lectura que arranco durante la escritura no queda guardada con lo viejo.
      olvidar(args.calendarId)
      try {
        return await original.call(gcal, args)
      } finally {
        olvidar(args.calendarId)
      }
    }
  }

  return envuelto
}
