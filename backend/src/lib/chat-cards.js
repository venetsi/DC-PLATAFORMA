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

// En el framework de Workspace Add-ons con endpoint HTTP, `action.function` es
// la **URL a invocar**, no un nombre de funcion. El placeholder FUNCTION_URL de
// la documentacion de Google era literal.
//
// Comprobado empiricamente (2026-08-26) posteando una card con cuatro botones,
// uno por variante, y mirando cual llegaba al servidor:
//   function: 'probar_A_nombre'            -> NO llega ningun request
//   function: '<URL del endpoint>'         -> llega, 200
//   function: '<URL>#fragmento'            -> llega pero 401
//   function: '<URL>?query=1'              -> llega pero 401
// Las dos ultimas fallan porque el `aud` del token pasa a incluir el fragmento
// o el query y deja de coincidir con CHAT_AUDIENCE. O sea: la URL tiene que ser
// EXACTA, sin nada agregado.
//
// Consecuencia: como todos los botones apuntan a la misma URL, la accion no
// puede ir en `function`. Ademas el payload del click NO trae
// commonEventObject.invokedFunction (verificado en el body real), asi que la
// accion viaja como un parametro mas -- ver CAMPO_ACCION.
//
// La URL tiene que coincidir EXACTA con la configurada en la consola de Chat,
// porque es tambien el `aud` del token que Google firma (una con ?query o
// #fragmento llega al endpoint pero falla la verificacion con 401).
//
// CHAT_AUDIENCE es esa misma URL, asi que se reusa para no tener dos fuentes de
// verdad. El default explicito NO es decorativo: las cards no se construyen
// solo en el servicio web -- tambien las arma el Cloud Run Job del aviso
// diario, que no tiene esa variable seteada. Sin el default, ese job posteaba
// botones con `function: ''`, o sea otra vez botones muertos, y en silencio.
export const URL_ENDPOINT_POR_DEFECTO =
  'https://dc-plataforma-api-288069746644.us-central1.run.app/api/chat/eventos'

export function urlDelEndpoint() {
  const url = (process.env.CHAT_AUDIENCE || '').trim()
  return url || URL_ENDPOINT_POR_DEFECTO
}

export const CAMPO_ACCION = 'accion'

function accionEnEsteEndpoint(accion, parametros = []) {
  return {
    action: {
      function: urlDelEndpoint(),
      // Los parametros vienen del CLIENTE cuando vuelven: el receptor los
      // re-verifica contra la base, nunca confia en ellos para decidir
      // permisos. `accion` dice QUE hacer, ya que function ahora es la URL.
      parameters: [{ key: CAMPO_ACCION, value: accion }, ...parametros]
    }
  }
}

function botonMarcar(evento) {
  return {
    text: 'Marcar hecha',
    onClick: accionEnEsteEndpoint(ACCION_MARCAR, [
      { key: 'instanceId', value: evento.id },
      { key: 'fecha', value: evento.start?.date || '' }
    ])
  }
}

export const URL_APP_POR_DEFECTO = 'https://dc-plataforma.web.app'

// Un mensaje de Chat lo abre una persona real desde su telefono o su maquina:
// un link a localhost NUNCA sirve. Paso de verdad -- correr el job desde una
// maquina de desarrollo posteo botones apuntando a localhost:5173 en un Space
// real, porque FRONTEND_URL ahi vale eso. La guarda evita que se repita.
export function urlPublica(url) {
  if (!url) return URL_APP_POR_DEFECTO
  try {
    const { hostname } = new URL(url)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return URL_APP_POR_DEFECTO
    }
    return url.replace(/\/+$/, '')
  } catch {
    return URL_APP_POR_DEFECTO
  }
}

// Boton que abre la plataforma en el navegador (openLink lo resuelve el
// cliente, sin pasar por el endpoint). Se usa para el "Ver todas" del pie.
function botonAbrir(urlApp, texto = 'Abrir') {
  return {
    text: texto,
    onClick: { openLink: { url: `${urlPublica(urlApp)}/mis-tareas` } }
  }
}

