import { createHash, randomBytes, randomInt } from 'node:crypto'
import { conPermisos, puede } from './permisos.js'

// Conectar una TV (kiosko) escaneando un QR: OAuth 2.0 Device Authorization
// Grant, RFC 8628. Se sigue la semantica y los nombres de la RFC (device_code,
// user_code, interval, authorization_pending / slow_down / access_denied /
// expired_token) sin una libreria OIDC: hay un unico cliente (nuestro kiosko)
// y el token solo sirve para leer el kiosko.
//
//   TV:      POST /api/tv/conexion        -> device_code + user_code + QR
//   TV:      POST /api/tv/conexion/token  -> cada `interval` s hasta que se aprueba
//   Celular: /api/pantallas/conexion/:codigo/aprobar  (con sesion)
//
// De los dos secretos (device_code y el token de la TV) solo se guarda el hash.

// Sin vocales (no arma palabras) ni caracteres ambiguos (RFC 8628 §6.1).
export const ALFABETO = 'BCDFGHJKLMNPQRSTVWXZ'
export const LARGO_CODIGO = 6 // 20^6 ~ 64 millones; adivinar esta limitado por persona
export const VIDA_PEDIDO_SEG = 10 * 60
export const INTERVALO_SEG = 5
// Vistas que puede mostrar una TV (decision del usuario, 2026-09-28). La
// primera es la de siempre y la que vale si la pantalla no tiene ninguna.
export const VISTAS_TV = ['semana', 'tablero', 'calendario']
export function vistaTv(valor) {
  return VISTAS_TV.includes(valor) ? valor : VISTAS_TV[0]
}
// Una TV que consulta justo a los 5 s puede llegar un poco antes por la red.
const TOLERANCIA_MS = 1000

export function hash(valor) {
  return createHash('sha256').update(String(valor)).digest('hex')
}

export function nuevoSecreto() {
  return randomBytes(32).toString('base64url')
}

export function generarUserCode() {
  let codigo = ''
  for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)]
  return codigo
}

// "bcd fgh" / "BCD-FGH" -> "BCDFGH". Devuelve null si no es un codigo posible.
export function normalizarUserCode(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (limpio.length !== LARGO_CODIGO || [...limpio].some((c) => !ALFABETO.includes(c))) return null
  return limpio
}

export function formatearUserCode(codigo) {
  return `${codigo.slice(0, 3)}-${codigo.slice(3)}`
}

// Que responderle a la TV que consulta (RFC 8628 §3.5). Pura: no toca la base.
//   { error: 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'invalid_grant' }
//   { entregar: true } -> generar el token y entregarlo (una sola vez)
export function evaluarConsulta(conexion, ahora = new Date()) {
  if (!conexion) return { error: 'invalid_grant' }
  // Ya se entrego el token: el device_code no sirve mas.
  if (conexion.estado === 'ENTREGADA') return { error: 'invalid_grant' }
  if (conexion.estado === 'RECHAZADA') return { error: 'access_denied' }
  if (ahora > conexion.expira_at) return { error: 'expired_token' }
  const intervaloMs = conexion.intervalo_seg * 1000
  if (conexion.ultimo_pedido_at && ahora - conexion.ultimo_pedido_at < intervaloMs - TOLERANCIA_MS) {
    return { error: 'slow_down', intervalo_seg: conexion.intervalo_seg + 5 }
  }
  if (conexion.estado === 'APROBADA') return { entregar: true }
  return { error: 'authorization_pending' }
}

// "Chrome en Android TV", para que quien confirma reconozca la pantalla.
export function describirEquipo(userAgent) {
  const ua = String(userAgent || '')
  if (!ua) return 'un equipo desconocido'
  const navegador = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'el navegador de Samsung'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'un navegador'
  const sistema = /Android TV|AFT|BRAVIA|GoogleTV/i.test(ua) ? 'Android TV'
    : /Tizen/.test(ua) ? 'una TV Samsung'
    : /Web0S|webOS/.test(ua) ? 'una TV LG'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return sistema ? `${navegador} en ${sistema}` : navegador
}

// --- Con base de datos ---

