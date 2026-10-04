// /spaces: como estan vinculados los Spaces de Chat y sus combinaciones.
// Lo arma texto puro a partir de lo que hay en la base (cero llamadas a
// Calendar ni a Chat): es el estado de la CONFIGURACION, lo que no se ve desde
// ningun otro lado. Ver resumen-semanal.js#espaciosCombinados para la misma
// regla de "combinado" (un Space sin dueño, solo con departamentos compartidos).
import { SLUG_DIRECCION } from './direccion.js'
import { MENSAJE_DIRECTO } from './chat.js'

const corto = (space) => `…${String(space).slice(-5)}`

// `departamentos`: activos. `compartidos`: DepartamentoCompartidoEnSpace
// [{ chat_space_name, id_departamento }]. `actual`: el Space donde se escribio.
// Devuelve { spaces: [{ space, tipo, dueño, departamentos, esteSpace }], sinSpace, soloWebhook }.
export function mapaDeSpaces({ departamentos, compartidos, actual = null }) {
  const porId = new Map(departamentos.map((d) => [d.id, d]))
  const spaces = new Map()
  const pedir = (space) => {
    if (!spaces.has(space)) spaces.set(space, { space, dueño: null, otros: new Map() })
    return spaces.get(space)
  }
  for (const d of departamentos) if (d.chat_space_name) pedir(d.chat_space_name).dueño = d
  for (const c of compartidos) {
    const d = porId.get(c.id_departamento)
    if (!c.chat_space_name || !d) continue
    const s = pedir(c.chat_space_name)
    if (s.dueño?.id !== d.id) s.otros.set(d.id, d)
  }
  const lista = [...spaces.values()].map((s) => {
    const otros = [...s.otros.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
    const tipo = s.dueño ? (otros.length ? 'con_compartidos' : 'propio') : 'combinado'
    return { space: s.space, tipo, dueño: s.dueño, departamentos: s.dueño ? [s.dueño, ...otros] : otros, esteSpace: s.space === actual }
  })
  const orden = { propio: 0, con_compartidos: 1, combinado: 2 }
  lista.sort((a, b) => orden[a.tipo] - orden[b.tipo] || (a.dueño?.nombre || a.departamentos[0]?.nombre || '').localeCompare(b.dueño?.nombre || b.departamentos[0]?.nombre || ''))
  const conSpace = new Set(lista.flatMap((s) => s.departamentos.map((d) => d.id)))
  const sinSpace = departamentos.filter((d) => !conSpace.has(d.id) && !d.chat_webhook_url)
  const soloWebhook = departamentos.filter((d) => !d.chat_space_name && d.chat_webhook_url)
  return { spaces: lista, sinSpace, soloWebhook }
}

const nombresDeptos = (ds) => ds.map((d) => d.nombre).join(', ')

export function textoDeSpaces(mapa, { completo, nombres = new Map() }) {
  const l = []
  // El nombre del Space en Chat; si no se pudo leer, el final de su codigo.
  const esDm = (s) => nombres.get(s.space) === MENSAJE_DIRECTO
  const cual = (s) => (esDm(s) ? '🔒 *chat privado con la app* (no es un Space)' : nombres.get(s.space) ? `«${nombres.get(s.space)}»` : `\`${corto(s.space)}\``)
  const aqui = (s) => (s.esteSpace ? '  👈 _este Space_' : '')
  const ve = (s) => (s.dueño?.slug === SLUG_DIRECCION ? ' · 👁️ ve todo' : '')
  const grupos = [
    ['propio', '💬 *Space propio* — recibe sus recordatorios y su resumen del lunes'],
    ['con_compartidos', '🤝 *Space propio con otros departamentos* — el dueño recibe los avisos; el resto lo usa para comandos y botones'],
    ['combinado', '🧩 *Space combinado* — sin dueño: el resumen del lunes llega con todos juntos; el recordatorio diario va al Space propio de cada uno']
  ]
  l.push(completo ? '*Spaces vinculados*' : '*Este Space*', '')
  let hay = false
  for (const [tipo, titulo] of grupos) {
    const lista = mapa.spaces.filter((s) => s.tipo === tipo)
    if (!lista.length) continue
    hay = true
    l.push(titulo)
    for (const s of lista) {
      if (tipo === 'propio') l.push(`• *${s.dueño.nombre}*${ve(s)} → ${cual(s)}${aqui(s)}`)
      else if (tipo === 'con_compartidos') l.push(`• *${s.dueño.nombre}* + ${nombresDeptos(s.departamentos.slice(1))} → ${cual(s)}${aqui(s)}`)
      else l.push(`• ${nombresDeptos(s.departamentos)} → ${cual(s)}${aqui(s)}`)
    }
    l.push('')
  }
  if (!hay) {
    l.push(completo ? 'Todavía no hay ningún Space vinculado. En un Space, escribí `/vincular`.' : 'Este Space no está vinculado a ningún departamento. Un administrador lo vincula con `/vincular`.')
    l.push('')
  }
  const enPrivado = mapa.spaces.filter(esDm)
  if (enPrivado.length) {
    l.push(`🔒 *Ojo:* ${nombresDeptos(enPrivado.flatMap((s) => s.departamentos))} está vinculado a un **chat privado** con la app, no a un Space de equipo: los avisos le llegan solo a esa persona. Para que lo reciba el equipo, creá un Space, agregá la app y escribí \`/vincular\` ahí.`, '')
  }
  if (completo) {
    if (mapa.soloWebhook.length) l.push(`🔗 *Solo webhook* (sin Space): ${nombresDeptos(mapa.soloWebhook)}`, '')
    if (mapa.sinSpace.length) {
      l.push(`⚠️ *Sin Space ni webhook* (no reciben su recordatorio; sus atrasadas igual escalan a Dirección): ${nombresDeptos(mapa.sinSpace)}`, '')
    }
    l.push('_`/vincular` y `/desvincular` cambian lo de este Space. `/departamentos` muestra el detalle de cada departamento._')
  }
  return l.join('\n').trim()
}
