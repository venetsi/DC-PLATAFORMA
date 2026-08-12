// dcsmart no tiene tabla de departamentos -- users.departamento se valida
// contra una lista cerrada en codigo (backend/src/lib/datosUsuario.js de
// dcsmart), no es realmente texto libre. El catalogo de departamentos de
// DC-PLATAFORMA (prisma/seed.js) usa esas mismas 10 claves en minuscula como
// slug, asi que resolver el string de dcsmart es un simple toLowerCase() --
// sin tabla de alias. Si dcsmart suma un departamento nuevo a esa lista en
// el futuro, esto lo crea acá tambien (sync perezoso, ver lib/departamentos.js).
function nombreLegible(raw) {
  return raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase()
}

// Devuelve null si no habia nada que resolver (columna vacia en dcsmart).
export function resolverDepartamento(raw) {
  const limpio = String(raw || '').trim()
  if (!limpio) return null
  return { slug: limpio.toLowerCase(), nombre: nombreLegible(limpio) }
}
