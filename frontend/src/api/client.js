import axios from 'axios'

// El token tambien viaja como cookie httpOnly (funciona en local), pero en
// produccion el rewrite de Firebase Hosting hacia Cloud Run no reenvia el
// header Cookie de la request (confirmado: Authorization si pasa, Cookie
// no) -- por eso ademas se guarda el token de la respuesta y se manda como
// Bearer en cada pedido, que es lo que realmente sostiene la sesion ahi.
const STORAGE_KEY = 'dc_plataforma_token'

export function guardarToken(token) {
  localStorage.setItem(STORAGE_KEY, token)
}
export function borrarToken() {
  localStorage.removeItem(STORAGE_KEY)
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3100/api',
  withCredentials: true
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
