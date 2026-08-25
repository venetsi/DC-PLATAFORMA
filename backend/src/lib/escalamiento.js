// Politica de escalamiento en dos niveles: a los N dias habiles de atraso la
// tarea se destaca en el aviso del departamento; a los M (mas) se le suma
// Direccion. Direccion SUMA, no reemplaza -- el item sigue apareciendo en el
// mensaje del departamento.
//
// Modulo puro y sin I/O, igual que vencimiento.js: lo importa el job
// standalone (que no levanta Fastify) y se puede probar sin base ni Calendar.
import { clasificarInstancia, diasHabilesVencida, hoyEnArgentina } from './vencimiento.js'

// Defaults si no hay ni columna en el departamento ni variable de entorno.
export const UMBRAL_DEPARTAMENTO = 2
export const UMBRAL_DIRECCION = 5

function aEntero(valor) {
  const n = Number.parseInt(valor, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Precedencia: columna del departamento -> variable de entorno -> default.
// Devuelve tambien `ajustado` para que el job pueda loguear una configuracion
// invalida en vez de tragarsela.
export function resolverUmbrales(departamento, env = process.env) {
  const departamentoUmbral =
    aEntero(departamento?.dias_aviso_departamento) ??
    aEntero(env.AVISO_DIAS_DEPARTAMENTO) ??
    UMBRAL_DEPARTAMENTO

  let direccion =
    aEntero(departamento?.dias_aviso_direccion) ??
    aEntero(env.AVISO_DIAS_DIRECCION) ??
    UMBRAL_DIRECCION

  // Con M <= N, TODO lo que se destaca en el departamento se escalaria tambien
  // a Direccion en el mismo instante, que es justo lo que el segundo nivel
  // tiene que evitar. Se clampea en vez de obedecer una config invalida.
  const ajustado = direccion <= departamentoUmbral
  if (ajustado) direccion = departamentoUmbral + 1

  return { departamento: departamentoUmbral, direccion, ajustado }
}

// Reparte las instancias de un departamento en los baldes del aviso.
//
// Cada item es { evento, dias } -- `dias` son habiles (lunes a viernes),
// porque con dias de calendario una tarea del viernes escalaria sola el lunes
// solo por haber pasado el fin de semana.
export function clasificarParaAviso(instancias, { umbrales, hoyISO = hoyEnArgentina(), referencia = new Date() } = {}) {
  const pendientesHoy = []
  const vencidas = []

  for (const evento of instancias) {
    const { hecha, vencida, fechaISO } = clasificarInstancia(evento, { referencia })
    if (hecha) continue
    if (vencida) {
      vencidas.push({ evento, dias: diasHabilesVencida(evento, { hoyISO }) })
    } else if (fechaISO === hoyISO) {
      pendientesHoy.push({ evento, dias: 0 })
    }
    // Lo pendiente a futuro no entra: el aviso es de hoy y de lo atrasado.
  }

  // Mas viejo primero: es el orden en que conviene leerlas.
  vencidas.sort((a, b) => b.dias - a.dias)

  return {
    pendientes_hoy: pendientesHoy,
    vencidas,
    escala_departamento: vencidas.filter((v) => v.dias >= umbrales.departamento),
    escala_direccion: vencidas.filter((v) => v.dias >= umbrales.direccion)
  }
}
