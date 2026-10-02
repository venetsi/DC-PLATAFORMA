import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mensajeProblemas, veredictoDelJob } from './veredicto-avisos.js'

const sinFallos = { enviados: 0, omitidos: 0, fallidos: [] }

test('veredicto: todo salio bien -> OK y codigo 0', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, mensajes: 3, envio: { enviados: 3, omitidos: 0, fallidos: [] } })
  assert.deepEqual(v, { falla_total: false, problemas: [], hubo_errores: false })
})

test('veredicto: no habia nada para enviar NO es un error (catalogo vacio, dia sin tareas)', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, mensajes: 0, envio: sinFallos })
  assert.equal(v.falla_total, false)
  assert.equal(v.hubo_errores, false)
})

test('veredicto: habia avisos y no salio NINGUNO -> falla total (reintentar es seguro)', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, mensajes: 4, envio: { enviados: 0, omitidos: 1, fallidos: [{ etiqueta: 'a', error: 'x' }, { etiqueta: 'b', error: 'x' }, { etiqueta: 'c', error: 'x' }] } })
  assert.equal(v.falla_total, true)
  assert.match(v.problemas[0], /habia 3 avisos para enviar y no salio ninguno/)
})

test('veredicto: los omitidos (departamento sin Space) no cuentan como pendientes de enviar', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, mensajes: 2, envio: { enviados: 0, omitidos: 2, fallidos: [] } })
  assert.equal(v.falla_total, false)
})

test('veredicto: fallo PARCIAL -> hay errores pero codigo 0 (un reintento duplicaria lo que ya salio)', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, mensajes: 4, envio: { enviados: 3, omitidos: 0, fallidos: [{ etiqueta: 'costos', error: '403' }] } })
  assert.equal(v.falla_total, false)
  assert.equal(v.hubo_errores, true)
})

test('veredicto: un departamento sin leer es un error parcial; todos sin leer es falla total', () => {
  const uno = veredictoDelJob({ departamentosEvaluados: 9, erroresLectura: [{ departamento: 'Costos', error: '429' }], mensajes: 2, envio: { enviados: 2, omitidos: 0, fallidos: [] } })
  assert.deepEqual([uno.falla_total, uno.hubo_errores], [false, true])
  const todos = veredictoDelJob({ departamentosEvaluados: 2, erroresLectura: [{ departamento: 'A', error: 'x' }, { departamento: 'B', error: 'x' }], mensajes: 0, envio: sinFallos })
  assert.equal(todos.falla_total, true)
  assert.match(todos.problemas[0], /ningun departamento/)
})

test('mensajeProblemas: nada que advertir -> null; con problemas lista cada uno y sugiere el 403', () => {
  assert.equal(mensajeProblemas({}), null)
  const texto = mensajeProblemas({
    erroresLectura: [{ departamento: 'Costos', error: 'Quota exceeded' }],
    fallidos: [{ etiqueta: 'reportes (semanal)', error: 'Requested entity was not found. 404' }]
  })
  assert.match(texto, /No pude leer la agenda de:\n• Costos: Quota exceeded/)
  assert.match(texto, /No pude avisar en:\n• reportes \(semanal\): .*404 \(¿sacaron la app del Space\?\)/)
  assert.match(texto, /\/vincular/)
})

test('veredicto: cero departamentos evaluados es una falla total (no un dia tranquilo)', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 0, mensajes: 0, envio: sinFallos })
  assert.equal(v.falla_total, true)
  assert.match(v.problemas[0], /ningun departamento activo/)
})

test('veredicto: no poder armar un aviso, o no cargar los feriados, es un error parcial (codigo 0)', () => {
  const v = veredictoDelJob({ departamentosEvaluados: 9, erroresArmado: [{ departamento: 'Costos', error: 'x' }], mensajes: 2, envio: { enviados: 2, omitidos: 0, fallidos: [] } })
  assert.deepEqual([v.falla_total, v.hubo_errores], [false, true])
  const f = veredictoDelJob({ departamentosEvaluados: 9, otros: ['sin feriados'], mensajes: 0, envio: sinFallos })
  assert.deepEqual([f.falla_total, f.hubo_errores], [false, true])
})

test('mensajeProblemas: la pista "¿sacaron la app?" es solo para un Space de Chat que rechaza el aviso', () => {
  const texto = mensajeProblemas({
    erroresLectura: [{ departamento: 'Costos', error: 'Not Found' }],
    fallidos: [{ etiqueta: 'webhook-x', error: 'Webhook respondio 404' }, { etiqueta: 'reportes', error: 'Requested entity was not found. (404)' }]
  })
  assert.match(texto, /• Costos: Not Found\n/) // lectura de Calendar: sin la pista
  assert.match(texto, /• webhook-x: Webhook respondio 404\n/) // webhook: sin la pista
  assert.match(texto, /• reportes: .*\(¿sacaron la app del Space\?\)/)
  // El pie sobre /vincular solo aparece si hubo un aviso que no salio.
  assert.doesNotMatch(mensajeProblemas({ erroresLectura: [{ departamento: 'Costos', error: 'x' }] }), /vincular/)
})

test('mensajeProblemas: lista lo que no se pudo armar y los avisos sueltos', () => {
  const texto = mensajeProblemas({ erroresArmado: [{ departamento: 'Spaces combinados', error: 'la base no responde' }], otros: ['No pude cargar los feriados.'] })
  assert.match(texto, /No pude armar el aviso de:\n• Spaces combinados: la base no responde/)
  assert.match(texto, /No pude cargar los feriados\./)
})
