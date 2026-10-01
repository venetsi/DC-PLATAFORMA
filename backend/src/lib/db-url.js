// Cuantas conexiones a Postgres abre como maximo cada proceso: cada instancia
// de Cloud Run, cada job y el backend local.
//
// La instancia de Cloud SQL es compartida con dcsmart produccion y admite 50
// conexiones en total (47 para usuarios comunes). Prisma, sin limite, abre
// hasta 2 x CPUs + 1 por proceso: 3 por instancia de Cloud Run y bastantes
// mas en una maquina de desarrollo. El 2026-09-30 un deploy no pudo arrancar
// porque no quedaba ninguna libre ("remaining connection slots are reserved",
// P2037); el backend local tenia 7.
//
// Con 2 por proceso alcanza: las consultas de la app son chicas y las
// transacciones interactivas no hacen consultas por fuera de su `tx`, asi que
// no se traban esperando una conexion.
//
// DB_CONNECTION_LIMIT lo cambia sin tocar DATABASE_URL (que lleva la clave).
// Si DATABASE_URL ya trae connection_limit, manda la URL.
export const LIMITE_POR_DEFECTO = 2

export function urlConLimite(url, limite = LIMITE_POR_DEFECTO) {
  if (!url) return url
  if (/[?&]connection_limit=/.test(url)) return url
  const n = Number.parseInt(limite, 10)
  if (!Number.isFinite(n) || n < 1) return url
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${n}`
}

// Opciones para `new PrismaClient(...)`. Sin DATABASE_URL no se pasa nada y
// Prisma da su error de siempre.
export function opcionesPrisma(env = process.env) {
  const url = urlConLimite(env.DATABASE_URL, env.DB_CONNECTION_LIMIT || LIMITE_POR_DEFECTO)
  return url ? { datasources: { db: { url } } } : {}
}