export async function crearPedido(db, { userAgent } = {}) {
  const ahora = new Date()
  // Limpieza sin job aparte: los pedidos vencidos hace mas de un dia sobran.
  await db.tvConexion.deleteMany({ where: { expira_at: { lt: new Date(ahora.getTime() - 24 * 60 * 60 * 1000) } } })
  const deviceCode = nuevoSecreto()
  for (let intento = 0; intento < 5; intento++) {
    const userCode = generarUserCode()
    try {
      await db.tvConexion.create({
        data: {
          device_code_hash: hash(deviceCode),
          user_code: userCode,
          intervalo_seg: INTERVALO_SEG,
          expira_at: new Date(ahora.getTime() + VIDA_PEDIDO_SEG * 1000),
          user_agent: userAgent ? String(userAgent).slice(0, 300) : null
        }
      })
      return { deviceCode, userCode }
    } catch (err) {
      if (err.code !== 'P2002') throw err // otro codigo igual vigente: se prueba otro
    }
  }
  throw new Error('No se pudo generar un código de conexión único')
}

// Lo que consulta la TV cada `interval` segundos.
export async function consultarToken(db, deviceCode) {
  if (!deviceCode) return { error: 'invalid_request' }
  const conexion = await db.tvConexion.findUnique({ where: { device_code_hash: hash(deviceCode) } })
  const ahora = new Date()
  const r = evaluarConsulta(conexion, ahora)
  if (r.error === 'slow_down') {
    await db.tvConexion.update({ where: { id: conexion.id }, data: { intervalo_seg: r.intervalo_seg, ultimo_pedido_at: ahora } })
    return { error: 'slow_down', interval: r.intervalo_seg }
  }
  if (r.error === 'authorization_pending') {
    await db.tvConexion.update({ where: { id: conexion.id }, data: { ultimo_pedido_at: ahora } })
    return r
  }
  if (!r.entregar) return r

  // El token se genera recien ahora, asi nunca queda en texto plano en la
  // base. La entrega es atomica: si llegan dos consultas juntas, una sola lo recibe.
  const token = nuevoSecreto()
  const entregado = await db.$transaction(async (tx) => {
    const cambio = await tx.tvConexion.updateMany({
      where: { id: conexion.id, estado: 'APROBADA' },
      data: { estado: 'ENTREGADA', ultimo_pedido_at: ahora }
    })
    if (cambio.count !== 1) return false
    await tx.tvPantalla.update({ where: { id: conexion.id_pantalla }, data: { token_hash: hash(token) } })
    return true
  })
  if (!entregado) return { error: 'invalid_grant' }
  return { access_token: token, token_type: 'Bearer' }
}

// Pedido vigente por codigo, para la pantalla de confirmacion del celular.
export async function pedidoPorCodigo(db, codigoTexto) {
  const codigo = normalizarUserCode(codigoTexto)
  if (!codigo) return null
  return db.tvConexion.findUnique({ where: { user_code: codigo } })
}

export function pedidoVigente(conexion, ahora = new Date()) {
  return !!conexion && conexion.estado === 'PENDIENTE' && ahora <= conexion.expira_at
}

// Nombre por defecto: "TV Tesorería", "TV Tesorería y RRHH", "TV Tesorería, RRHH y 2 más".
export function nombrePorDefecto(nombres) {
  if (!nombres.length) return 'TV'
  if (nombres.length === 1) return `TV ${nombres[0]}`
  if (nombres.length === 2) return `TV ${nombres[0]} y ${nombres[1]}`
  return `TV ${nombres[0]}, ${nombres[1]} y ${nombres.length - 2} más`
}

// La pantalla detras de un token, y los departamentos que puede mostrar HOY:
// los suyos que siguen activos y que quien la conecto todavia puede ver. Si
// no le queda ninguno (o esa persona ya no esta activa), null -> la TV vuelve al QR.
export async function resolverPantalla(db, token) {
  if (!token) return null
  const pantalla = await db.tvPantalla.findUnique({
    where: { token_hash: hash(token) },
    include: { departamentos: { include: { departamento: true } } }
  })
  if (!pantalla?.activa) return null
  const duenio = await db.extUser.findUnique({ where: { email: pantalla.conectada_por } })
  if (!duenio?.activo) return null
  const usuario = await conPermisos(db, duenio)
  const departamentos = pantalla.departamentos
    .map((pd) => pd.departamento)
    .filter((d) => d.activo && puede(usuario, 'ver', d.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  if (!departamentos.length) return null
  return { pantalla, departamentos }
}
