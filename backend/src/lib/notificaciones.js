// Transporte de notificaciones: la costura entre "que avisar" (escalamiento.js
// + mensajes-chat.js / chat-cards.js) y "por donde sale".
//
// Un mensaje es { etiqueta, destino, texto, card? }: lleva las DOS
// representaciones y cada transporte toma la que entiende. Asi el job no tiene
// que saber si el departamento tiene Space vinculado o webhook viejo.

export function crearTransporteWebhook({ fetchImpl = fetch } = {}) {
  return {
    nombre: 'webhook',
    // Un departamento sin webhook no es un error: es la situacion normal hoy
    // (10 de 11 no lo tienen). El job lo cuenta como omitido y sigue.
    soporta: (destino) => Boolean(destino?.chat_webhook_url),
    async enviar(destino, mensaje) {
      // El webhook entrante solo entiende texto plano, sin botones.
      const res = await fetchImpl(destino.chat_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ text: mensaje.texto })
      })
      if (!res.ok) throw new Error(`Webhook respondio ${res.status}`)
    }
  }
}

// Transporte de la Chat App: postea en el Space vinculado, con cards y
// botones. Un Space inaccesible (403/404) casi siempre significa que sacaron
// la app: se limpia la vinculacion y NO se reintenta, en vez de gastar cuota
// todos los dias contra un Space que ya no existe.
export function crearTransporteChatApp({ db, log = console } = {}) {
  return {
    nombre: 'chat-app',
    soporta: (destino) => Boolean(destino?.chat_space_name),
    async enviar(destino, mensaje) {
      const { postearEnSpace, SpaceInaccesible } = await import('./chat.js')
      try {
        await postearEnSpace(destino.chat_space_name, mensaje.card || { text: mensaje.texto })
      } catch (err) {
        if (err instanceof SpaceInaccesible && db) {
          await db.departamento
            .updateMany({ where: { chat_space_name: destino.chat_space_name }, data: { chat_space_name: null } })
            .catch(() => {})
          log.warn?.(`[notificaciones] ${destino.slug}: space inaccesible (${err.codigo}), vinculación limpiada`)
        }
        throw err
      }
    }
  }
}

// Elige el transporte POR DESTINO: si el departamento tiene Space vinculado
// gana la Chat App (con botones); si no, cae al webhook de texto plano.
//
// La precedencia es explicita y no "los dos": sin esto, un departamento con
// Space Y webhook recibiria el mismo aviso dos veces. El webhook se conserva
// como rollback si la app falla.
export function crearTransporteChat({ db, log = console, fetchImpl = fetch } = {}) {
  const app = crearTransporteChatApp({ db, log })
  const webhook = crearTransporteWebhook({ fetchImpl })
  return {
    nombre: 'chat (app + webhook)',
    soporta: (destino) => app.soporta(destino) || webhook.soporta(destino),
    enviar: (destino, mensaje) => (app.soporta(destino) ? app : webhook).enviar(destino, mensaje)
  }
}

// Transporte de simulacion: arma y muestra los mensajes sin postear nada.
// Existe para poder correr el job contra datos reales sin mandarle mensajes a
// los Spaces de la organizacion -- se activa con AVISO_DRY_RUN=1.
export function crearTransporteConsola({ log = console } = {}) {
  return {
    nombre: 'consola (simulacion)',
    // A diferencia de los reales, acepta cualquier destino: la gracia de la
    // simulacion es ver tambien lo que HOY no se enviaria por falta de Space.
    soporta: () => true,
    async enviar(destino, mensaje) {
      const via = destino.chat_space_name
        ? `Chat App -> ${destino.chat_space_name}`
        : destino.chat_webhook_url
          ? 'webhook'
          : 'sin Space ni webhook: hoy no se enviaría'
      const botones = mensaje.card ? ' [card con botones]' : ''
      log.log?.(`\n──────── ${destino.nombre} (${via})${botones}\n${mensaje.texto}\n`)
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
    if (!transporte.soporta(mensaje.destino)) {
      resultado.omitidos++
      continue
    }
    try {
      await transporte.enviar(mensaje.destino, mensaje)
      resultado.enviados++
    } catch (err) {
      resultado.fallidos.push({ etiqueta: mensaje.etiqueta, error: err.message })
      log.warn?.(`[notificaciones] fallo el aviso a ${mensaje.etiqueta}: ${err.message}`)
    }
    // Sin pausa despues del ultimo: no hay nada esperando atras.
    if (i < mensajes.length - 1) await esperar(pausaMs)
  }

  return resultado
}
