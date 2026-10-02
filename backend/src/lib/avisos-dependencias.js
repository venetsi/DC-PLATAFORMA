// Aviso de Chat "Ya podés hacerla": cuando se marca una tarea (o queda como
// "no aplica") y a alguna de las que la esperaban ya no le falta nada.
//
// Sale por dos lados (decision del usuario, 2026-09-28):
//   - al Space del departamento de la tarea que esperaba, con un boton para
//     marcarla desde ahi mismo;
//   - en privado a su responsable, si tiene uno. Sin mencion @ en el Space,
//     para que no le llegue dos veces.
// El privado necesita el id de Chat de la persona, y la app hoy lo tiene solo
// de quienes ya la usaron (ver idDeChatPorEmail en chat.js): al resto le
// llega solo el del Space.
//
// Con AVISO_DRY_RUN=1 (desarrollo) arma todo y lo deja en el log, sin postear.
import { liberadasPor, prerrequisitosPendientes } from './dependencias.js'
import { cardLiberadas, cardLiberadasPrivada } from './chat-cards.js'
import { hoyEnArgentina } from './vencimiento.js'

// Lo que cada ruta que marca le pasa a marcarInstanciaYPropagar: el aviso de
// "se marco, pero falta X" y, despues de marcar, el aviso a las que esperaban.
export function ganchosDeDependencias(deps) {
  return {
    evaluarAvisos: ({ idAsignacion, fechaISO }) => prerrequisitosPendientes(deps, { idAsignacion, fechaISO }),
    alMarcar: (marcada) => avisarLiberadas(deps, marcada)
  }
}

function filaDe(liberada) {
  return {
    instanceId: liberada.instancia.id,
    fecha: liberada.fecha,
    idDepartamento: liberada.asignacion.tarea.departamento.id,
    nombre_tarea: liberada.nombre_tarea,
    local: liberada.local,
    responsable: liberada.responsable
  }
}

// NUNCA tira: el marcado ya se aplico y un aviso que falla no puede
// convertirlo en un error para quien marco.
export async function avisarLiberadas(deps, { idAsignacion, fechaISO, estado = 'REALIZADA', emailUsuario = null }) {
  const { db, log = console } = deps
  const resultado = { liberadas: 0, spaces: 0, privados: 0, sin_privado: 0, sin_space: 0, simulados: 0, fallidos: 0, sin_confirmar: 0 }
  try {
    const { prerequisito, liberadas, incompletas = [] } = await liberadasPor(deps, { idAsignacion, fechaISO, estado, emailUsuario })
    // No se pudo leer alguna agenda: esas NO se avisan (un "Ya podés hacerla"
    // falso es peor que ninguno), pero se dejan dichas en el log.
    if (incompletas.length) {
      resultado.sin_confirmar = incompletas.length
      log.warn?.({ idAsignacion, incompletas: incompletas.map((i) => `${i.nombre_tarea} — ${i.local}`), ...resultado }, 'dependencias: no se pudo confirmar si quedaron liberadas (fallo la lectura de Calendar)')
    }
    if (!liberadas.length) return resultado
    resultado.liberadas = liberadas.length

    // `deps.chat` permite probarlo sin llamar a Google.
    const chat = deps.chat ?? (await import('./chat.js'))
    const simular = process.env.AVISO_DRY_RUN === '1'
    const hoyISO = hoyEnArgentina()
    const urlApp = process.env.FRONTEND_URL
    // Devuelve true si salio de verdad. En simulacion no cuenta como enviado.
    const postear = async (space, cuerpo, etiqueta) => {
      if (simular) {
        log.info?.({ space, etiqueta, cuerpo: JSON.stringify(cuerpo) }, 'dependencias: aviso simulado (AVISO_DRY_RUN=1)')
        resultado.simulados++
        return false
      }
      await chat.postearEnSpace(space, cuerpo)
      return true
    }

    // 1) El Space de cada departamento que tenia tareas esperando.
    const porDepartamento = new Map()
    for (const liberada of liberadas) {
      const departamento = liberada.asignacion.tarea.departamento
      if (!porDepartamento.has(departamento.id)) porDepartamento.set(departamento.id, { departamento, filas: [] })
      porDepartamento.get(departamento.id).filas.push(filaDe(liberada))
    }
    for (const { departamento, filas } of porDepartamento.values()) {
      // Sin Space no hay donde postear: antes se saltaba sin dejar rastro y
      // el aviso se perdia en silencio. Ahora se cuenta y se loguea.
      if (!departamento.chat_space_name) {
        resultado.sin_space++
        log.warn?.({ departamento: departamento.slug, filas: filas.length }, 'dependencias: el departamento no tiene Space vinculado, el aviso de tareas liberadas no salio')
        continue
      }
      try {
        if (await postear(departamento.chat_space_name, cardLiberadas({ departamento, filas, prerequisito, hoyISO, urlApp }), departamento.nombre)) resultado.spaces++
      } catch (err) {
        resultado.fallidos++
        // Un Space inaccesible (403/404) NO se desvincula aca: ver el comentario
        // de crearTransporteChatApp. La baja la da REMOVED_FROM_SPACE.
        log.warn?.({ err: err.message, departamento: departamento.slug }, 'dependencias: no se pudo avisar en el Space')
      }
    }

    // 2) En privado a cada responsable, salvo a quien acaba de marcar: ya sabe.
    const quienMarco = String(emailUsuario || '').toLowerCase().trim()
    const porPersona = new Map()
    for (const liberada of liberadas) {
      const email = String(liberada.responsable || '').toLowerCase().trim()
      if (!email || email === quienMarco) continue
      if (!porPersona.has(email)) porPersona.set(email, [])
      porPersona.get(email).push(filaDe(liberada))
    }
    for (const [email, filas] of porPersona) {
      try {
        const chatUserName = await chat.idDeChatPorEmail({ db, email, log, soloLectura: simular })
        const privado = chatUserName ? await chat.buscarMensajeDirecto(chatUserName) : null
        if (!privado) {
          resultado.sin_privado++
          continue
        }
        if (await postear(privado, cardLiberadasPrivada({ filas, prerequisito, hoyISO, urlApp }), email)) resultado.privados++
      } catch (err) {
        resultado.fallidos++
        log.warn?.({ err: err.message }, 'dependencias: no se pudo mandar el aviso privado')
      }
    }

    log.info?.({ prerequisito: `${prerequisito.nombre_tarea} — ${prerequisito.local}`, fecha: fechaISO, ...resultado, simulado: simular }, 'dependencias: aviso de tareas liberadas')
    return resultado
  } catch (err) {
    log.warn?.({ err: err.message, idAsignacion }, 'dependencias: no se pudo armar el aviso de tareas liberadas')
    return { ...resultado, error: err.message }
  }
}
