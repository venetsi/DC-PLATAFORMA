import { getDirectory, getDirectoryUsuarios } from './directory-auth.js'

// Membresia de departamentos leida de los Google Groups depto-<slug>@, que son
// la fuente de verdad (se administran a mano en Workspace). Se copia en
// MembresiaDepartamento para no consultar Directory en cada pedido.
//
// Se lista cada grupo (members.list) en vez de preguntar "a que grupos
// pertenece X" (groups.list?userKey): esa variante solo sirve para cuentas del
// dominio, y hay miembros de dcmanagement.com.ar y venetsi.com.

const MINUTOS_FRESCURA = 15
let ultimaCorrida = 0
let enCurso = null

async function miembrosDe(directory, groupKey) {
  const miembros = []
  let pageToken
  do {
    const { data } = await directory.members.list({ groupKey, maxResults: 200, pageToken })
    miembros.push(...(data.members || []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return miembros
}

async function nombreDe(email, dominio) {
  if (!email.endsWith(`@${dominio}`)) return email.split('@')[0]
  try {
    const directory = await getDirectoryUsuarios()
    const { data } = await directory.users.get({ userKey: email, fields: 'name' })
    return data.name?.fullName || email.split('@')[0]
  } catch {
    return email.split('@')[0]
  }
}

// { departamentos: [{ slug, antes, ahora, aplicado, error }], personasNuevas }
// `forzar` aplica aunque un grupo haya perdido mas de la mitad de sus miembros.
export async function sincronizarMembresias(deps, { forzar = false } = {}) {
  const { db, log = console } = deps
  const directory = await getDirectory()
  const dominio = process.env.GOOGLE_WORKSPACE_DOMAIN
  const departamentos = await db.departamento.findMany({ where: { activo: true, email_group_google: { not: null } } })
  const resultado = { departamentos: [], personasNuevas: 0 }
  const vistos = new Map() // email -> id_departamento (el primero, para el campo heredado)

  for (const depto of departamentos) {
    const antes = await db.membresiaDepartamento.count({ where: { id_departamento: depto.id } })
    let miembros
    try {
      miembros = await miembrosDe(directory, depto.email_group_google)
    } catch (err) {
      // Nunca se interpreta un error como "cero miembros": se conserva lo anterior.
      const error = `${err.code || ''} ${err.message}`.trim().slice(0, 300)
      await db.departamento.update({ where: { id: depto.id }, data: { membresia_sync_error: error } })
      resultado.departamentos.push({ slug: depto.slug, antes, ahora: null, aplicado: false, error })
      log.warn?.({ slug: depto.slug, err: error }, 'membresias: no se pudo leer el grupo')
      continue
    }

    const personas = miembros
      .filter((m) => m.type === 'USER' && m.status !== 'SUSPENDED' && m.email)
      .map((m) => ({ email: m.email.toLowerCase(), rol_group: m.role || 'MEMBER' }))
    const descartados = miembros.filter((m) => m.type !== 'USER')
    if (descartados.length) log.warn?.({ slug: depto.slug, tipos: descartados.map((m) => m.type) }, 'membresias: miembros que no son personas, ignorados')

    // Freno: un grupo que se vacia o pierde mas de la mitad de golpe suele ser un
    // error de carga, no una decision. Se aplica recien con `forzar`.
    if (!forzar && antes > 0 && personas.length < antes / 2) {
      const error = `freno: el grupo paso de ${antes} a ${personas.length} miembros; no se aplico`
      await db.departamento.update({ where: { id: depto.id }, data: { membresia_sync_error: error } })
      resultado.departamentos.push({ slug: depto.slug, antes, ahora: personas.length, aplicado: false, error })
      continue
    }

    await db.$transaction([
      db.membresiaDepartamento.deleteMany({ where: { id_departamento: depto.id } }),
      db.membresiaDepartamento.createMany({ data: personas.map((p) => ({ ...p, id_departamento: depto.id })) }),
      db.departamento.update({ where: { id: depto.id }, data: { membresia_sync_ok_at: new Date(), membresia_sync_error: null } })
    ])
    resultado.departamentos.push({ slug: depto.slug, antes, ahora: personas.length, aplicado: true })
    for (const p of personas) if (!vistos.has(p.email)) vistos.set(p.email, depto.id)
  }

  // Quien esta en un grupo y nunca entro a la plataforma igual tiene que poder
  // usar Chat y aparecer como responsable: se le crea el usuario. Solo con
  // Groups ya como fuente de verdad -- en la etapa en paralelo no tiene efecto.
  if (process.env.MEMBRESIA_FUENTE !== 'groups') {
    ultimaCorrida = Date.now()
    return resultado
  }
  const existentes = new Set((await db.extUser.findMany({ select: { email: true } })).map((u) => u.email.toLowerCase()))
  for (const [email, idDepartamento] of vistos) {
    if (existentes.has(email)) continue
    await db.extUser.create({
      data: { id: email, email, nombre: await nombreDe(email, dominio), id_departamento: idDepartamento, activo: true }
    })
    resultado.personasNuevas++
  }

  ultimaCorrida = Date.now()
  return resultado
}

// Dispara una sincronizacion en segundo plano si la ultima tiene mas de 15
// minutos. No bloquea a quien la llama; si ya hay una corriendo, no lanza otra.
export function asegurarMembresiasFrescas(deps) {
  if (enCurso || Date.now() - ultimaCorrida < MINUTOS_FRESCURA * 60 * 1000) return
  enCurso = sincronizarMembresias(deps)
    .catch((err) => deps.log?.error?.({ err: err.message }, 'membresias: sincronizacion fallo'))
    .finally(() => { enCurso = null })
}
