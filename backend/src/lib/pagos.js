// Lectura de Pagos/Proveedores/Rubros de dcsmart via BigQuery (dataset CDC,
// replicado por Datastream -- NUNCA la Postgres transaccional de dcsmart).
// Sin escritura: esto solo arma la lista para elegir en el dialogo de /pago.
// La unica escritura de esta funcionalidad es PagoSeguimiento, en la base
// propia de DC-PLATAFORMA (ver chat-comandos.js).
//
// Columnas confirmadas contra el codigo real de dcsmart-auditoria (el unico
// precedente de este ecosistema leyendo este mismo dataset) -- no adivinadas:
// raw_pagos (id, fecha_dia, importe, id_proveedor, id_rubcat, id_tipo, pv,
// nro, id_local), dim_proveedores (id, nombre), dim_rubcat (id, rubro,
// categoria -- ya resueltos a texto, no hace falta un segundo join a
// Rubro/Categoria).
const SELECT_PAGO = (dataset) => `
  SELECT
    p.id,
    p.id_local AS id_local_ext,
    p.fecha_dia,
    p.importe,
    CASE WHEN p.id_tipo IS NOT NULL AND p.pv IS NOT NULL AND p.nro IS NOT NULL
         THEN CONCAT(p.id_tipo, ' ', LPAD(CAST(p.pv AS STRING), 4, '0'), '-', LPAD(CAST(p.nro AS STRING), 8, '0'))
         ELSE NULL END AS comprobante,
    IFNULL(pr.nombre, '(sin proveedor)') AS proveedor,
    IFNULL(rc.rubro, '(sin rubro)') AS rubro,
    IFNULL(rc.categoria, '(sin categoría)') AS categoria
  FROM \`${dataset}.raw_pagos\` p
  LEFT JOIN \`${dataset}.dim_proveedores\` pr ON pr.id = p.id_proveedor
  LEFT JOIN \`${dataset}.dim_rubcat\`      rc ON rc.id = p.id_rubcat
`

// El cliente de BigQuery devuelve DATE/NUMERIC envueltos en objetos propios
// ({value: '2026-08-01'}, BigQueryInt, etc.), no en tipos JS planos -- se
// normaliza aca, en un solo lugar, para que chat-cards.js/chat-comandos.js no
// tengan que saber nada de BigQuery.
function normalizarFilaPago(r) {
  return {
    ...r,
    fecha_dia: r.fecha_dia?.value ?? r.fecha_dia ?? null,
    importe: r.importe != null ? Number(r.importe.value ?? r.importe) : null
  }
}

// Cuanto para atras mira el picker de /pago -- un mes de backlog alcanza para
// encontrar un pago reciente sin traer meses de historia a un dialogo que
// tiene que quedar corto.
const DIAS_PAGOS_RECIENTES = 30

function formatearFecha(d) {
  return d.toISOString().slice(0, 10)
}

// Pagos de un local en la ventana reciente, mas nuevos primero. `excluir` es
// el set de id_pago que YA tienen PagoSeguimiento -- se filtra en JS despues
// de traer de BigQuery, porque PagoSeguimiento vive en Postgres (otra base,
// no se puede hacer un JOIN cruzado en una sola query).
export async function pagosRecientesDeLocal(fastify, { idLocalExt, excluir = new Set(), limite = 20 }) {
  const desde = formatearFecha(new Date(Date.now() - DIAS_PAGOS_RECIENTES * 86400000))
  const query = `${SELECT_PAGO(fastify.bqDataset)}
    WHERE p.id_local = @idLocal AND p.fecha_dia >= @desde
    ORDER BY p.fecha_dia DESC
    LIMIT @limiteCrudo`
  // Se pide de mas (limite * 3) porque despues se filtran los ya vinculados
  // en JS -- sin este colchon, un local con varios pagos ya en seguimiento
  // podria devolver una lista mas corta de lo que el limite pedido sugiere.
  //
  // SIN `types` a proposito -- probado en produccion (2026-08-27): con
  // types explicitos ({idLocal:'STRING', desde:'DATE', ...}) la query corria
  // sin tirar error pero devolvia 0 filas SIEMPRE, para cualquier local, aun
  // con pagos reales en la ventana. Dejando que el cliente infiera el tipo
  // de cada param (un string JS comparado contra fecha_dia, que es DATE,
  // funciona igual por coercion implicita del lado de BigQuery) la misma
  // query trae los datos correctos. No se investigo la causa exacta del
  // mismatch en la libreria -- se dejo constancia empirica de que ASI
  // funciona y la otra forma falla en silencio.
  const [rows] = await fastify.bq.query({
    query,
    params: { idLocal: idLocalExt, desde, limiteCrudo: limite * 3 }
  })
  return rows.filter((r) => !excluir.has(r.id)).slice(0, limite).map(normalizarFilaPago)
}

// Un pago puntual por id -- se usa al confirmar el dialogo, para guardar un
// snapshot fresco en PagoSeguimiento en vez de confiar en datos que pudieron
// quedar viejos entre que se abrio el dialogo y se mando el formulario.
export async function pagoPorId(fastify, { idPago }) {
  const query = `${SELECT_PAGO(fastify.bqDataset)} WHERE p.id = @idPago LIMIT 1`
  // Sin `types` -- mismo motivo que en pagosRecientesDeLocal.
  const [rows] = await fastify.bq.query({
    query,
    params: { idPago }
  })
  return rows[0] ? normalizarFilaPago(rows[0]) : null
}

// $45.000,50 -- siempre dos decimales, para que una lista de montos quede
// alineada en vez de mezclar "45.000,5" con "12.300,25".
export function formatearMonto(importe) {
  if (importe == null) return null
  return `$${Number(importe).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
