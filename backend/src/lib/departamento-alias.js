import { aSlug } from './slug.js'

// dcsmart no tiene tabla de departamentos -- users.departamento se valida
// contra una lista cerrada en codigo (backend/src/lib/datosUsuario.js de
// dcsmart), no es realmente texto libre. El catalogo de departamentos de
// DC-PLATAFORMA (prisma/seed.js) usa esas mismas claves como slug (via
// aSlug(), igual que /admin/departamentos) -- sin tabla de alias. Si dcsmart
// suma un departamento nuevo a esa lista en el futuro, esto lo crea acá
// tambien (sync perezoso, ver lib/departamentos.js). Los valores reales hoy
// son ASCII en mayusculas (ej. "AUDITORIA"), pero se usa aSlug() (no un
// toLowerCase() plano) para no romper si algun dia llevan tildes.
function nombreLegible(raw) {
  return raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase()
}

// Devuelve null si no habia nada que resolver (columna vacia en dcsmart).
export function resolverDepartamento(raw) {
  const limpio = String(raw || '').trim()
  if (!limpio) return null
  const slug = aSlug(limpio)
  if (!slug) return null
  return { slug, nombre: nombreLegible(limpio) }
}
