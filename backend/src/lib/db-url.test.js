import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITE_POR_DEFECTO, opcionesPrisma, urlConLimite } from './db-url.js'

const SOCKET = 'postgresql://app:clave@localhost/dc_plataforma?host=/cloudsql/proyecto:region:instancia'
const LOCAL = 'postgresql://app:clave@127.0.0.1:5433/dc_plataforma'

test('urlConLimite: agrega connection_limit con ? o & segun la URL', () => {
  assert.equal(urlConLimite(LOCAL), `${LOCAL}?connection_limit=${LIMITE_POR_DEFECTO}`)
  assert.equal(urlConLimite(SOCKET, 3), `${SOCKET}&connection_limit=3`)
})

test('urlConLimite: si la URL ya trae connection_limit, manda la URL', () => {
  const conLimite = `${SOCKET}&connection_limit=5`
  assert.equal(urlConLimite(conLimite, 2), conLimite)
})

test('urlConLimite: un limite invalido deja la URL como estaba', () => {
  assert.equal(urlConLimite(LOCAL, 'cero'), LOCAL)
  assert.equal(urlConLimite(LOCAL, 0), LOCAL)
  assert.equal(urlConLimite(undefined), undefined)
})

test('opcionesPrisma: DB_CONNECTION_LIMIT gana al default, y sin DATABASE_URL no pasa nada', () => {
  assert.deepEqual(opcionesPrisma({ DATABASE_URL: LOCAL }), { datasources: { db: { url: `${LOCAL}?connection_limit=2` } } })
  assert.deepEqual(opcionesPrisma({ DATABASE_URL: LOCAL, DB_CONNECTION_LIMIT: '4' }), { datasources: { db: { url: `${LOCAL}?connection_limit=4` } } })
  assert.deepEqual(opcionesPrisma({}), {})
})
