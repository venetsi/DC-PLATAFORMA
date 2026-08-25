// Construccion de las cards de Chat (cardsV2). Compartido entre el job que
// las postea y el receptor que las actualiza tras un click, para que el
// mensaje re-renderizado sea el mismo widget y no una version parecida.
import { lineaDeTarea } from './mensajes-chat.js'

// Una card no puede llevar un boton por cada tarea de un backlog largo: Chat
// corta el mensaje. Se muestran las mas viejas -- que son las que importan --
// y el resto se manda a la app.
export const MAX_TAREAS_POR_CARD = 20

export const ACCION_MARCAR = 'marcar'
export const ACCION_VINCULAR = 'vincular'

function textoDeItem({ evento, dias }, nombreLocal) {
  // Reusa el mismo formateo que el texto plano (incluido el fix del titulo
  // repetido), sin el bullet: en una card cada tarea ya es su propia fila.
  return lineaDeTarea({ evento, dias }, nombreLocal, { conAntiguedad: true }).replace(/^• /, '')
}

function seccionDeTareas(titulo, items, nombreLocal, { conBotones = true } = {}) {
  const widgets = items.map(({ evento, dias }) => ({
    decoratedText: {
      text: textoDeItem({ evento, dias }, nombreLocal),
      wrapText: true,
      ...(conBotones
        ? {
            button: {
              text: 'Marcar hecha',
              onClick: {
                action: {
                  function: ACCION_MARCAR,
                  // Estos parametros vienen del CLIENTE cuando vuelven: el
                  // receptor los re-verifica contra la base, nunca confia en
                  // ellos para decidir permisos.
                  parameters: [
                    { key: 'instanceId', value: evento.id },
                    { key: 'fecha', value: evento.start?.date || '' }
                  ]
                }
              }
            }
          }
        : {})
    }
  }))
  return { header: titulo, collapsible: false, widgets }
}

// Card del recordatorio diario de un departamento.
export function cardDepartamento(departamento, baldes, nombreLocal, { umbrales, urlApp } = {}) {
  const { pendientes_hoy: pendientesHoy, vencidas, escala_departamento: escaladas } = baldes
  const idsEscaladas = new Set(escaladas.map((e) => e.evento.id))
  const resto = vencidas.filter((v) => !idsEscaladas.has(v.evento.id))

  const secciones = []
  let mostradas = 0
  const recortar = (items) => {
    const espacio = Math.max(0, MAX_TAREAS_POR_CARD - mostradas)
    const usados = items.slice(0, espacio)
    mostradas += usados.length
    return usados
  }

  const escaladasVisibles = recortar(escaladas)
  if (escaladasVisibles.length) {
    const titulo = umbrales?.departamento
      ? `🚨 Atrasadas ${umbrales.departamento}+ días hábiles`
      : '🚨 Atrasadas'
    secciones.push(seccionDeTareas(titulo, escaladasVisibles, nombreLocal))
  }

  const restoVisible = recortar(resto)
  if (restoVisible.length) secciones.push(seccionDeTareas('⚠️ Vencidas', restoVisible, nombreLocal))

  const hoyVisible = recortar(pendientesHoy)
  if (hoyVisible.length) secciones.push(seccionDeTareas('🕒 Pendientes de hoy', hoyVisible, nombreLocal))

  // El recorte se dice en voz alta: una card truncada en silencio se lee como
  // "no hay nada mas", que es peor que no mostrar nada.
  const total = vencidas.length + pendientesHoy.length
  if (total > mostradas) {
    secciones.push({
      widgets: [
        {
          decoratedText: {
            text: `<i>y ${total - mostradas} más</i>`,
            wrapText: true,
            ...(urlApp
              ? { button: { text: 'Ver todas', onClick: { openLink: { url: urlApp } } } }
              : {})
          }
        }
      ]
    })
  }

  return {
    cardsV2: [
      {
        cardId: `recordatorio-${departamento.id}`,
        card: {
          header: { title: 'Recordatorio diario', subtitle: departamento.nombre },
          sections: secciones
        }
      }
    ]
  }
}

// Card que se manda cuando agregan la app a un Space: vincularlo a un
// departamento con un click, en vez de cargar el Space por SQL a mano.
export function cardVincular(departamentosDisponibles) {
  if (!departamentosDisponibles.length) {
    return {
      text:
        '👋 Ya está: todos los departamentos tienen un Space vinculado. ' +
        'Si querés mover uno a este Space, desvinculalo primero desde la plataforma.'
    }
  }

  return {
    cardsV2: [
      {
        cardId: 'vincular-space',
        card: {
          header: { title: 'DC-PLATAFORMA', subtitle: '¿A qué departamento vinculo este Space?' },
          sections: [
            {
              widgets: departamentosDisponibles.map((d) => ({
                decoratedText: {
                  text: d.nombre,
                  button: {
                    text: 'Vincular',
                    onClick: { action: { function: ACCION_VINCULAR, parameters: [{ key: 'idDepartamento', value: d.id }] } }
                  }
                }
              }))
            }
          ]
        }
      }
    ]
  }
}
