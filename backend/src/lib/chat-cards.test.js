import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardLiberadas, cardLiberadasPrivada, ORIGEN_LIBERADA } from './chat-cards.js'

const fila = {
  instanceId: 'ev_20261003',
  fecha: '2026-10-03',
  idDepartamento: 'aud',
  nombre_tarea: 'Reporte <ventas>',
  local: 'TIAMO',
  responsable: 'jperez@dcsmart.app'
}
const prerequisito = { nombre_tarea: 'Cierre de caja', departamento: 'Tesorería', estado: 'REALIZADA', por: 'lruiz@dcsmart.app' }

const parametros = (boton) => Object.fromEntries(boton.onClick.action.parameters.map((p) => [p.key, p.value]))

test('Space: una tarea liberada, con el boton que sirve tambien fuera del Space', () => {
  const { cardsV2: [{ card }] } = cardLiberadas({ departamento: { id: 'aud', nombre: 'Auditoría' }, filas: [fila], prerequisito, hoyISO: '2026-10-03', urlApp: 'https://dc-plataforma.dcsmart.app' })
  assert.equal(card.header.title, 'Ya podés hacerla')
  assert.equal(card.header.subtitle, 'Auditoría')
  const { text, button } = card.sections[0].widgets[0].decoratedText
  assert.equal(text, '<b>Reporte &lt;ventas&gt; — TIAMO</b> · vence hoy · jperez')
  assert.deepEqual(parametros(button), { accion: 'marcar', instanceId: 'ev_20261003', fecha: '2026-10-03', idDepartamento: 'aud', origen: ORIGEN_LIBERADA, filas: '1' })
  assert.equal(card.sections[1].widgets[0].textParagraph.text, 'Se completó Cierre de caja (Tesorería), marcada por lruiz.')
})

test('Privado: la frase le habla al responsable, y "no aplica" se dice como tal', () => {
  const { cardsV2: [{ card }] } = cardLiberadasPrivada({ filas: [{ ...fila, fecha: '2026-10-01' }], prerequisito: { ...prerequisito, estado: 'NO_APLICA' }, hoyISO: '2026-10-03' })
  const texto = card.sections[0].widgets[0].textParagraph.text
  assert.match(texto, /^Ya podés hacer <b>Reporte &lt;ventas&gt; — TIAMO<\/b> \(atrasada desde el /)
  assert.match(texto, /Cierre de caja \(Tesorería\) quedó como «no aplica» \(lruiz\)\.$/)
})
