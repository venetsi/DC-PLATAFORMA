import { create } from 'zustand'
import { api, guardarToken, borrarToken } from '../api/client.js'

export const useAuthStore = create((set) => ({
  usuario: null,
  departamento: null,
  // Todos los departamentos de la persona (con Groups puede estar en varios);
  // `departamento` es el principal, para las pantallas de uno solo.
  departamentos: [],
  esDireccion: false,
  esAdminGlobal: false,
  cargando: true,

  async cargarSesion() {
    try {
      const { data } = await api.get('/auth/me')
      set({
        usuario: data.usuario,
        departamento: data.departamento,
        departamentos: data.departamentos || (data.departamento ? [data.departamento] : []),
        esDireccion: !!data.esDireccion,
        esAdminGlobal: data.esAdminGlobal,
        cargando: false
      })
    } catch {
      set({ usuario: null, departamento: null, departamentos: [], esDireccion: false, esAdminGlobal: false, cargando: false })
    }
  },

  async loginDev(email) {
    const { data } = await api.post('/auth/dev-login', { email })
    guardarToken(data.token)
    await useAuthStore.getState().cargarSesion()
  },

  // Credencial de Google Identity Services (boton "Entrar con Google").
  async loginGoogle(credential) {
    const { data } = await api.post('/auth/google', { credential })
    guardarToken(data.token)
    await useAuthStore.getState().cargarSesion()
  },

  // Canjea el ticket SSO real de dcsmart -- ver pages/Sso.jsx.
  async loginSso(ticket) {
    const { data } = await api.post('/auth/sso', { ticket })
    guardarToken(data.token)
    await useAuthStore.getState().cargarSesion()
  },

  async logout() {
    await api.post('/auth/logout')
    borrarToken()
    set({ usuario: null, departamento: null, departamentos: [], esDireccion: false, esAdminGlobal: false })
  }
}))
