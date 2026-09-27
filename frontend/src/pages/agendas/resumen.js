import { describirAgenda, claveRegla, fechaHumana } from '../../lib/agenda-texto.js'

// Resumenes de una tarea a partir de sus asignaciones (una por local), para
// la fila de la tabla de Agendas.

export function dondeTexto(asignaciones) {
  if (!asignaciones.length) return { principal: 'Sin locales', detalle: null }
  const empresa = asignaciones.some((a) => !a.id_local_ext)
  const locales = asignaciones.filter((a) => a.id_local_ext)
  if (empresa && !locales.length) return { principal: 'Toda la empresa', detalle: null }
  const grupos = [...new Set(locales.map((a) => a.grupo || 'Sin grupo'))]
  const n = `${locales.length} ${locales.length === 1 ? 'local' : 'locales'}`
  if (grupos.length === 1) return { principal: locales.length === 1 ? locales[0].local : grupos[0], detalle: `${locales.length === 1 ? grupos[0] : n}${empresa ? ' + toda la empresa' : ''}` }
  return { principal: n, detalle: `${grupos.length} grupos${empresa ? ' + toda la empresa' : ''}` }
}

export function cuandoTexto(asignaciones) {
  const conAgenda = asignaciones.filter((a) => a.agenda)
  if (!conAgenda.length) return { principal: asignaciones.length ? 'Sin agenda' : '—', uniforme: false }
  const claves = new Set(conAgenda.map((a) => claveRegla(a.agenda)))
  const proximas = asignaciones.map((a) => a.proxima).filter(Boolean).sort()
  return {
    principal: claves.size === 1 ? describirAgenda(conAgenda[0].agenda) : 'Varía según el local',
    detalle: proximas[0] ? `próxima ${fechaHumana(proximas[0])}` : null,
    uniforme: claves.size === 1 && conAgenda.length === asignaciones.length
  }
}

export function responsableTexto(asignaciones, nombrePorEmail) {
  const valores = new Set(asignaciones.map((a) => a.asignado_a || ''))
  if (valores.size > 1) return 'Varios'
  const unico = [...valores][0]
  return unico ? nombrePorEmail(unico) : 'Equipo'
}

export function estadoTarea(asignaciones) {
  const atrasadas = asignaciones.reduce((s, a) => s + (a.atrasadas || 0), 0)
  if (atrasadas) return { tono: 'mal', texto: `${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}`, atrasadas }
  if (!asignaciones.length || asignaciones.some((a) => !a.agenda)) return { tono: 'medio', texto: 'Sin agenda', atrasadas: 0 }
  return { tono: 'ok', texto: 'Al día', atrasadas: 0 }
}
