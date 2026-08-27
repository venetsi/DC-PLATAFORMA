// Construccion de las cards de Chat (cardsV2). Compartido entre el job que
// las postea y el receptor que las actualiza tras un click, para que el
// mensaje re-renderizado sea el mismo widget y no una version parecida.
import { lineaDeTarea } from './mensajes-chat.js'
import { formatearMonto } from './pagos.js'

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

// Subtitulo de la card del dialogo: el departamento, salvo en "modo todo"
// (Space de Dirección viendo la empresa entera -- ver chat-comandos.js) o un
// Space compartido entre varios departamentos concretos (ver /compartir),
// donde se nombran todos los que cubre.
function subtituloDialogo({ departamento, departamentos, modoTodo }) {
  if (modoTodo) return 'Todos los departamentos'
  if (departamentos?.length > 1) return departamentos.map((d) => d.nombre).join(' + ')
  return departamento?.nombre
}

function deQuienDialogo({ departamento, departamentos, modoTodo }) {
  if (modoTodo) return ' en cualquier departamento'
  if (departamentos?.length > 1) return ` en ${departamentos.map((d) => d.nombre).join(' + ')}`
  return departamento ? ` en ${departamento.nombre}` : ''
}

// Card de "no hay nada para elegir" -- misma forma para los tres dialogos
// (sin pendientes, o sin destinatarios en el caso de /derivar).
function tarjetaDialogoVacia(titulo, subtitulo, texto) {
  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: titulo, subtitle: subtitulo },
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
export function dialogoAsignar(pendientes, { departamento, departamentos, porFallback, modoTodo } = {}) {
  // Siempre se nombra el ambito: un "no hay nada pendiente 🎉" sin decir DONDE
  // resulta enganoso -- paso de verdad al probar en un Space sin vincular, que
  // cae al departamento propio de quien escribe.
  const deQuien = deQuienDialogo({ departamento, departamentos, modoTodo })
  const subtitulo = subtituloDialogo({ departamento, departamentos, modoTodo })
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Tomar una tarea',
      subtitulo,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Tomar una tarea', subtitle: subtitulo },
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

export function dialogoPasar(pendientes, personas, { departamento, departamentos, porFallback, modoTodo } = {}) {
  const deQuien = deQuienDialogo({ departamento, departamentos, modoTodo })
  const subtitulo = subtituloDialogo({ departamento, departamentos, modoTodo })
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Pasar una tarea',
      subtitulo,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }
  if (!personas.length) {
    return tarjetaDialogoVacia('Pasar una tarea', subtitulo, 'No hay usuarios activos para elegir.')
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Pasar una tarea', subtitle: subtitulo },
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

export function dialogoApuntar(pendientes, { departamento, departamentos, porFallback, modoTodo } = {}) {
  const deQuien = deQuienDialogo({ departamento, departamentos, modoTodo })
  const subtitulo = subtituloDialogo({ departamento, departamentos, modoTodo })
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Dejar una nota',
      subtitulo,
      `No hay tareas pendientes${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Dejar una nota', subtitle: subtitulo },
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

// /tildar: version en dialogo de /marcar, pero de VARIAS de una -- un
// checkbox por tarea (no un radio button como los otros tres dialogos),
// ordenadas por atraso, con el semaforo + contadores del dia arriba. El
// pedido fue explicito por "un checkbox" y "los colores": Chat no tiene
// colores de verdad en una card, asi que se usan los mismos 🔴🟡🟢 del
// kiosko -- ver chat-comandos.js#resumenDelDia, que calcula esto con el
// MISMO criterio que routes/tv.js#estado_general.
export const ACCION_TILDAR_SUBMIT = 'tildar_submit'
export const CAMPO_TAREAS = 'tareas' // plural: CHECK_BOX puede volver con varios values

// Generico a proposito: lo usan /tildar (tareas de Calendar) y /tildarpagos
// (PagoSeguimiento, sin Calendar de por medio) -- el widget es identico, solo
// cambia de que lista viene cada uno.
function selectorMultiple(pendientes, { name, label }) {
  return {
    selectionInput: {
      name,
      label,
      type: 'CHECK_BOX',
      items: pendientes.slice(0, MAX_TAREAS_POR_CARD).map((p) => ({
        text: p.etiqueta,
        value: p.instanceId,
        // Sin nada preseleccionado, igual que el dropdown de /derivar: aca
        // hay VARIAS en juego (no una sola "mas relevante" como en el radio
        // button de /asignar), asi que default a todo tildado seria peligroso.
        selected: false
      }))
    }
  }
}

export function dialogoTildar(pendientes, { departamento, departamentos, porFallback, modoTodo, resumen } = {}) {
  const deQuien = deQuienDialogo({ departamento, departamentos, modoTodo })
  const subtitulo = subtituloDialogo({ departamento, departamentos, modoTodo })

  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Marcar tareas',
      subtitulo,
      `No hay nada atrasado ni pendiente de hoy${deQuien}. 🎉${aclaracionDeFallback(porFallback)}`
    )
  }

  const encabezado = resumen
    ? `${resumen.semaforo} *Hoy:* ${resumen.vencidas} vencidas · ${resumen.pendientes} pendientes · ${resumen.realizadas} hechas`
    : ''
  const recorte = pendientes.length > MAX_TAREAS_POR_CARD
    ? `\n_y ${pendientes.length - MAX_TAREAS_POR_CARD} más -- marcalas de a una con \`/marcar\`._`
    : ''

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Marcar tareas', subtitle: subtitulo },
            sections: [
              {
                widgets: [
                  ...(encabezado ? [{ textParagraph: { text: `${encabezado}${recorte}` } }] : []),
                  selectorMultiple(pendientes, { name: CAMPO_TAREAS, label: `¿Cuáles ya están hechas? (${pendientes.length})` }),
                  { buttonList: { buttons: [{ text: 'Marcar', onClick: accionEnEsteEndpoint(ACCION_TILDAR_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}

// ── /pago, /mispagos, /tildarpagos ─────────────────────────────────────────
//
// Distintos de los dialogos de arriba en un punto clave: NO estan acotados a
// un departamento (Pago no tiene departamento, solo local), asi que no usan
// resolverDepartamento/modoTodo ni subtituloDialogo/deQuienDialogo -- ver
// chat-comandos.js#pagosParaVincular.

export const ACCION_PAGO_SUBMIT = 'pago_submit'
export const CAMPO_PAGO = 'pago'
export const CAMPO_TAREA_PAGO = 'tarea_pago'
// Techo de tareas del catalogo en el dropdown de clasificacion -- hoy el
// catalogo es chico, pero el mismo motivo que MAX_PERSONAS_POR_DIALOGO: no
// dejar que un payload crezca sin limite si el catalogo crece mucho.
const MAX_TAREAS_PARA_CLASIFICAR = 100

// pendientes: [{ id, comprobante, proveedor, rubro, categoria, importe, fecha_dia }]
// (crudo de lib/pagos.js, no pre-formateado -- la etiqueta se arma aca)
export function dialogoPago(pendientes, tareas, personas, { local } = {}) {
  if (!pendientes.length) {
    return tarjetaDialogoVacia(
      'Vincular un pago',
      local?.nombre,
      `No encontré pagos recientes sin vincular para *${local?.nombre}*.`
    )
  }

  const etiquetaPago = (p) => {
    const monto = formatearMonto(p.importe) || '(sin importe)'
    const fecha = p.fecha_dia || ''
    return `${p.comprobante || '(sin comprobante)'} — ${p.proveedor} — ${monto} — ${fecha}`
  }

  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Vincular un pago', subtitle: local?.nombre },
            sections: [
              {
                widgets: [
                  {
                    selectionInput: {
                      name: CAMPO_PAGO,
                      label: `¿Cuál pago? (${pendientes.length})`,
                      type: 'RADIO_BUTTON',
                      items: pendientes.slice(0, MAX_TAREAS_POR_CARD).map((p, i) => ({
                        text: etiquetaPago(p),
                        value: p.id,
                        selected: i === 0
                      }))
                    }
                  },
                  {
                    // Sin preseleccion real (aparte del placeholder): clasificar
                    // o asignar es opcional, un default a la primera tarea real
                    // del catalogo asignaria algo que nadie eligio.
                    selectionInput: {
                      name: CAMPO_TAREA_PAGO,
                      label: 'Clasificar con una tarea (opcional)',
                      type: 'DROPDOWN',
                      items: [
                        { text: '(sin clasificar)', value: '', selected: true },
                        ...tareas.slice(0, MAX_TAREAS_PARA_CLASIFICAR).map((t) => ({ text: t.nombre, value: t.id }))
                      ]
                    }
                  },
                  {
                    selectionInput: {
                      name: CAMPO_PERSONA,
                      label: '¿A quién se lo asignás? (opcional)',
                      type: 'DROPDOWN',
                      items: [
                        { text: '(sin asignar)', value: '', selected: true },
                        ...personas.map((p) => ({ text: `${p.nombre} (${p.email})`, value: p.email }))
                      ]
                    }
                  },
                  { buttonList: { buttons: [{ text: 'Vincular', onClick: accionEnEsteEndpoint(ACCION_PAGO_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}

// /tildarpagos: version en checkbox de "marcar varios pagos resueltos", mismo
// widget que /tildar (selectorMultiple) pero sin Calendar ni semaforo de por
// medio -- PagoSeguimiento vive entero en la base propia.
export const ACCION_TILDARPAGOS_SUBMIT = 'tildarpagos_submit'
export const CAMPO_PAGOS = 'pagos'

export function dialogoTildarPagos(pendientes) {
  if (!pendientes.length) {
    return tarjetaDialogoVacia('Marcar pagos', undefined, 'No tenés pagos pendientes. 🎉')
  }
  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Marcar pagos' },
            sections: [
              {
                widgets: [
                  selectorMultiple(pendientes, { name: CAMPO_PAGOS, label: `¿Cuáles ya resolviste? (${pendientes.length})` }),
                  { buttonList: { buttons: [{ text: 'Marcar', onClick: accionEnEsteEndpoint(ACCION_TILDARPAGOS_SUBMIT) }] } }
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
                      ? `_y ${resto} más — también podés escribir_ \`/vincular\` _y elegir de una lista con checkbox._`
                      : '_También podés escribir_ `/vincular` _y elegir de una lista con checkbox (sirve para tildar más de uno)._'
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

// Dialogo (checkbox) de /vincular: que departamento(s) cubre este Space. Un
// solo formulario reemplaza al /vincular de texto original y a /compartir +
// /descompartir -- volver a abrir este mismo dialogo y tildar distinto ES la
// forma de agregar, sacar, o cambiar el dueño (ver vincularDepartamentos en
// chat-comandos.js). A diferencia de los demas dialogos, el value de cada
// item es directamente el id del departamento, no una tarea codificada.
export const ACCION_VINCULAR_SUBMIT = 'vincular_submit'
export const CAMPO_DEPARTAMENTOS_VINCULAR = 'departamentos_vincular'

export function dialogoVincular(departamentos, { actuales } = {}) {
  const seleccionados = actuales instanceof Set ? actuales : new Set(actuales || [])
  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: 'Vincular Space', subtitle: '¿Qué departamento(s) cubre este Space?' },
            sections: [
              {
                widgets: [
                  {
                    selectionInput: {
                      name: CAMPO_DEPARTAMENTOS_VINCULAR,
                      label: `Departamentos (${departamentos.length})`,
                      type: 'CHECK_BOX',
                      items: departamentos.map((d) => ({
                        text: d.nombre,
                        value: d.id,
                        selected: seleccionados.has(d.id)
                      }))
                    }
                  },
                  {
                    textParagraph: {
                      text:
                        '_El primero que quede tildado (o el que ya era dueño) recibe el recordatorio diario ' +
                        'automático; el resto comparte la consulta y la operación, pero no ese aviso puntual. ' +
                        'Sin nada tildado, este Space se desvincula por completo._'
                    }
                  },
                  { buttonList: { buttons: [{ text: 'Guardar', onClick: accionEnEsteEndpoint(ACCION_VINCULAR_SUBMIT) }] } }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}
