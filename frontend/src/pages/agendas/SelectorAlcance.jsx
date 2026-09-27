// "Dónde": toda la empresa, un grupo entero, o locales sueltos (se agregan de a
// uno y quedan como chips). `excluir` = ids de locales que la tarea ya tiene.
export default function SelectorAlcance({ valor, onChange, locales, grupos, excluir = [] }) {
  const disponibles = locales.filter((l) => !excluir.includes(l.id) && !valor.ids_locales.includes(l.id))
  const nombre = (id) => locales.find((l) => l.id === id)?.nombre || id
  const cantidadGrupo = (g) => locales.filter((l) => l.grupo === g).length

  return (
    <div className="selector-alcance">
      <select value={valor.tipo} onChange={(e) => onChange({ ...valor, tipo: e.target.value })} aria-label="Dónde">
        <option value="empresa">Toda la empresa</option>
        <option value="grupo">Un grupo de locales</option>
        <option value="locales">Locales puntuales</option>
      </select>
      {valor.tipo === 'grupo' && (
        <select value={valor.id_grupo} onChange={(e) => onChange({ ...valor, id_grupo: e.target.value })} aria-label="Grupo">
          <option value="">Elegí el grupo…</option>
          {grupos.map((g) => <option key={g} value={g}>{g} ({cantidadGrupo(g)})</option>)}
        </select>
      )}
      {valor.tipo === 'locales' && (
        <>
          <select value="" onChange={(e) => e.target.value && onChange({ ...valor, ids_locales: [...valor.ids_locales, e.target.value] })} aria-label="Agregar local">
            <option value="">Agregar local…</option>
            {disponibles.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.grupo ? ` · ${l.grupo}` : ''}</option>)}
          </select>
          {valor.ids_locales.length > 0 && (
            <div className="chips">
              {valor.ids_locales.map((id) => (
                <span key={id} className="chip">
                  {nombre(id)}
                  <button type="button" aria-label={`Sacar ${nombre(id)}`} onClick={() => onChange({ ...valor, ids_locales: valor.ids_locales.filter((x) => x !== id) })}>×</button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export const ALCANCE_VACIO = { tipo: 'empresa', id_grupo: '', ids_locales: [] }

export function alcanceCompleto(v) {
  if (v.tipo === 'grupo') return !!v.id_grupo
  if (v.tipo === 'locales') return v.ids_locales.length > 0
  return true
}

export function describirAlcance(v, locales) {
  if (v.tipo === 'grupo') return v.id_grupo ? `los ${locales.filter((l) => l.grupo === v.id_grupo).length} locales de ${v.id_grupo}` : 'un grupo'
  if (v.tipo === 'locales') {
    const nombres = v.ids_locales.map((id) => locales.find((l) => l.id === id)?.nombre || id)
    return nombres.length ? nombres.join(', ') : 'los locales que elijas'
  }
  return 'toda la empresa'
}
