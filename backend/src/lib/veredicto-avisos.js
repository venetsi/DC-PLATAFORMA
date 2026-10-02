// Como termino el job de avisos de las 8:00, dicho en voz alta.
//
// Antes terminaba SIEMPRE con "Avisos de Chat OK" y codigo 0, aunque un
// departamento no se hubiera podido leer, un Space hubiera rechazado el aviso
// o no hubiera salido ni un solo mensaje: Cloud Run lo mostraba en verde (el
// mismo patron del snapshot que nunca corrio).
//
// Regla de salida, pensada para los reintentos de Cloud Run Jobs:
//   - Codigo de error SOLO cuando no salio NADA habiendo algo para enviar
//     (o no se pudo leer ningun calendario, o no hay ningun departamento que
//     evaluar). Ahi reintentar es seguro: no hay nada enviado que se pueda
//     duplicar.
//   - Un fallo PARCIAL (algunos avisos salieron, otros no) termina con codigo
//     0, para que un reintento no repita los que ya salieron. Queda en el log
//     como ERROR y le llega a Direccion como una advertencia.

// `mensajes`: cuantos se armaron; `envio`: { enviados, omitidos, fallidos };
// `erroresLectura` / `erroresArmado`: [{ departamento, error }]; `otros`: textos
// sueltos (por ejemplo "no pude cargar los feriados").
export function veredictoDelJob({ departamentosEvaluados = 0, erroresLectura = [], erroresArmado = [], otros = [], mensajes = 0, envio = { enviados: 0, omitidos: 0, fallidos: [] } }) {
  const problemas = []
  if (departamentosEvaluados === 0) {
    // Una base equivocada, o ningun departamento con calendario: no es "un dia
    // sin tareas", es que no hay nada que mirar.
    problemas.push('no hay ningun departamento activo con calendario para evaluar')
  } else if (erroresLectura.length >= departamentosEvaluados) {
    problemas.push('no se pudo leer la agenda de ningun departamento')
  }
  const paraEnviar = mensajes - envio.omitidos
  if (paraEnviar > 0 && envio.enviados === 0) {
    problemas.push(`habia ${paraEnviar} ${paraEnviar === 1 ? 'aviso' : 'avisos'} para enviar y no salio ninguno`)
  }
  return {
    falla_total: problemas.length > 0,
    problemas,
    hubo_errores: problemas.length > 0 || erroresLectura.length > 0 || erroresArmado.length > 0 || otros.length > 0 || envio.fallidos.length > 0
  }
}

// La pista de "¿sacaron la app?" solo vale para un Space de Chat que rechaza
// un aviso (403/404): no para un error de lectura de Calendar ni para un
// webhook, donde mandaria a buscar en el lugar equivocado.
function motivoDeSpace(error) {
  const texto = String(error || '')
  if (/^Webhook/i.test(texto)) return texto
  if (/\b(403|404)\b|inaccesible|not found|forbidden|permission/i.test(texto)) return `${texto} (¿sacaron la app del Space?)`
  return texto
}

// El texto de advertencia para Direccion, o null si no hay nada que advertir.
export function mensajeProblemas({ fallidos = [], erroresLectura = [], erroresArmado = [], otros = [] }) {
  if (!fallidos.length && !erroresLectura.length && !erroresArmado.length && !otros.length) return null
  const lineas = ['⚠️ *Los avisos de hoy salieron con problemas*']
  if (erroresLectura.length) {
    lineas.push('\nNo pude leer la agenda de:')
    for (const e of erroresLectura) lineas.push(`• ${e.departamento}: ${e.error}`)
  }
  if (erroresArmado.length) {
    lineas.push('\nNo pude armar el aviso de:')
    for (const e of erroresArmado) lineas.push(`• ${e.departamento}: ${e.error}`)
  }
  if (fallidos.length) {
    lineas.push('\nNo pude avisar en:')
    for (const f of fallidos) lineas.push(`• ${f.etiqueta}: ${motivoDeSpace(f.error)}`)
  }
  for (const o of otros) lineas.push(`\n${o}`)
  lineas.push('\n_Se vuelve a intentar mañana._')
  if (fallidos.length) {
    lineas.push('_Si sacaron la app de un Space, hay que volver a agregarla y escribir_ `/vincular`.')
  }
  return lineas.join('\n')
}
