import test from 'node:test'
import assert from 'node:assert/strict'
import { mapaDeSpaces, textoDeSpaces } from './chat-spaces.js'
import { ejecutarComando, resolverComando } from './chat-comandos.js'

const d = (id, nombre, extra = {}) => ({ id, nombre, slug: nombre.toLowerCase(), chat_space_name: null, chat_webhook_url: null, ...extra })
const aud = d('a', 'Auditoría', { chat_space_name: 'spaces/AUD11111' })
const rep = d('r', 'Reportes', { chat_space_name: 'spaces/REP22222' })
const cos = d('c', 'Costos', { chat_space_name: 'spaces/COS33333' })
const fin = d('f', 'Finanzas', { chat_webhook_url: 'https://hook' })
const rrhh = d('h', 'RRHH')
const dir = d('d', 'Dirección', { slug: 'direccion', chat_space_name: 'spaces/DIR44444' })
const deptos = [aud, rep, cos, fin, rrhh, dir]
const compartidos = [
  { chat_space_name: 'spaces/COM55555', id_departamento: 'a' }, // combinado: Auditoría + Reportes
  { chat_space_name: 'spaces/COM55555', id_departamento: 'r' },
  { chat_space_name: 'spaces/COS33333', id_departamento: 'a' } // el de Costos lo comparte con Auditoría
]

test('mapaDeSpaces: propios, propio con compartidos, combinado, solo webhook y sin Space', () => {
  const m = mapaDeSpaces({ departamentos: deptos, compartidos, actual: 'spaces/COM55555' })
  const tipo = (s) => m.spaces.find((x) => x.space === s).tipo
  assert.equal(tipo('spaces/AUD11111'), 'propio')
  assert.equal(tipo('spaces/COS33333'), 'con_compartidos')
  assert.equal(tipo('spaces/COM55555'), 'combinado')
  assert.deepEqual(m.soloWebhook.map((x) => x.nombre), ['Finanzas'])
  assert.deepEqual(m.sinSpace.map((x) => x.nombre), ['RRHH'])
  assert.equal(m.spaces.find((x) => x.esteSpace).space, 'spaces/COM55555')
})

test('textoDeSpaces (completo): lista cada tipo, marca este Space y advierte lo que no tiene Space', () => {
  const t = textoDeSpaces(mapaDeSpaces({ departamentos: deptos, compartidos, actual: 'spaces/COM55555' }), { completo: true })
  assert.match(t, /Space propio.*\n• \*Auditoría\*/)
  assert.match(t, /\*Costos\* \+ Auditoría/)
  assert.match(t, /Space combinado[\s\S]*• Auditoría, Reportes .*este Space/)
  assert.match(t, /Solo webhook.*Finanzas/)
  assert.match(t, /Sin Space ni webhook.*RRHH/)
  assert.match(t, /ve todo/)
})

test('/spaces: administrador ve todo; el resto solo este Space', async () => {
  const db = {
    departamento: { findMany: async () => deptos },
    departamentoCompartidoEnSpace: { findMany: async () => compartidos }
  }
  assert.equal(resolverComando({ comandoId: 24, texto: '/espacios' }), 24)
  const admin = await ejecutarComando({ db }, { comandoId: 24, texto: '/spaces', space: 'spaces/AUD11111', extUser: { es_admin_global: true, email: 'a@x' }, email: 'a@x' })
  assert.match(admin, /Spaces vinculados/)
  assert.match(admin, /Costos/)
  const otro = await ejecutarComando({ db }, { comandoId: 24, texto: '/spaces', space: 'spaces/AUD11111', extUser: { email: 'b@x' }, email: 'b@x' })
  assert.match(otro, /Este Space/)
  assert.doesNotMatch(otro, /Costos|RRHH/)
})

test('/spaces: un Space sin vincular lo dice', async () => {
  const db = { departamento: { findMany: async () => deptos }, departamentoCompartidoEnSpace: { findMany: async () => compartidos } }
  const t = await ejecutarComando({ db }, { comandoId: 24, texto: '/spaces', space: 'spaces/NADA', extUser: { email: 'b@x' }, email: 'b@x' })
  assert.match(t, /no está vinculado/)
})

test('/spaces: muestra el nombre de cada Space en Chat y, si no se pudo leer, el codigo', async () => {
  const db = { departamento: { findMany: async () => deptos }, departamentoCompartidoEnSpace: { findMany: async () => compartidos } }
  const nombresDeSpaces = async () => new Map([['spaces/AUD11111', 'Auditoría - equipo'], ['spaces/COM55555', 'INFORMES']])
  const t = await ejecutarComando({ db, nombresDeSpaces }, { comandoId: 24, texto: '/spaces', space: 'spaces/AUD11111', extUser: { es_admin_global: true, email: 'a@x' }, email: 'a@x' })
  assert.match(t, /\*Auditoría\* → «Auditoría - equipo».*este Space/)
  assert.match(t, /Auditoría, Reportes → «INFORMES»/)
  assert.match(t, /\*Reportes\* → `…22222`/) // sin nombre: el codigo
})

test('/spaces: si Chat falla al dar los nombres, igual responde con los codigos', async () => {
  const db = { departamento: { findMany: async () => deptos }, departamentoCompartidoEnSpace: { findMany: async () => compartidos } }
  const nombresDeSpaces = async () => { throw new Error('Chat caido') }
  const t = await ejecutarComando({ db, nombresDeSpaces }, { comandoId: 24, texto: '/spaces', space: 'x', extUser: { es_admin_global: true, email: 'a@x' }, email: 'a@x' })
  assert.match(t, /Spaces vinculados/)
  assert.match(t, /`…11111`/)
})

test('/spaces: un chat privado con la app se avisa como tal (no es un Space de equipo)', async () => {
  const db = { departamento: { findMany: async () => deptos }, departamentoCompartidoEnSpace: { findMany: async () => compartidos } }
  const nombresDeSpaces = async () => new Map([['spaces/AUD11111', '__mensaje_directo__']])
  const t = await ejecutarComando({ db, nombresDeSpaces }, { comandoId: 24, texto: '/spaces', space: 'spaces/AUD11111', extUser: { es_admin_global: true, email: 'a@x' }, email: 'a@x' })
  assert.match(t, /\*Auditoría\* → 🔒 \*chat privado con la app\*/)
  assert.match(t, /Ojo:.*Auditoría.*chat privado.*no a un Space de equipo/)
})
