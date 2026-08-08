import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'

// La Admin SDK Directory API (Google Groups) exige domain-wide delegation
// impersonando un usuario real de Workspace -- a diferencia de Calendar, acá
// no alcanza con la impersonacion GCP normal (esa nunca actua "como" un
// usuario, solo como la propia service account). Por eso esta es la unica
// parte del backend que necesita la key propia del service account.
const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.group.member'
]

let directoryPromise
export function getDirectory() {
  directoryPromise ??= (async () => {
    const key = JSON.parse(readFileSync(process.env.GOOGLE_SA_KEY_PATH, 'utf8'))
    const auth = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: SCOPES,
      subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
    })
    return google.admin({ version: 'directory_v1', auth })
  })()
  return directoryPromise
}

export function emailDeGroup(slug) {
  return `depto-${slug}@${process.env.GOOGLE_WORKSPACE_DOMAIN}`
}