function seccionDeTareas(titulo, items, nombreLocal, { conBotones = true, urlApp } = {}) {
  const widgets = items.map(({ evento, dias }) => ({
    decoratedText: {
      text: textoDeItem({ evento, dias }, nombreLocal),
      wrapText: true,
      // Un solo boton por fila: decoratedText admite `button` (singular), no
      // una lista. Se elige "Marcar hecha", que es la accion que la gente
      // quiere hacer desde el aviso; para ver el detalle esta el "Ver todas"
      // del pie y los comandos.
      ...(conBotones ? { button: botonMarcar(evento) } : {})
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
            text: `_y ${total - mostradas} más_`,
            wrapText: true,
            // Sin condicional: urlPublica() siempre devuelve una URL usable,
            // asi que el boton nunca queda a medias.
            button: botonAbrir(urlApp, 'Ver todas')
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
// departamento con un click, en vez de cargar chat_space_name por SQL a mano.
// El comando /vincular hace lo mismo, para quien prefiera escribirlo.
export const ACCION_ASIGNAR_SUBMIT = 'asignar_submit'
export const CAMPO_TAREA = 'tarea'

// Aclaracion comun a los tres dialogos: cuando el departamento no salio del
// Space, hay que decirlo -- sin esto, alguien parado en un Space sin vincular
// ve las tareas de otro departamento sin ninguna pista de por que.
function aclaracionDeFallback(porFallback) {
  return porFallback
    ? '\n\nEste Space no está vinculado a ningún departamento, así que ves el tuyo. Un administrador puede vincularlo con /vincular.'
    : ''
}

// Card de "no hay nada para elegir" -- misma forma para los tres dialogos
// (sin pendientes, o sin destinatarios en el caso de /derivar).
function tarjetaDialogoVacia(titulo, departamento, texto) {
  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: titulo, subtitle: departamento?.nombre },
            sections: [{ widgets: [{ textParagraph: { text: texto } }] }]
          }
        }
      ]
    }
  }
}

// El selector de tarea es el mismo widget en los tres dialogos (/asignar,
// /derivar, /apuntar): una tarea de una lista, no un numero ni un texto libre.
function selectorDeTarea(pendientes, { label = '¿Cuál?' } = {}) {
  return {
    selectionInput: {
      name: CAMPO_TAREA,
      label,
      type: 'RADIO_BUTTON',
      items: pendientes.slice(0, MAX_TAREAS_POR_CARD).map((p, i) => ({
        text: p.etiqueta,
        // El value viaja al submit: es el id de la instancia, que el
        // receptor re-verifica contra Calendar igual.
        value: p.instanceId,
        selected: i === 0
      }))
    }
  }
}

