import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'

// Google Drive API para importar el contenido de una carpeta como
// repositorio de /buscar (ver lib/repositorios.js#sincronizarCarpetaDrive).
// Exige domain-wide delegation igual que Directory -- cliente SEPARADO a
// proposito (mismo motivo que directory-auth.js#getDirectoryUsuarios): si
// drive.readonly no estuviera autorizado todavia en la consola de admin,
// sumarlo al JWT de Groups/Directory rompería tambien esas llamadas, que ya
// funcionan. Con un cliente propio, lo unico que falla es esta feature.
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

let drivePromise
export function getDrive() {
  drivePromise ??= (async () => {
    const key = JSON.parse(readFileSync(process.env.GOOGLE_SA_KEY_PATH, 'utf8'))
    const auth = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: SCOPES,
      subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
    })
    return google.drive({ version: 'v3', auth })
  })()
  return drivePromise
}
