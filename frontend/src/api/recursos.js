import { api } from './client.js'

export const departamentosApi = {
  listar: () => api.get('/departamentos').then((r) => r.data)
}

export const localesApi = {
  listar: () => api.get('/locales').then((r) => r.data)
}

export const tareasApi = {
  listar: (idDepartamento) => api.get('/tareas', { params: { departamento: idDepartamento } }).then((r) => r.data),
  crear: (body) => api.post('/tareas', body).then((r) => r.data)
}

export const asignacionesApi = {
  listar: (params) => api.get('/asignaciones', { params }).then((r) => r.data),
  crear: (body) => api.post('/asignaciones', body).then((r) => r.data),
  definirAgenda: (id, body) => api.put(`/asignaciones/${id}/agenda`, body).then((r) => r.data)
}

export const instanciasApi = {
  hoy: () => api.get('/instancias/hoy').then((r) => r.data),
  marcar: (instanceId, idDepartamento) =>
    api.post(`/instancias/${instanceId}/marcar`, { departamento: idDepartamento }).then((r) => r.data)
}

export const reportesApi = {
  cumplimiento: (params) => api.get('/reportes/cumplimiento', { params }).then((r) => r.data)
}