// Dialogo (formulario modal) para elegir una tarea de una lista en vez de
// escribir su nombre. Se abre devolviendo action.navigations[].pushCard.
//
// El envio del formulario vuelve como buttonClickedPayload con los valores en
// commonEventObject.formInputs, y FUNCIONA -- verificado en produccion una vez
// corregido que action.function tiene que ser la URL del endpoint.
export function dialogoAsignar(pendientes, { departamento, porFallback } = {}) {
  // Siempre se nombra el departamento: un "no hay nada pendiente 🎉" sin decir
  // de QUE departamento resulta enganoso -- paso de verdad al probar en un
  // Space sin vincular, que cae al departamento propio de quien escribe.
  const deQuien = departamento ? ` en ${departamento.nombre}` : ''
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Tomar una tarea',
      departamento,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Tomar una tarea', subtitle: departamento?.nombre },
            sections: [
              {
                widgets: [
                  selectorDeTarea(pendientes, { label: '¿Cuál tomás?' }),
                  { buttonList: { buttons: [{ text: 'Tomar', onClick: accionEnEsteEndpoint(ACCION_ASIGNAR_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}

// /derivar: version en dialogo de /pasar -- elegir tarea Y persona de dos
// listas en vez de escribir "tarea: email". Nace como comando NUEVO y no como
// un cambio de tipo sobre /pasar, para no arriesgar el comando de barra que
// ya esta probado en produccion (no esta confirmado que un comando configurado
// como "barra + Dialogo" siga aceptando texto plano).
export const ACCION_PASAR_SUBMIT = 'pasar_submit'
export const CAMPO_PERSONA = 'persona'
// Techo de personas en el dropdown -- 30 hoy, no deberia acercarse nunca, pero
// evita un payload gigante si la nomina crece mucho sin que nadie lo note.
const MAX_PERSONAS_POR_DIALOGO = 100

export function dialogoPasar(pendientes, personas, { departamento, porFallback } = {}) {
  const deQuien = departamento ? ` en ${departamento.nombre}` : ''
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Pasar una tarea',
      departamento,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }
  if (!personas.length) {
    return tarjetaDialogoVacia('Pasar una tarea', departamento, 'No hay usuarios activos para elegir.')
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Pasar una tarea', subtitle: departamento?.nombre },
            sections: [
              {
                widgets: [
                  selectorDeTarea(pendientes, { label: '¿Cuál pasás?' }),
                  {
                    // Sin item preseleccionado, a proposito: a diferencia de
                    // la tarea (donde la mas vieja es un default razonable),
                    // acá no hay una persona "por defecto" -- si nadie elige,
                    // pasarPorInstanceId lo rechaza en vez de adivinar.
                    selectionInput: {
                      name: CAMPO_PERSONA,
                      label: '¿A quién se la pasás?',
                      type: 'DROPDOWN',
                      items: personas.slice(0, MAX_PERSONAS_POR_DIALOGO).map((p) => ({
                        text: `${p.nombre} (${p.email})`,
                        value: p.email
                      }))
                    }
                  },
                  { buttonList: { buttons: [{ text: 'Pasar', onClick: accionEnEsteEndpoint(ACCION_PASAR_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}

// /apuntar: version en dialogo de /nota -- elegir tarea de una lista y
// escribir el comentario en un textInput, en vez de "tarea: comentario".
export const ACCION_NOTA_SUBMIT = 'nota_submit'
export const CAMPO_NOTA_TEXTO = 'nota_texto'

export function dialogoApuntar(pendientes, { departamento, porFallback } = {}) {
  const deQuien = departamento ? ` en ${departamento.nombre}` : ''
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Dejar una nota',
      departamento,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Dejar una nota', subtitle: departamento?.nombre },
            sections: [
              {
                widgets: [
                  selectorDeTarea(pendientes, { label: '¿En cuál?' }),
                  { textInput: { name: CAMPO_NOTA_TEXTO, label: 'Nota', type: 'MULTIPLE_LINE' } },
                  { buttonList: { buttons: [{ text: 'Anotar', onClick: accionEnEsteEndpoint(ACCION_NOTA_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}

// Cierra el dialogo y muestra un aviso flotante.
export function cerrarDialogo(texto) {
  return {
    action: {
      navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }],
      notification: { text: texto }
    }
  }
}

// Card con un boton por departamento. El comando /vincular hace exactamente lo
// mismo, para quien prefiera escribirlo o cuando hay mas departamentos libres
// que botones en la card.
export function cardVincular(departamentosDisponibles) {
  if (!departamentosDisponibles.length) {
    return {
      text:
        '👋 Ya está: todos los departamentos tienen un Space vinculado. ' +
        'Si querés mover uno a este Space, desvinculalo primero desde la plataforma.'
    }
  }

  // Una card por cada departamento seria demasiado alta con 11: se limita y el
  // resto queda accesible por comando, que hace exactamente lo mismo.
  const conBoton = departamentosDisponibles.slice(0, MAX_TAREAS_POR_CARD)
  const resto = departamentosDisponibles.length - conBoton.length

  return {
    cardsV2: [
      {
        cardId: 'vincular-space',
        card: {
          header: { title: 'DC-PLATAFORMA', subtitle: '¿A qué departamento vinculo este Space?' },
          sections: [
            {
              widgets: [
                ...conBoton.map((d) => ({
                  decoratedText: {
                    text: d.nombre,
                    button: {
                      text: 'Vincular',
                      onClick: accionEnEsteEndpoint(ACCION_VINCULAR, [
                        { key: 'idDepartamento', value: d.id }
                      ])
                    }
                  }
                })),
                {
                  textParagraph: {
                    text: resto
                      ? `_y ${resto} más — también podés escribir_ \`/vincular\` _y el nombre._`
                      : '_También podés escribir_ `/vincular` _y el nombre del departamento._'
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  }
}
