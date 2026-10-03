import test from 'node:test'
import assert from 'node:assert/strict'
import { finDeSerie, agruparPorTerminar, mensajePorTerminar } from './por-terminar.js'
import { construirRecurrence } from './recurrencia.js'

test('finDeSerie: UNTIL, fechas exactas, infinita y unica', () => {
  assert.equal(finDeSerie(['RRULE:FREQ=DAILY;UNTIL=20270415T000000Z'], '2026-10-05'), '2027-04-15')
  const f = construirRecurrence('FECHAS', { fechas: ['2026-10-07', '2026-11-06', '2027-01-07'] }, null, '2026-10-01')
  assert.equal(finDeSerie(f, '2026-10-07'), '2027-01-07')
  assert.equal(finDeSerie(['RRULE:FREQ=DAILY'], '2026-10-05'), null)
  assert.equal(finDeSerie([], '2026-10-05'), null)
})

test('agruparPorTerminar: solo la ventana, por tarea, lo mas urgente primero', () => {
  const filas = [
    { tarea: 'P&L', departamento: 'Reportes', local: 'TITA', fin: '2026-10-20' },
    { tarea: 'P&L', departamento: 'Reportes', local: 'DARKI', fin: '2026-10-25' },
    { tarea: 'Cajas', departamento: 'Auditoría', local: 'TITA', fin: '2026-10-10' },
    { tarea: 'Ventas', departamento: 'Reportes', local: 'TITA', fin: '2027-04-01' }, // lejos
    { tarea: 'Viejo', departamento: 'Reportes', local: 'X', fin: '2026-08-01' }, // resto viejo
    { tarea: 'Sin fin', departamento: 'Reportes', local: 'X', fin: null }
  ]
  const g = agruparPorTerminar(filas, { hoyISO: '2026-10-05' })
  assert.deepEqual(g.map((x) => [x.tarea, x.locales.length, x.diasMin]), [['Cajas', 1, 5], ['P&L', 2, 15]])
  assert.equal(g[1].finMax, '2026-10-25')
})

test('agruparPorTerminar: avisa tambien las que terminaron hace pocos dias', () => {
  const g = agruparPorTerminar([{ tarea: 'A', departamento: 'D', local: 'L', fin: '2026-10-03' }], { hoyISO: '2026-10-05' })
  assert.equal(g[0].diasMin, -2)
  assert.match(mensajePorTerminar(g), /terminó hace 2 días/)
})

test('mensajePorTerminar: recomienda reagendar e indica la pantalla', () => {
  const g = agruparPorTerminar([{ tarea: 'P&L', departamento: 'Reportes', local: 'TITA', fin: '2026-10-20' }], { hoyISO: '2026-10-05' })
  const t = mensajePorTerminar(g, { urlApp: 'https://app.test' })
  assert.match(t, /P&L.*Reportes.*1 local.*termina en 15 días \(20\/10\/2026\)/)
  assert.match(t, /reagendar la secuencia/)
  assert.match(t, /https:\/\/app\.test\/agendas/)
})
