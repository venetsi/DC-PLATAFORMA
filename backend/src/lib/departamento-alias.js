// dcsmart no tiene tabla de departamentos -- users.departamento es texto
// libre, cargado a mano. Esto resuelve ese string a {slug, nombre} contra el
// catalogo real de DC-PLATAFORMA: minuscula simple si ya coincide con un slug
// existente, o el alias explicito para los casos donde el nombre usado en
// dcsmart no es el mismo que el nombre visible acá (ej. "Finanzas" es como
// se le sigue diciendo al departamento que este lado llama "tesoreria").
const ALIAS_A_SLUG = {
  finanzas: 'tesoreria'
}

// Para departamentos realmente nuevos (slug no visto todavia): nombre
// legible simple a partir del texto crudo -- se puede corregir a mano
// despues desde la base si hace falta un nombre mas prolijo.
function nombreLegible(raw) {
  return raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase()
}

// Devuelve null si no habia nada que resolver (columna vacia en dcsmart).
export function resolverDepartamento(raw) {
  const limpio = String(raw || '').trim()
  if (!limpio) return null
  const slug = ALIAS_A_SLUG[limpio.toLowerCase()] ?? limpio.toLowerCase()
  return { slug, nombre: nombreLegible(limpio) }
}
