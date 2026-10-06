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

// ── Avisos dentro de un dialogo (2026-10-06) ─────────────────────────────────
// Los comandos que abren un dialogo no pueden contestar con un mensaje de texto:
// Chat lo muestra como "error en el servidor". /vincular de alguien que no es
// administrador era el caso real.
import { dialogoAviso, textoParaTarjeta } from './chat-cards.js'
import { departamentosParaVincular } from './chat-comandos.js'

test('dialogoAviso: es un dialogo (action.navigations), no un mensaje, y lleva el texto', () => {
  const r = dialogoAviso('⚠️ Solo un administrador puede vincular este Space.')
  assert.ok(Array.isArray(r.action.navigations))
  assert.equal(r.hostAppDataAction, undefined)
  const widget = r.action.navigations[0].pushCard.sections[0].widgets[0]
  assert.match(widget.textParagraph.text, /Solo un administrador puede vincular/)
})

test('textoParaTarjeta: *negrita* y `codigo` pasan a HTML de tarjeta, y lo demas se escapa', () => {
  assert.equal(textoParaTarjeta('Usá `/vincular` y *esto*'), 'Usá <b>/vincular</b> y <b>esto</b>')
  assert.equal(textoParaTarjeta('a < b & c > d'), 'a &lt; b &amp; c &gt; d')
  assert.equal(textoParaTarjeta('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;')
  assert.equal(textoParaTarjeta('linea 1\nlinea 2'), 'linea 1<br>linea 2')
  assert.equal(textoParaTarjeta(undefined), '')
})

test('/vincular de alguien que NO es administrador: el comando devuelve un error (que la ruta muestra como dialogo)', async () => {
  const r = await departamentosParaVincular({ db: {} }, { space: 'spaces/AAA', extUser: { email: 'nlencinas@dcmanagement.com.ar', esDireccion: false } })
  assert.match(r.error, /Solo un administrador puede vincular/)
  assert.equal(r.departamentos, undefined)
})
