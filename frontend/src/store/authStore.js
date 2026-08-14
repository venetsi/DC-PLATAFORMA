import { create } from 'zustand'
import { api, guardarToken, borrarToken } from '../api/client.js'

export const useAuthStore = create((set) => ({
  usuario: null,
  departamento: null,
  esAdminGlobal: false,
  cargando: true,

  async cargarSesion() {
    try {
      const { data } = await api.get('/auth/me')
      set({ usuario: data.usuario, departamento: data.departamento, esAdminGlobal: data.esAdminGlobal, cargando: false })
    } catch {
      set({ usuario: null, departamento: null, esAdminGlobal: false, cargando: false })
    }
  },

  async loginDev(email) {
    const { data } = await api.post('/auth/dev-login', { email })
    guardarToken(data.token)
    await useAuthStore.getState().cargarSesion()
  },

  async logout() {
    await api.post('/auth/logout')
    borrarToken()
    set({ usuario: null, departamento: null, esAdminGlobal: false })
  }
}))
