// Cliente de BigQuery de solo lectura contra el dataset CDC de dcsmart
// (Datastream replica su Postgres ahi, ver docs/CONFIGURAR-CHAT-APP.md). Nunca
// se escribe: este cliente solo se usa para leer Pagos/Proveedores/Rubros al
// armar el dialogo de /pago -- la unica escritura de esa funcionalidad va a
// la base propia (PagoSeguimiento), nunca a dcsmart.
//
// Mismo patron que ya usa dcsmart-auditoria (su unico precedente en el
// ecosistema): `new BigQuery({ projectId })` sola, sin key -- toma
// Application Default Credentials, que en Cloud Run es la identidad propia
// del servicio (Workload Identity), igual que gcal-auth.js. Requiere que la
// service account (dc-plataforma-api@dc-smart-mvp.iam.gserviceaccount.com)
// tenga bigquery.dataViewer + bigquery.jobUser sobre el proyecto -- mismo par
// de roles que ya tiene la de dcsmart-auditoria, no un permiso nuevo a
// inventar.
import fp from 'fastify-plugin'
import { BigQuery } from '@google-cloud/bigquery'

const PROJECT = process.env.BQ_PROJECT || 'dc-smart-mvp'
const DATASET = process.env.BQ_DATASET_CDC || 'dcsmart_analytics_cdc'

async function bigqueryPlugin(fastify) {
  const bq = new BigQuery({ projectId: PROJECT })
  fastify.decorate('bq', bq)
  // Nombre completo `proyecto.dataset`, listo para interpolar en el FROM de
  // una query -- evita repetir el proyecto en cada archivo que arme SQL.
  fastify.decorate('bqDataset', `${PROJECT}.${DATASET}`)
}

export default fp(bigqueryPlugin)
