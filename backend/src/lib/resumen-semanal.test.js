import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparDelDia,
  clasificarSemana,
  cumplimientoDelTramo,
  espaciosCombinados,
  modoDelAviso,
  rangoTexto,
  rankingPorResponsable,
  semanaDe,
  sumarDiasISO,
  unirSinDuplicados
} from './resumen-semanal.js'
import { cardResumenDireccion, cardSemanal, cardSemanalCombinada, ORIGEN_SEMANAL } from './chat-cards.js'

// Lunes 5 de octubre de 2026, 8:00 en Argentina (11:00 UTC).
const HOY = '2026-10-05'
const REFERENCIA = new Date('2026-10-05T11:00:00Z')
const nombreLocal = new Map([['lf', 'LA FUERZA'], ['roma', 'ROMA'], ['tiamo', 'TIAMO']])

function ev(id, fecha, props = {}) {
  return {
    id,
    summary: props.nombre_tarea,
    start: { date: fecha },
    end: { date: sumarDiasISO(fecha, 1) },
    extendedProperties: { private: { id_asignacion: id.split('_')[0], ...props } }
  }
}

const parametros = (boton) => Object.fromEntries(boton.onClick.action.parameters.map((p) => [p.key, p.value]))

test('semanaDe: de lunes a domingo, desde cualquier dia de la semana', () => {
  const esperado = { desde: '2026-10-05', hasta: '2026-10-11', pasada: { desde: '2026-09-28', hasta: '2026-10-04' } }
  assert.deepEqual(semanaDe('2026-10-05'), esperado)
  assert.deepEqual(semanaDe('2026-10-07'), esperado)
  assert.deepEqual(semanaDe('2026-10-11'), esperado)
})

test('modoDelAviso: el lunes es semanal, el resto diario, y AVISO_MODO lo fuerza', () => {
  assert.equal(modoDelAviso('2026-10-05', ''), 'semanal')
  assert.equal(modoDelAviso('2026-10-06', ''), 'diario')
  assert.equal(modoDelAviso('2026-10-06', 'Semanal'), 'semanal')
  assert.equal(modoDelAviso('2026-10-05', 'diario'), 'diario')
  assert.equal(modoDelAviso('2026-10-06', 'otra cosa'), 'diario')
})

test('rangoTexto: un mes o dos', () => {
  assert.equal(rangoTexto('2026-10-05', '2026-10-09'), '5 al 9 de octubre')
  assert.equal(rangoTexto('2026-09-28', '2026-10-02'), '28 de septiembre al 2 de octubre')
})

test('clasificarSemana: atrasadas (mas vieja primero) y lo que queda de la semana por dia', () => {
  const instancias = [
    ev('a_1', '2026-10-01', { nombre_tarea: 'CMV' }),
    ev('b_1', '2026-09-24', { nombre_tarea: 'Arqueo' }),
    ev('c_1', '2026-10-02', { nombre_tarea: 'Hecha', estado: 'REALIZADA' }),
    ev('d_1', '2026-10-05', { nombre_tarea: 'P&L' }),
    ev('d_2', '2026-10-07', { nombre_tarea: 'P&L' }),
    ev('e_1', '2026-10-06', { nombre_tarea: 'No va', estado: 'NO_APLICA' }),
    ev('f_1', '2026-10-12', { nombre_tarea: 'Semana que viene' })
  ]
  const { vencidas, porDia, total } = clasificarSemana(instancias, { hoyISO: HOY, semana: semanaDe(HOY), referencia: REFERENCIA })
  assert.deepEqual(vencidas.map((v) => v.evento.id), ['b_1', 'a_1'])
  assert.ok(vencidas[0].dias > vencidas[1].dias)
  assert.deepEqual(porDia.map((d) => [d.fecha, d.eventos.map((e) => e.id)]), [['2026-10-05', ['d_1']], ['2026-10-07', ['d_2']]])
  assert.equal(total, 2)
})

test('cumplimientoDelTramo: hechas sobre lo que vencio, sin contar "no aplica"', () => {
  const instancias = [
    ev('a_1', '2026-09-28', { estado: 'REALIZADA' }),
    ev('a_2', '2026-09-29', { estado: 'REALIZADA' }),
    ev('a_3', '2026-09-30'),
    ev('a_4', '2026-10-01', { estado: 'NO_APLICA' }),
    ev('a_5', '2026-09-25', { estado: 'REALIZADA' }), // semana anterior: fuera del tramo
    ev('a_6', '2026-10-05') // esta semana: fuera del tramo
  ]
  assert.deepEqual(cumplimientoDelTramo(instancias, { ...semanaDe(HOY).pasada, referencia: REFERENCIA }), { hechas: 2, total: 3 })
})

