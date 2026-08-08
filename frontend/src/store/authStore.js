import { create } from 'zustand'
import { api } from '../api/client.js'

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
    await api.post('/auth/dev-login', { email })
    await useAuthStore.getState().cargarSesion()
  },

  async logout() {
    await api.post('/auth/logout')
    set({ usuario: null, departamento: null, esAdminGlobal: false })
  }
}))
