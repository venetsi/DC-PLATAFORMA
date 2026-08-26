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

// Boton "Marcar hecha" que resuelve el click en el propio endpoint.
//
// NO SE USA HOY: los botones de tipo `action` no funcionan en esta app --
// Chat reconoce el click (queda en chat.googleapis.com/errors con el
// deploymentFunction correcto) pero nunca llega un request al endpoint, y
// responde "Can't post a reply". Se probo y descarto: tipo de Space
// (colaboracion vs anuncios), permisos del Space, cache del browser, espacios
// externos, y crear un deployment en gsuiteaddons. Ver
// docs/CONFIGURAR-CHAT-APP.md.
//
// Se deja armado porque el dia que se resuelva es cambiar una linea en
// seccionDeTareas, y porque los parametros/permisos del receptor ya estan
// escritos y probados (routes/chat.js#marcar).
function botonMarcar(evento) {
  return {
    text: 'Marcar hecha',
    onClick: {
      action: {
        function: ACCION_MARCAR,
        // Estos parametros vienen del CLIENTE cuando vuelven: el receptor los
        // re-verifica contra la base, nunca confia en ellos para decidir
        // permisos.
        parameters: [
          { key: 'instanceId', value: evento.id },
          { key: 'fecha', value: evento.start?.date || '' }
        ]
      }
    }
  }
}

// Boton que abre la tarea en la plataforma. Es el que se usa: `openLink` NO
// pasa por el ruteo de acciones roto (verificado en produccion), asi que la
// tarjeta queda util en vez de tener un boton que falla.
function botonAbrir(urlApp) {
  return {
    text: 'Abrir',
    onClick: { openLink: { url: `${urlApp || 'https://dc-plataforma.web.app'}/mis-tareas` } }
  }
}

function seccionDeTareas(titulo, items, nombreLocal, { conBotones = true, urlApp } = {}) {
  const widgets = items.map(({ evento, dias }) => ({
    decoratedText: {
      text: textoDeItem({ evento, dias }, nombreLocal),
      wrapText: true,
      ...(conBotones ? { button: botonAbrir(urlApp) } : {})
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
    secciones.push(seccionDeTareas(titulo, escaladasVisibles, nombreLocal, { urlApp }))
  }

  const restoVisible = recortar(resto)
  if (restoVisible.length) secciones.push(seccionDeTareas('⚠️ Vencidas', restoVisible, nombreLocal, { urlApp }))

  const hoyVisible = recortar(pendientesHoy)
  if (hoyVisible.length) secciones.push(seccionDeTareas('🕒 Pendientes de hoy', hoyVisible, nombreLocal, { urlApp }))

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
// Se responde con TEXTO y no con una card de botones a proposito: los botones
// de tipo `action` no funcionan (ver botonMarcar), y una card cuyos botones no
// hacen nada es peor que una instruccion clara. El comando /vincular hace el
// mismo trabajo y ese camino si funciona.
export function cardVincular(departamentosDisponibles) {
  if (!departamentosDisponibles.length) {
    return {
      text:
        '👋 Ya está: todos los departamentos tienen un Space vinculado. ' +
        'Si querés mover uno a este Space, desvinculalo primero desde la plataforma.'
    }
  }

  const lista = departamentosDisponibles.map((d) => `• ${d.nombre} — \`/vincular ${d.slug}\``).join('\n')
  return {
    text: [
      '👋 *Hola, soy DC-PLATAFORMA.*',
      'Para que este Space reciba los recordatorios, un administrador tiene que vincularlo a un departamento con el comando `/vincular`:',
      '',
      lista,
      '',
      '_Después de eso, todas las mañanas llega acá el resumen de tareas._'
    ].join('\n')
  }
}
