// Saneado de texto para Google Chat. Vive aca (y no en routes/chat.js) para que
// lo usen tambien los caminos que postean o actualizan mensajes por la API REST
// (/buscar), no solo las respuestas del webhook.
//
// Chat rechaza el mensaje ENTERO ("invalidContent") si el texto trae algo con
// forma de etiqueta que no entiende, por ejemplo `<tarea>` o `<users/all>`: la
// guarda cambia esos angulos por corchetes. Se usan corchetes y no &lt; porque
// no esta confirmado que Chat interprete entidades HTML.
//
// Que se respeta:
//   - las etiquetas que Chat soporta: <b>, <i>, <u>, <s>, <font>, <a href>;
//   - los links con la sintaxis de Chat: <https://ejemplo.com|texto>;
//   - un `<` que NO abre una etiqueta (lo que sigue es un espacio, un digito o
//     un signo): "montos < 100 y > 50" se ve como lo escribio quien lo escribio.
// Que se neutraliza: todo lo demas que tenga forma de etiqueta, en particular las
// menciones `<users/all>` (mencion masiva) y `<users/123>` escritas por alguien
// o por el modelo: no deben llegar al Space como menciones reales.
const ETIQUETAS_QUE_CHAT_ACEPTA = /^\/?(b|i|u|s|font|a)(\s|$)/i
const LINK_DE_CHAT = /^(https?:\/\/|mailto:)[^\s|]+(\|[^<>]*)?$/i
// Un `<` seguido de espacio, digito o `=` es una comparacion, no una etiqueta.
const COMPARACION = /^[\s\d=]/

export function escaparPseudoEtiquetas(texto) {
  if (typeof texto !== 'string') return texto
  return texto.replace(/<([^<>]*)>/g, (completo, dentro) => {
    if (ETIQUETAS_QUE_CHAT_ACEPTA.test(dentro) || LINK_DE_CHAT.test(dentro)) return completo
    return COMPARACION.test(dentro) ? completo : `[${dentro}]`
  })
}
