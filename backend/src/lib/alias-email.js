import { getDirectory } from './directory-auth.js'

// Email principal de Google para un email que puede ser un ALIAS.
//
// En Workspace se renombraron cuentas (p.ej. reportes@dcsmart.app pasó a ser
// jbardinella@dcsmart.app y el viejo quedó como alias), pero dcsmart sigue
// mandando el email viejo en el ticket de /sso. Como los grupos depto-* listan
// el email principal, sin esta traduccion esas personas quedaban "sin grupo".
//
// Se resuelve con la API de grupos (members.get acepta un alias como
// memberKey y devuelve al miembro con su email principal): el permiso
// admin.directory.user.readonly, que seria lo directo, no esta delegado.
// Por eso solo se resuelve a quien este en algun grupo depto-* -- justo los
// unicos que importan, porque el resto no puede entrar igual.
const HORAS_CACHE = 6
const cache = new Map() // email -> { canonico, vence }

export async function emailCanonico(deps, emailRaw) {
  const { db, log = console } = deps
  const email = String(emailRaw || '').toLowerCase().trim()
  if (!email) return email

  // Camino rapido (el de casi todos): ya es el email de un miembro.
  if (await db.membresiaDepartamento.findFirst({ where: { email }, select: { email: true } })) return email

  const enCache = cache.get(email)
  if (enCache && enCache.vence > Date.now()) return enCache.canonico

  let canonico = email
  try {
    const directory = await getDirectory()
    const grupos = await db.departamento.findMany({ where: { activo: true, email_group_google: { not: null } }, select: { email_group_google: true } })
    // Todos los grupos en paralelo: en serie eran hasta ~6 s la primera vez.
    const respuestas = await Promise.all(grupos.map(({ email_group_google: groupKey }) =>
      directory.members.get({ groupKey, memberKey: email })
        .then(({ data }) => String(data?.email || '').toLowerCase())
        .catch((err) => {
          if (err.code === 404 || err.code === 400) return ''
          throw err
        })
    ))
    canonico = respuestas.find((p) => p && p !== email) || email
  } catch (err) {
    // Si Directory falla, se sigue con el email tal cual: nunca bloquea por esto.
    log.warn?.({ err: err.message, email }, 'alias: no se pudo resolver el email principal')
    return email
  }
  if (canonico !== email) log.info?.({ alias: email, principal: canonico }, 'alias: email viejo traducido al principal')
  cache.set(email, { canonico, vence: Date.now() + HORAS_CACHE * 3600 * 1000 })
  return canonico
}
