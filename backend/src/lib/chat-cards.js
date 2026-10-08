// Construccion de las cards de Chat (cardsV2). Compartido entre el job que
// las postea y el receptor que las actualiza tras un click, para que el
// mensaje re-renderizado sea el mismo widget y no una version parecida.
import { lineaDeTarea } from './mensajes-chat.js'
import { formatearMonto } from './pagos.js'
import { agruparDelDia, localDe, marcaDependencia, rangoTexto, sumarDiasISO as sumarDias, tituloDia } from './resumen-semanal.js'
import { prefijoDe } from './prioridad.js'

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

export const URL_APP_POR_DEFECTO = 'https://dc-plataforma.dcsmart.app'

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
function botonAbrir(urlApp, texto = 'Abrir', ruta = '/mis-tareas') {
  return {
    text: texto,
    onClick: { openLink: { url: `${urlPublica(urlApp)}${ruta}` } }
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
    ? `${resumen.semaforo} ${resumen.vencidas} atrasadas · *Hoy:* ${resumen.pendientes} pendientes · ${resumen.realizadas} hechas`
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
// Aviso (error, falta de permiso, "no hay nada") como DIALOGO.
//
// Los comandos /vincular, /asignar, /derivar, /apuntar, /tildar, /pago y
// /tildarpagos estan registrados en la consola de Chat para abrir un dialogo: Chat
// espera como respuesta un dialogo (action.navigations). Cuando se les contestaba
// con un mensaje de texto -- por ejemplo "Solo un administrador puede vincular" --
// Chat lo mostraba como un error del servidor ("intente nuevamente"), sin leer el
// texto (2026-10-06: /vincular de alguien que no es administrador). Por eso el
// aviso va dentro de un dialogo.
//
// Los textos de los comandos usan el formato de mensajes de Chat (*negrita*,
// `codigo`); una tarjeta usa HTML basico, asi que se convierte.
export function textoParaTarjeta(texto) {
  const seguro = String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return seguro
    .replace(/`([^`\n]+)`/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,:;!?]|$)/g, '$1<i>$2</i>')
    .replace(/\n/g, '<br>')
}

export function dialogoAviso(texto, { titulo = 'DC-PLATAFORMA' } = {}) {
  return {
    action: {
      navigations: [
        {
          pushCard: {
            header: { title: titulo },
            sections: [{ widgets: [{ textParagraph: { text: textoParaTarjeta(texto) } }] }]
          }
        }
      ]
    }
  }
}

export const ACCION_VINCULAR_SUBMIT = 'vincular_submit'
export const CAMPO_DEPARTAMENTOS_VINCULAR = 'departamentos_vincular'

export function dialogoVincular(departamentos, { actuales, ajenos = [] } = {}) {
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
                  ...(ajenos.length
                    ? [{ textParagraph: { text: textoParaTarjeta(`Este Space también cubre *${ajenos.join(', ')}*: solo un administrador puede sacarlo, así que se conserva aunque lo destildes.`) } }]
                    : []),
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

// ── "Ya podés hacerla": se completó lo que una tarea esperaba ────────────────
// (lib/avisos-dependencias.js). Una card para el Space del departamento que
// esperaba y otra, mas corta, para el mensaje privado del responsable.

// El boton de estas cards lleva el departamento: en un mensaje privado no hay
// Space vinculado del que sacarlo. El receptor lo re-verifica con puede().
// `origen` + `filas` le dicen como dejar la card despues del click.
export const ORIGEN_LIBERADA = 'liberada'

function escaparHtml(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function nombreCorto(email) {
  return email ? String(email).split('@')[0] : ''
}

function fechaCorta(fechaISO) {
  const [a, m, d] = fechaISO.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function cuandoVence(fechaISO, hoyISO) {
  if (fechaISO === hoyISO) return 'vence hoy'
  if (fechaISO < hoyISO) return `atrasada desde el ${fechaCorta(fechaISO)}`
  return `vence el ${fechaCorta(fechaISO)}`
}

function botonMarcarLiberada(fila, total) {
  return {
    text: 'Marcar hecha',
    onClick: accionEnEsteEndpoint(ACCION_MARCAR, [
      { key: 'instanceId', value: fila.instanceId },
      { key: 'fecha', value: fila.fecha },
      { key: 'idDepartamento', value: fila.idDepartamento },
      { key: 'origen', value: ORIGEN_LIBERADA },
      { key: 'filas', value: String(total) }
    ])
  }
}

function textoDeLiberada(fila, hoyISO, { conResponsable = true } = {}) {
  const partes = [`<b>${escaparHtml(fila.nombre_tarea)} — ${escaparHtml(fila.local)}</b>`, cuandoVence(fila.fecha, hoyISO)]
  if (conResponsable && fila.responsable) partes.push(escaparHtml(nombreCorto(fila.responsable)))
  return partes.join(' · ')
}

// "Se completó Cierre de caja (Tesorería), marcada por lruiz" -- sin punto
// final, para poder usarlo tambien en medio de una oracion (`enMedio`).
export function textoDelPrerequisito(prerequisito, { enMedio = false } = {}) {
  const que = `${escaparHtml(prerequisito.nombre_tarea)} (${escaparHtml(prerequisito.departamento)})`
  const quien = prerequisito.por ? escaparHtml(nombreCorto(prerequisito.por)) : null
  if (prerequisito.estado === 'NO_APLICA') return `${que} quedó como «no aplica»${quien ? ` (${quien})` : ''}`
  return `${enMedio ? 'se' : 'Se'} completó ${que}${quien ? `, marcada por ${quien}` : ''}`
}

// Para el Space del departamento que esperaba. `filas`: [{ instanceId, fecha,
// idDepartamento, nombre_tarea, local, responsable }].
export function cardLiberadas({ departamento, filas, prerequisito, hoyISO, urlApp }) {
  const visibles = filas.slice(0, MAX_TAREAS_POR_CARD)
  const widgets = visibles.map((fila) => ({
    decoratedText: { text: textoDeLiberada(fila, hoyISO), wrapText: true, button: botonMarcarLiberada(fila, filas.length) }
  }))
  if (filas.length > visibles.length) {
    widgets.push({ decoratedText: { text: `<i>y ${filas.length - visibles.length} más</i>`, wrapText: true } })
  }
  return {
    cardsV2: [
      {
        cardId: `liberadas-${departamento.id}`,
        card: {
          header: { title: filas.length === 1 ? 'Ya podés hacerla' : 'Ya podés hacerlas', subtitle: departamento.nombre },
          sections: [
            { widgets },
            {
              widgets: [
                { textParagraph: { text: `${textoDelPrerequisito(prerequisito)}.` } },
                { buttonList: { buttons: [botonAbrir(urlApp, 'Abrir en la plataforma', '/')] } }
              ]
            }
          ]
        }
      }
    ]
  }
}

// Para el mensaje privado del responsable: la misma informacion, dicha a el.
export function cardLiberadasPrivada({ filas, prerequisito, hoyISO, urlApp }) {
  const visibles = filas.slice(0, MAX_TAREAS_POR_CARD)
  const origen = textoDelPrerequisito(prerequisito, { enMedio: true })
  const widgets = visibles.length === 1
    ? [
        {
          textParagraph: {
            text: `Ya podés hacer <b>${escaparHtml(visibles[0].nombre_tarea)} — ${escaparHtml(visibles[0].local)}</b> (${cuandoVence(visibles[0].fecha, hoyISO)}): ${origen}.`
          }
        },
        { buttonList: { buttons: [botonMarcarLiberada(visibles[0], 1), botonAbrir(urlApp, 'Ver mis tareas')] } }
      ]
    : [
        { textParagraph: { text: `Ya podés hacer estas tareas: ${origen}.` } },
        ...visibles.map((fila) => ({
          decoratedText: { text: textoDeLiberada(fila, hoyISO, { conResponsable: false }), wrapText: true, button: botonMarcarLiberada(fila, filas.length) }
        })),
        ...(filas.length > visibles.length ? [{ decoratedText: { text: `<i>y ${filas.length - visibles.length} más</i>`, wrapText: true } }] : []),
        { buttonList: { buttons: [botonAbrir(urlApp, 'Ver mis tareas')] } }
      ]
  return {
    cardsV2: [{ cardId: 'liberadas-privado', card: { sections: [{ widgets }] } }]
  }
}

// ── Resumen semanal de los lunes (ver lib/resumen-semanal.js) ────────────────
//
// Al Space de cada departamento: las atrasadas, con boton, y la semana dia por
// dia, sin botones (pedido del usuario: "solo las atrasadas"). Las tareas de
// la semana se agrupan por tarea: 31 P&L del mismo dia son UNA linea con los
// locales, no 31 filas.
//
// El boton lleva el departamento, igual que las liberadas: un Space puede
// estar vinculado a varios, y el receptor tiene que reconstruir ESTA tarjeta.
export const ORIGEN_SEMANAL = 'semanal'

const MAX_LINEAS_POR_DIA = 15

// "<b>P&L</b> › GRUPO TITA · gquinteros · ⏳ espera a Auditar".
export function lineasDelDia(eventos, nombreLocal, dependencias, grupoLocal) {
  return agruparDelDia(eventos, nombreLocal, dependencias, grupoLocal).map(({ titulo, prioridad, donde, personas, marcas }) => {
    const partes = [`${prefijoDe({ prioridad })}<b>${escaparHtml(titulo)}</b> › ${escaparHtml(donde)}`]
    if (personas.length) partes.push(escaparHtml(personas.map(nombreCorto).join(', ')))
    for (const marca of marcas) partes.push(escaparHtml(marca))
    return partes.join(' · ')
  })
}

function botonMarcarSemanal(evento, departamento) {
  return {
    text: 'Marcar hecha',
    onClick: accionEnEsteEndpoint(ACCION_MARCAR, [
      { key: 'instanceId', value: evento.id },
      { key: 'fecha', value: evento.start?.date || '' },
      { key: 'idDepartamento', value: departamento.id },
      { key: 'origen', value: ORIGEN_SEMANAL }
    ])
  }
}

function textoAtrasada({ evento, dias }, nombreLocal, dependencias) {
  const props = evento.extendedProperties?.private || {}
  const titulo = props.nombre_tarea || evento.summary || 'Tarea'
  const fecha = evento.start?.date
  const partes = [`${prefijoDe(props)}<b>${escaparHtml(titulo)} › ${escaparHtml(localDe(props, nombreLocal))}</b>`]
  if (fecha) partes.push(`del ${fechaCorta(fecha)}`)
  if (dias > 0) partes.push(`<font color="#c62828">hace ${dias === 1 ? '1 día hábil' : `${dias} días hábiles`}</font>`)
  if (props.asignado_a) partes.push(escaparHtml(nombreCorto(props.asignado_a)))
  const marca = marcaDependencia(evento, dependencias)
  if (marca) partes.push(escaparHtml(marca))
  return partes.join(' · ')
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`
}

// `datos` es lo que devuelve datosSemanaDepartamento.
export function cardSemanal(departamento, datos, nombreLocal, { hoyISO, urlApp, grupoLocal } = {}) {
  const { semana, vencidas, porDia, total, dependencias } = datos
  const secciones = []

  if (vencidas.length) {
    const visibles = vencidas.slice(0, MAX_TAREAS_POR_CARD)
    const widgets = visibles.map((v) => ({
      decoratedText: { text: textoAtrasada(v, nombreLocal, dependencias), wrapText: true, button: botonMarcarSemanal(v.evento, departamento) }
    }))
    if (vencidas.length > visibles.length) {
      widgets.push({
        decoratedText: { text: `<i>y ${vencidas.length - visibles.length} más</i>`, wrapText: true, button: botonAbrir(urlApp, 'Ver todas') }
      })
    }
    secciones.push({ header: `🚨 Atrasadas (${vencidas.length})`, collapsible: false, widgets })
  }

  for (const { fecha, eventos } of porDia) {
    const lineas = lineasDelDia(eventos, nombreLocal, dependencias, grupoLocal)
    const visibles = lineas.slice(0, MAX_LINEAS_POR_DIA)
    if (lineas.length > visibles.length) visibles.push(`<i>y ${lineas.length - visibles.length} más</i>`)
    secciones.push({
      header: `${tituloDia(fecha, hoyISO)} · ${plural(eventos.length, 'tarea', 'tareas')}`,
      collapsible: false,
      widgets: [{ textParagraph: { text: visibles.join('<br>') } }]
    })
  }

  if (!secciones.length) {
    secciones.push({ widgets: [{ textParagraph: { text: 'No hay tareas esta semana ni atrasadas. 👌' } }] })
  }
  secciones.push({ widgets: [{ buttonList: { buttons: [botonAbrir(urlApp, 'Abrir en la plataforma', '/')] } }] })

  const resumen = [plural(total, 'tarea esta semana', 'tareas esta semana')]
  if (vencidas.length) resumen.push(plural(vencidas.length, 'atrasada', 'atrasadas'))
  return {
    cardsV2: [
      {
        cardId: `semanal-${departamento.id}`,
        card: {
          header: {
            title: `Tu semana: ${rangoTexto(semana.desde, sumarDias(semana.desde, 4))}`,
            subtitle: `${departamento.nombre} · ${resumen.join(' · ')}`
          },
          sections: secciones
        }
      }
    ]
  }
}

// ── Resumen de los lunes para un Space combinado ─────────────────────────────
// Un Space de gente de varios equipos (ver vincularDepartamentos) recibe UNA
// tarjeta con todos sus departamentos, cada linea con la etiqueta de color del
// suyo (decision del usuario). `partes`: [{ departamento, datos }] en el orden
// del Space (el dueño primero); `info`: Map id -> { abreviatura, color }.
// Una tarea compartida entre dos de esos departamentos esta en los dos
// calendarios: va una sola vez, con la etiqueta del primero.
function chipDepto(departamento, info) {
  const i = info?.get(departamento.id)
  const abreviatura = escaparHtml(i?.abreviatura || departamento.nombre.slice(0, 3).toUpperCase())
  return i?.color ? `<font color="${i.color}"><b>${abreviatura}</b></font>` : `<b>${abreviatura}</b>`
}

export function cardSemanalCombinada(partes, nombreLocal, { hoyISO, urlApp, grupoLocal, info, space, sinLeer = [] } = {}) {
  const vistas = new Set()
  const unaVez = (evento) => {
    const props = evento.extendedProperties?.private || {}
    const clave = `${props.id_asignacion || evento.id}|${evento.start?.date || ''}`
    if (vistas.has(clave)) return false
    vistas.add(clave)
    return true
  }

  const vencidas = []
  const porFecha = new Map() // fecha -> [{ parte, eventos }]
  for (const parte of partes) {
    for (const v of parte.datos.vencidas) if (unaVez(v.evento)) vencidas.push({ ...v, parte })
    for (const { fecha, eventos } of parte.datos.porDia) {
      const propios = eventos.filter(unaVez)
      if (!propios.length) continue
      if (!porFecha.has(fecha)) porFecha.set(fecha, [])
      porFecha.get(fecha).push({ parte, eventos: propios })
    }
  }
  vencidas.sort((a, b) => b.dias - a.dias)

  const secciones = []
  if (vencidas.length) {
    const visibles = vencidas.slice(0, MAX_TAREAS_POR_CARD)
    const widgets = visibles.map((v) => ({
      decoratedText: {
        text: `${chipDepto(v.parte.departamento, info)} ${textoAtrasada(v, nombreLocal, v.parte.datos.dependencias)}`,
        wrapText: true,
        button: botonMarcarSemanal(v.evento, v.parte.departamento)
      }
    }))
    if (vencidas.length > visibles.length) {
      widgets.push({ decoratedText: { text: `<i>y ${vencidas.length - visibles.length} más</i>`, wrapText: true, button: botonAbrir(urlApp, 'Ver todas') } })
    }
    secciones.push({ header: `🚨 Atrasadas (${vencidas.length})`, collapsible: false, widgets })
  }

  let total = 0
  for (const fecha of [...porFecha.keys()].sort()) {
    const grupos = porFecha.get(fecha)
    const cantidad = grupos.reduce((n, g) => n + g.eventos.length, 0)
    total += cantidad
    const lineas = grupos.flatMap(({ parte, eventos }) =>
      lineasDelDia(eventos, nombreLocal, parte.datos.dependencias, grupoLocal).map((l) => `${chipDepto(parte.departamento, info)} ${l}`)
    )
    const visibles = lineas.slice(0, MAX_LINEAS_POR_DIA)
    if (lineas.length > visibles.length) visibles.push(`<i>y ${lineas.length - visibles.length} más</i>`)
    secciones.push({
      header: `${tituloDia(fecha, hoyISO)} · ${plural(cantidad, 'tarea', 'tareas')}`,
      collapsible: false,
      widgets: [{ textParagraph: { text: visibles.join('<br>') } }]
    })
  }

  if (!secciones.length) {
    secciones.push({ widgets: [{ textParagraph: { text: 'No hay tareas esta semana ni atrasadas. 👌' } }] })
  }
  if (sinLeer.length) {
    secciones.push({ widgets: [{ textParagraph: { text: `⚠️ <b>No pude leer la agenda de:</b> ${escaparHtml(sinLeer.join(', '))}. Faltan en esta tarjeta.` } }] })
  }
  secciones.push({ widgets: [{ buttonList: { buttons: [botonAbrir(urlApp, 'Abrir en la plataforma', '/')] } }] })

  const semana = partes[0]?.datos.semana
  const resumen = [plural(total, 'tarea esta semana', 'tareas esta semana')]
  if (vencidas.length) resumen.push(plural(vencidas.length, 'atrasada', 'atrasadas'))
  return {
    cardsV2: [
      {
        cardId: `semanal-space-${String(space || '').split('/').pop() || 'combinado'}`,
        card: {
          header: {
            title: semana ? `Tu semana: ${rangoTexto(semana.desde, sumarDias(semana.desde, 4))}` : 'Tu semana',
            subtitle: `${partes.map((p) => p.departamento.nombre).join(' + ')} · ${resumen.join(' · ')}`
          },
          sections: secciones
        }
      }
    ]
  }
}

function porcentaje({ hechas, total }) {
  return total ? Math.round((hechas / total) * 100) : null
}

// Para Direccion, sin botones: es un tablero, no una lista para trabajar.
//   filas:   [{ departamento, total, atrasadas, pasada: { hechas, total } }]
//   sinNada: nombres de los departamentos sin tareas ni atrasadas
//   ranking: [{ quien, atrasadas, masVieja }] (ver rankingPorResponsable)
export function cardResumenDireccion({ semana, filas, sinNada = [], sinLeer = [], sinCanal = [], ranking = [], pasadaTotal, urlApp }) {
  const pct = porcentaje(pasadaTotal || { hechas: 0, total: 0 })
  const subtitulo = [`${rangoTexto(semana.desde, sumarDias(semana.desde, 4))}`]
  if (pct !== null) subtitulo.push(`semana pasada: ${pct}% cumplido (${pasadaTotal.hechas} de ${pasadaTotal.total})`)
  // El % y el ranking se calculan con lo que SI se pudo leer: que no parezcan globales.
  if (sinLeer.length) subtitulo.push(`sin ${sinLeer.join(', ')}`)

  const widgetsDeptos = filas.map(({ departamento, total, atrasadas, pasada }) => {
    const partes = [`<b>${escaparHtml(departamento.nombre)}</b>`, plural(total, 'tarea esta semana', 'tareas esta semana')]
    partes.push(atrasadas ? `<font color="#c62828">${plural(atrasadas, 'atrasada', 'atrasadas')}</font>` : '0 atrasadas')
    const p = porcentaje(pasada)
    if (p !== null) partes.push(`semana pasada: ${p}%`)
    return { decoratedText: { text: partes.join(' · '), wrapText: true } }
  })
  if (!widgetsDeptos.length) widgetsDeptos.push({ textParagraph: { text: 'Ningún departamento tiene tareas esta semana.' } })
  if (sinNada.length) {
    widgetsDeptos.push({ textParagraph: { text: `<i>Sin tareas esta semana ni atrasadas: ${escaparHtml(sinNada.join(', '))}</i>` } })
  }

  // Un departamento que no se pudo leer NO es "sin tareas": se dice aparte,
  // o su ausencia se leeria como que no tiene nada.
  if (sinLeer.length) {
    widgetsDeptos.push({ textParagraph: { text: `⚠️ <b>No pude leer la agenda de:</b> ${escaparHtml(sinLeer.join(', '))}. Faltan en este resumen.` } })
  }

  // Con tareas esta semana pero sin ningun lugar donde recibir avisos.
  if (sinCanal.length) {
    widgetsDeptos.push({ textParagraph: { text: `📭 <b>Con tareas pero sin Space donde recibir avisos:</b> ${escaparHtml(sinCanal.join(', '))}. Se vinculan con <b>/vincular</b>.` } })
  }

  const secciones = [{ header: 'Por departamento', collapsible: false, widgets: widgetsDeptos }]

  if (ranking.length) {
    secciones.push({
      header: 'Atrasadas por responsable',
      collapsible: false,
      widgets: [
        {
          textParagraph: {
            text: ranking
              .map((r) => `<b>${escaparHtml(r.quien.includes('@') ? nombreCorto(r.quien) : r.quien)}</b> — ${plural(r.atrasadas, 'atrasada', 'atrasadas')}` +
                (r.masVieja > 0 ? ` · la más vieja: ${plural(r.masVieja, 'día hábil', 'días hábiles')}` : ''))
              .join('<br>')
          }
        }
      ]
    })
  }

  secciones.push({ widgets: [{ buttonList: { buttons: [botonAbrir(urlApp, 'Ver Reportes', '/reportes')] } }] })

  return {
    cardsV2: [
      {
        cardId: 'semanal-direccion',
        card: {
          header: { title: 'Resumen semanal por departamento', subtitle: subtitulo.join(' · ') },
          sections: secciones
        }
      }
    ]
  }
}
