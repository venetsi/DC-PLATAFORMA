import { api } from './client.js'

export const departamentosApi = {
  listar: () => api.get('/departamentos').then((r) => r.data),
  crear: (nombre) => api.post('/departamentos', { nombre }).then((r) => r.data),
  notificaciones: (id, body) => api.patch(`/departamentos/${id}/notificaciones`, body).then((r) => r.data)
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

export const dependenciasApi = {
  listar: (idAsignacion) => api.get('/dependencias', { params: { asignacion: idAsignacion } }).then((r) => r.data),
  crear: (body) => api.post('/dependencias', body).then((r) => r.data),
  borrar: (id) => api.delete(`/dependencias/${id}`).then((r) => r.data)
}

export const asignacionesApi = {
  listar: (params) => api.get('/asignaciones', { params }).then((r) => r.data),
  crear: (body) => api.post('/asignaciones', body).then((r) => r.data),
  definirAgenda: (id, body) => api.put(`/asignaciones/${id}/agenda`, body).then((r) => r.data),
  leerAgenda: (id) => api.get(`/asignaciones/${id}/agenda`).then((r) => r.data.agenda)
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

// Un Repositorio (entidad con nombre, ver schema.prisma) se asigna a cero o
// mas departamentos -- sin ninguno, es general y lo ve cualquier Space.
export const repositoriosApi = {
  listar: () => api.get('/repositorios').then((r) => r.data),
  crear: ({ nombre, tipo, driveFolder, idsDepartamentos }) =>
    api.post('/repositorios', { nombre, tipo, driveFolder, idsDepartamentos }).then((r) => r.data),
  actualizarDepartamentos: (id, idsDepartamentos) =>
    api.patch(`/repositorios/${id}/departamentos`, { idsDepartamentos }).then((r) => r.data),
  listarDocumentos: (id) => api.get(`/repositorios/${id}/documentos`).then((r) => r.data),
  subir: (id, archivo, { nombre } = {}) => {
    const form = new FormData()
    form.append('file', archivo)
    if (nombre) form.append('nombre', nombre)
    return api.post(`/repositorios/${id}/subir`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  agregarUrl: (id, url) => api.post(`/repositorios/${id}/url`, { url }).then((r) => r.data),
  sincronizar: (id) => api.post(`/repositorios/${id}/sincronizar`).then((r) => r.data),
  eliminarDocumento: (idDocumento) => api.delete(`/repositorios/documentos/${idDocumento}`).then((r) => r.data),
  eliminar: (id) => api.delete(`/repositorios/${id}`).then((r) => r.data)
}
