import { api } from './client.js'

export const departamentosApi = {
  listar: () => api.get('/departamentos').then((r) => r.data),
  crear: (nombre) => api.post('/departamentos', { nombre }).then((r) => r.data)
}

export const localesApi = {
  listar: () => api.get('/locales').then((r) => r.data)
}

export const usuariosApi = {
  listar: (idDepartamento) => api.get('/usuarios', { params: { departamento: idDepartamento } }).then((r) => r.data)
}

export const tareasApi = {
  listar: (idDepartamento, incluirInactivas) =>
    api.get('/tareas', { params: { departamento: idDepartamento, incluirInactivas } }).then((r) => r.data),
  crear: (body) => api.post('/tareas', body).then((r) => r.data),
  editar: (id, body) => api.patch(`/tareas/${id}`, body).then((r) => r.data),
  eliminar: (id) => api.delete(`/tareas/${id}`).then((r) => r.data)
}

export const asignacionesApi = {
  listar: (params) => api.get('/asignaciones', { params }).then((r) => r.data),
  crear: (body) => api.post('/asignaciones', body).then((r) => r.data),
  definirAgenda: (id, body) => api.put(`/asignaciones/${id}/agenda`, body).then((r) => r.data)
}

export const instanciasApi = {
  hoy: () => api.get('/instancias/hoy').then((r) => r.data),
  mias: ({ desde, hasta, soloMias } = {}) =>
    api.get('/instancias/mias', { params: { desde, hasta, solo_mias: soloMias || undefined } }).then((r) => r.data),
  listarRango: ({ departamento, desde, hasta }) =>
    api.get('/instancias', { params: { departamento, desde, hasta } }).then((r) => r.data),
  marcar: (instanceId, idDepartamento) =>
    api.post(`/instancias/${instanceId}/marcar`, { departamento: idDepartamento }).then((r) => r.data)
}

export const reportesApi = {
  cumplimiento: (params) => api.get('/reportes/cumplimiento', { params }).then((r) => r.data)
}