test('unirSinDuplicados: una tarea compartida cuenta una vez, y gana la copia hecha', () => {
  const deReportes = [ev('x_1', '2026-09-30'), ev('y_1', '2026-09-30')]
  const deAuditoria = [ev('x_1', '2026-09-30', { estado: 'REALIZADA' })]
  const unidas = unirSinDuplicados([deReportes, deAuditoria])
  assert.equal(unidas.length, 2)
  assert.equal(unidas.find((e) => e.id === 'x_1').extendedProperties.private.estado, 'REALIZADA')
})

test('rankingPorResponsable: sin duplicar compartidas, y las sin responsable van al equipo', () => {
  const compartida = { evento: ev('x_1', '2026-09-30', { asignado_a: 'GMalachane@dcsmart.app' }), dias: 3 }
  const ranking = rankingPorResponsable([
    { departamento: { nombre: 'Reportes' }, vencidas: [compartida, { evento: ev('y_1', '2026-10-01', { asignado_a: 'gmalachane@dcsmart.app' }), dias: 2 }, { evento: ev('z_1', '2026-10-01'), dias: 2 }] },
    { departamento: { nombre: 'Auditoría' }, vencidas: [compartida, { evento: ev('w_1', '2026-09-24', { asignado_a: 'dmora@dcsmart.app' }), dias: 7 }] }
  ])
  assert.deepEqual(ranking, [
    { quien: 'gmalachane@dcsmart.app', atrasadas: 2, masVieja: 3 },
    { quien: 'dmora@dcsmart.app', atrasadas: 1, masVieja: 7 },
    { quien: 'Equipo — Reportes', atrasadas: 1, masVieja: 2 }
  ])
})

const nombresTita = new Map([['tita', 'TITA'], ['titach', 'TITA-CH'], ['darki', 'DARKI'], ['galgos', 'LOS GALGOS'], ['878', '878COOP'], ['sucursal', 'SUCURSAL']])
const grupoLocal = new Map([['tita', 'GRUPO TITA'], ['titach', 'GRUPO TITA'], ['darki', 'GRUPO TITA'], ['galgos', 'LOS GALGOS'], ['878', 'GRUPO 878']])

