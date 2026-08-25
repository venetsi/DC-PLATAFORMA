// Transporte de notificaciones: la costura entre "que avisar" (escalamiento.js
// + mensajes-chat.js) y "por donde sale". Hoy la unica implementacion es el
// webhook de Chat; cuando llegue la Chat App interactiva (Fase C) se cambia la
// implementacion del transporte y el job no se toca.

export function crearTransporteWebhook({ fetchImpl = fetch } = {}) {
  return {
    nombre: 'webhook',
    // Un departamento sin webhook no es un error: es la situacion normal hoy
    // (10 de 11 no lo tienen). El job lo cuenta como omitido y sigue.
    soporta: (destino) => Boolean(destino?.chat_webhook_url),
    async enviar(destino, texto) {
      const res = await fetchImpl(destino.chat_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ text: texto })
      })
      if (!res.ok) throw new Error(`Webhook respondio ${res.status}`)
    }
  }
}

// Transporte de simulacion: arma y muestra los mensajes sin postear nada.
// Existe para poder correr el job contra datos reales sin mandarle mensajes a
// los Spaces de la organizacion -- se activa con AVISO_DRY_RUN=1.
export function crearTransporteConsola({ log = console } = {}) {
  return {
    nombre: 'consola (simulacion)',
    // A diferencia del webhook, acepta cualquier destino: la gracia de la
    // simulacion es ver tambien lo que HOY no se enviaria por falta de webhook.
    soporta: () => true,
    async enviar(destino, texto) {
      log.log?.(
        `\n──────── ${destino.nombre} ${destino.chat_webhook_url ? '' : '(sin webhook: hoy no se enviaría)'}\n${texto}\n`
      )
    }
  }
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Envia en serie con pausa entre mensajes (Chat limita a 1 req/seg por Space).
//
// try/catch POR MENSAJE a proposito: antes un webhook caido tiraba la excepcion
// hasta arriba y abortaba el job entero, asi que los departamentos que venian
// despues no recibian nada. Ahora un destino roto se anota en `fallidos` y los
// demas avisos salen igual.
export async function enviarEnSerie(transporte, mensajes, { pausaMs = 1100, log = console } = {}) {
  const resultado = { enviados: 0, omitidos: 0, fallidos: [] }

  for (const [i, mensaje] of mensajes.entries()) {
    const { etiqueta, destino, texto } = mensaje
    if (!transporte.soporta(destino)) {
      resultado.omitidos++
      continue
    }
    try {
      await transporte.enviar(destino, texto)
      resultado.enviados++
    } catch (err) {
      resultado.fallidos.push({ etiqueta, error: err.message })
      log.warn?.(`[notificaciones] fallo el aviso a ${etiqueta}: ${err.message}`)
    }
    // Sin pausa despues del ultimo: no hay nada esperando atras.
    if (i < mensajes.length - 1) await esperar(pausaMs)
  }

  return resultado
}
