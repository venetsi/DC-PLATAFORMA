import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALFABETO, LARGO_CODIGO, generarUserCode, normalizarUserCode, formatearUserCode,
  evaluarConsulta, describirEquipo, nombrePorDefecto, hash, resolverPantalla
} from './tv-conexion.js'

test('el codigo corto usa solo el alfabeto sin vocales y tiene 6 letras', () => {
  for (let i = 0; i < 200; i++) {
    const c = generarUserCode()
    assert.equal(c.length, LARGO_CODIGO)
    assert.ok([...c].every((ch) => ALFABETO.includes(ch)), c)
  }
  assert.ok(!/[AEIOU]/.test(ALFABETO))
})

test('normalizar acepta minusculas, espacios y guion, y rechaza lo imposible', () => {
  assert.equal(normalizarUserCode('bcd fgh'), 'BCDFGH')
  assert.equal(normalizarUserCode('BCD-FGH'), 'BCDFGH')
  assert.equal(normalizarUserCode('BCDFG'), null) // corto
  assert.equal(normalizarUserCode('BCDFGA'), null) // vocal
  assert.equal(normalizarUserCode(''), null)
  assert.equal(formatearUserCode('BCDFGH'), 'BCD-FGH')
})

const ahora = new Date('2026-09-27T15:00:00Z')
const base = { estado: 'PENDIENTE', intervalo_seg: 5, ultimo_pedido_at: null, expira_at: new Date('2026-09-27T15:10:00Z') }
const hace = (s) => new Date(ahora.getTime() - s * 1000)

test('pendiente mientras nadie aprueba', () => {
  assert.deepEqual(evaluarConsulta(base, ahora), { error: 'authorization_pending' })
  assert.deepEqual(evaluarConsulta({ ...base, ultimo_pedido_at: hace(5) }, ahora), { error: 'authorization_pending' })
})

test('slow_down si consulta antes del intervalo (con 1 s de tolerancia) y sube 5 s', () => {
  assert.deepEqual(evaluarConsulta({ ...base, ultimo_pedido_at: hace(2) }, ahora), { error: 'slow_down', intervalo_seg: 10 })
  assert.deepEqual(evaluarConsulta({ ...base, ultimo_pedido_at: hace(4.5) }, ahora), { error: 'authorization_pending' })
})

test('vence a los 10 minutos', () => {
  assert.deepEqual(evaluarConsulta({ ...base, expira_at: hace(1) }, ahora), { error: 'expired_token' })
})

test('rechazada, aprobada y ya entregada', () => {
  assert.deepEqual(evaluarConsulta({ ...base, estado: 'RECHAZADA' }, ahora), { error: 'access_denied' })
  assert.deepEqual(evaluarConsulta({ ...base, estado: 'APROBADA', ultimo_pedido_at: hace(5) }, ahora), { entregar: true })
  // El token se entrega una sola vez: despues el device_code no sirve mas.
  assert.deepEqual(evaluarConsulta({ ...base, estado: 'ENTREGADA' }, ahora), { error: 'invalid_grant' })
  assert.deepEqual(evaluarConsulta(null, ahora), { error: 'invalid_grant' })
})

test('el hash no es reversible a simple vista y es estable', () => {
  assert.equal(hash('abc'), hash('abc'))
  assert.notEqual(hash('abc'), 'abc')
  assert.equal(hash('abc').length, 64)
})

test('descripcion del equipo y nombre por defecto', () => {
  assert.equal(describirEquipo('Mozilla/5.0 (Linux; Android 11; BRAVIA 4K GB) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'), 'Chrome en Android TV')
  assert.equal(describirEquipo(''), 'un equipo desconocido')
  assert.equal(nombrePorDefecto(['Tesorería']), 'TV Tesorería')
  assert.equal(nombrePorDefecto(['Tesorería', 'RRHH']), 'TV Tesorería y RRHH')
  assert.equal(nombrePorDefecto(['A', 'B', 'C', 'D']), 'TV A, B y 2 más')
})

// --- La TV muestra lo que HOY puede ver quien la conecto ---
// Base simulada: solo lo que usa resolverPantalla (y conPermisos en modo Groups).
process.env.MEMBRESIA_FUENTE = 'groups'
const tes = { id: 'd-tes', nombre: 'Tesorería', activo: true }
const rrhh = { id: 'd-rrhh', nombre: 'RRHH', activo: true }
function baseSimulada({ pantalla = {}, duenio = { email: 'a@x.com', activo: true }, membresias = [] } = {}) {
  const fila = { id: 'p1', activa: true, conectada_por: 'a@x.com', departamentos: [{ departamento: tes }, { departamento: rrhh }], ...pantalla }
  return {
    tvPantalla: { findUnique: async ({ where }) => (where.token_hash === hash('tok') ? fila : null) },
    extUser: { findUnique: async () => duenio },
    membresiaDepartamento: { findMany: async () => membresias }
  }
}
const miembro = (id, slug = 'x') => ({ id_departamento: id, rol_group: 'MEMBER', departamento: { slug } })

test('muestra los departamentos que el dueño sigue viendo, en orden', async () => {
  const r = await resolverPantalla(baseSimulada({ membresias: [miembro('d-tes'), miembro('d-rrhh')] }), 'tok')
  assert.deepEqual(r.departamentos.map((d) => d.nombre), ['RRHH', 'Tesorería'])
})

test('si el dueño deja de ver un departamento, la TV deja de mostrarlo', async () => {
  const r = await resolverPantalla(baseSimulada({ membresias: [miembro('d-tes')] }), 'tok')
  assert.deepEqual(r.departamentos.map((d) => d.id), ['d-tes'])
})

test('sin ningun departamento visible, dueño inactivo o pantalla desconectada: null (vuelve al QR)', async () => {
  assert.equal(await resolverPantalla(baseSimulada({ membresias: [] }), 'tok'), null)
  assert.equal(await resolverPantalla(baseSimulada({ duenio: { email: 'a@x.com', activo: false }, membresias: [miembro('d-tes')] }), 'tok'), null)
  assert.equal(await resolverPantalla(baseSimulada({ pantalla: { activa: false }, membresias: [miembro('d-tes')] }), 'tok'), null)
  assert.equal(await resolverPantalla(baseSimulada({ membresias: [miembro('d-tes')] }), 'otro-token'), null)
  assert.equal(await resolverPantalla(baseSimulada(), null), null)
})

test('un departamento desactivado no se muestra', async () => {
  const base = baseSimulada({
    pantalla: { departamentos: [{ departamento: tes }, { departamento: { ...rrhh, activo: false } }] },
    membresias: [miembro('d-tes'), miembro('d-rrhh')]
  })
  const r = await resolverPantalla(base, 'tok')
  assert.deepEqual(r.departamentos.map((d) => d.id), ['d-tes'])
})

test('si el dueño es de Direccion, ve todos los de la pantalla', async () => {
  const r = await resolverPantalla(baseSimulada({ membresias: [miembro('d-dir', 'direccion')] }), 'tok')
  assert.deepEqual(r.departamentos.map((d) => d.nombre), ['RRHH', 'Tesorería'])
})