test('agruparDelDia: una linea por tarea y grupo, sin importar el responsable', () => {
  const dependencias = new Map([['pl1|2026-10-07', { espera: [{ nombre_tarea: 'Auditar' }] }]])
  const eventos = [
    ev('pl1_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: 'titach', asignado_a: 'gquinteros@dcsmart.app' }),
    ev('pl2_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: 'darki', asignado_a: 'gmalachane@dcsmart.app' }),
    ev('pl3_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: '878', asignado_a: 'gquinteros@dcsmart.app' }),
    ev('pl4_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: 'sucursal' }),
    ev('au1_1', '2026-10-07', { nombre_tarea: 'Auditar', id_local_ext: 'tita' })
  ]
  assert.deepEqual(agruparDelDia(eventos, nombresTita, dependencias, grupoLocal), [
    // Un solo local del grupo: se nombra por el local.
    { titulo: 'Auditar', donde: 'TITA', locales: ['TITA'], personas: [], marcas: [] },
    { titulo: 'P&L', donde: '878COOP', locales: ['878COOP'], personas: ['gquinteros@dcsmart.app'], marcas: [] },
    // Dos locales del mismo grupo: una linea, con los dos responsables y la marca que tenga alguno.
    { titulo: 'P&L', donde: 'GRUPO TITA', locales: ['DARKI', 'TITA-CH'], personas: ['gmalachane@dcsmart.app', 'gquinteros@dcsmart.app'], marcas: ['⏳ espera a Auditar'] },
    // Sin grupo: por el local.
    { titulo: 'P&L', donde: 'SUCURSAL', locales: ['SUCURSAL'], personas: [], marcas: [] }
  ])
})

test('agruparDelDia: sin mapa de grupos, cada local va en su linea', () => {
  const eventos = [
    ev('pl1_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: 'titach' }),
    ev('pl2_1', '2026-10-07', { nombre_tarea: 'P&L', id_local_ext: 'darki' })
  ]
  assert.deepEqual(agruparDelDia(eventos, nombresTita, new Map()).map((l) => l.donde), ['DARKI', 'TITA-CH'])
})

test('cardSemanal: atrasadas con boton que reconstruye la semanal, y la semana dia por dia sin botones', () => {
  const departamento = { id: 'rep', nombre: 'Reportes' }
  const atrasada = ev('ar_1', '2026-10-01', { nombre_tarea: 'Arqueo', id_local_ext: 'roma', asignado_a: 'dmora@dcsmart.app' })
  const datos = {
    semana: semanaDe(HOY),
    vencidas: [{ evento: atrasada, dias: 2 }],
    porDia: [
      { fecha: '2026-10-05', eventos: [ev('pl_1', '2026-10-05', { nombre_tarea: 'P&L', id_local_ext: 'lf', asignado_a: 'gmalachane@dcsmart.app' }), ev('pl2_1', '2026-10-05', { nombre_tarea: 'P&L', id_local_ext: 'roma', asignado_a: 'gmalachane@dcsmart.app' })] },
      { fecha: '2026-10-07', eventos: [ev('cmv_1', '2026-10-07', { nombre_tarea: 'CMV' })] }
    ],
    total: 3,
    dependencias: new Map([['pl|2026-10-05', { espera: [{ nombre_tarea: 'Auditar' }] }], ['pl2|2026-10-05', { espera: [{ nombre_tarea: 'Auditar' }] }]])
  }
  const grupos = new Map([['lf', 'GRUPO LA FUERZA'], ['roma', 'GRUPO LA FUERZA']])
  const { cardsV2: [{ cardId, card }] } = cardSemanal(departamento, datos, nombreLocal, { hoyISO: HOY, grupoLocal: grupos, urlApp: 'https://dc-plataforma.dcsmart.app' })
  assert.equal(cardId, 'semanal-rep')
  assert.equal(card.header.title, 'Tu semana: 5 al 9 de octubre')
  assert.equal(card.header.subtitle, 'Reportes · 3 tareas esta semana · 1 atrasada')

  const [atrasadas, lunes, miercoles, pie] = card.sections
  assert.equal(atrasadas.header, '🚨 Atrasadas (1)')
  const { text, button } = atrasadas.widgets[0].decoratedText
  assert.match(text, /^<b>Arqueo › ROMA<\/b> · del 1 oct\.? · <font color="#c62828">hace 2 días hábiles<\/font> · dmora$/)
  assert.deepEqual(parametros(button), { accion: 'marcar', instanceId: 'ar_1', fecha: '2026-10-01', idDepartamento: 'rep', origen: ORIGEN_SEMANAL })

  assert.equal(lunes.header, 'Lunes 5 (hoy) · 2 tareas')
  assert.equal(lunes.widgets[0].textParagraph.text, '<b>P&amp;L</b> › GRUPO LA FUERZA · gmalachane · ⏳ espera a Auditar')
  assert.equal(miercoles.header, 'Miércoles 7 · 1 tarea')
  assert.equal(miercoles.widgets[0].textParagraph.text, '<b>CMV</b> › Toda la empresa')
  assert.equal(pie.widgets[0].buttonList.buttons[0].onClick.openLink.url, 'https://dc-plataforma.dcsmart.app/')
})

test('cardSemanal: sin nada, lo dice en vez de mandar una tarjeta vacia', () => {
  const { cardsV2: [{ card }] } = cardSemanal({ id: 'x', nombre: 'Costos' }, { semana: semanaDe(HOY), vencidas: [], porDia: [], total: 0, dependencias: new Map() }, nombreLocal, { hoyISO: HOY })
  assert.equal(card.sections[0].widgets[0].textParagraph.text, 'No hay tareas esta semana ni atrasadas. 👌')
})

test('cardResumenDireccion: totales, % de la semana pasada y ranking', () => {
  const { cardsV2: [{ card }] } = cardResumenDireccion({
    semana: semanaDe(HOY),
    filas: [
      { departamento: { nombre: 'Reportes' }, total: 31, atrasadas: 4, pasada: { hechas: 27, total: 30 } },
      { departamento: { nombre: 'Tesorería' }, total: 5, atrasadas: 0, pasada: { hechas: 0, total: 0 } }
    ],
    sinNada: ['Costos', 'RRHH'],
    ranking: [{ quien: 'gmalachane@dcsmart.app', atrasadas: 3, masVieja: 4 }, { quien: 'Equipo — Reportes', atrasadas: 1, masVieja: 1 }],
    pasadaTotal: { hechas: 27, total: 30 }
  })
  assert.equal(card.header.subtitle, '5 al 9 de octubre · semana pasada: 90% cumplido (27 de 30)')
  const [deptos, ranking] = card.sections
  assert.equal(deptos.widgets[0].decoratedText.text, '<b>Reportes</b> · 31 tareas esta semana · <font color="#c62828">4 atrasadas</font> · semana pasada: 90%')
  assert.equal(deptos.widgets[1].decoratedText.text, '<b>Tesorería</b> · 5 tareas esta semana · 0 atrasadas')
  assert.equal(deptos.widgets[2].textParagraph.text, '<i>Sin tareas esta semana ni atrasadas: Costos, RRHH</i>')
  assert.equal(ranking.widgets[0].textParagraph.text, '<b>gmalachane</b> — 3 atrasadas · la más vieja: 4 días hábiles<br><b>Equipo — Reportes</b> — 1 atrasada · la más vieja: 1 día hábil')
})

test('espaciosCombinados: Spaces con compartidos, el dueño primero, y sin dueño si no tiene', () => {
  const aud = { id: 'aud', nombre: 'Auditoría', slug: 'auditoria', chat_space_name: 'spaces/AUD' }
  const rep = { id: 'rep', nombre: 'Reportes', slug: 'reportes', chat_space_name: 'spaces/INF' }
  const cos = { id: 'cos', nombre: 'Costos', slug: 'costos', chat_space_name: 'spaces/COSADM' }
  const adm = { id: 'adm', nombre: 'Administración', slug: 'administracion', chat_space_name: null }
  const r = espaciosCombinados([aud, rep, cos, adm], [
    { chat_space_name: 'spaces/MIX', id_departamento: 'rep' },
    { chat_space_name: 'spaces/MIX', id_departamento: 'aud' },
    { chat_space_name: 'spaces/COSADM', id_departamento: 'adm' },
    { chat_space_name: 'spaces/X', id_departamento: 'inactivo' }
  ])
  assert.deepEqual(r.map((c) => [c.space, c.dueño?.id || null, c.departamentos.map((d) => d.id)]), [
    ['spaces/MIX', null, ['aud', 'rep']],
    ['spaces/COSADM', 'cos', ['cos', 'adm']]
  ])
})

test('cardSemanalCombinada: una tarjeta, etiqueta por departamento, y una tarea compartida va una vez', () => {
  const aud = { id: 'aud', nombre: 'Auditoría' }
  const rep = { id: 'rep', nombre: 'Reportes' }
  const semana = semanaDe(HOY)
  const plCompartida = (depto) => ev('pl_1', '2026-10-06', { nombre_tarea: 'P&L', id_local_ext: 'roma', id_departamento: depto })
  const partes = [
    { departamento: aud, datos: { semana, vencidas: [{ evento: ev('au_1', '2026-10-02', { nombre_tarea: 'Auditar', id_local_ext: 'lf' }), dias: 1 }], porDia: [{ fecha: '2026-10-06', eventos: [plCompartida('aud')] }], total: 1, dependencias: new Map() } },
    { departamento: rep, datos: { semana, vencidas: [], porDia: [{ fecha: '2026-10-06', eventos: [plCompartida('rep'), ev('cmv_1', '2026-10-06', { nombre_tarea: 'CMV' })] }], total: 2, dependencias: new Map() } }
  ]
  const info = new Map([['aud', { abreviatura: 'AUD', color: '#d7a14a' }], ['rep', { abreviatura: 'REP', color: '#4fb39b' }]])
  const { cardsV2: [{ cardId, card }] } = cardSemanalCombinada(partes, nombreLocal, { hoyISO: HOY, info, space: 'spaces/MIX' })
  assert.equal(cardId, 'semanal-space-MIX')
  assert.equal(card.header.subtitle, 'Auditoría + Reportes · 2 tareas esta semana · 1 atrasada')
  const [atrasadas, martes] = card.sections
  assert.match(atrasadas.widgets[0].decoratedText.text, /^<font color="#d7a14a"><b>AUD<\/b><\/font> <b>Auditar › LA FUERZA<\/b>/)
  assert.equal(parametros(atrasadas.widgets[0].decoratedText.button).idDepartamento, 'aud')
  assert.equal(martes.header, 'Martes 6 · 2 tareas')
  assert.equal(martes.widgets[0].textParagraph.text, '<font color="#d7a14a"><b>AUD</b></font> <b>P&amp;L</b> › ROMA<br><font color="#4fb39b"><b>REP</b></font> <b>CMV</b> › Toda la empresa')
})
