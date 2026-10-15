import { api } from './client.js'

export const departamentosApi = {
  listar: () => api.get('/departamentos').then((r) => r.data),
  crear: (nombre) => api.post('/departamentos', { nombre }).then((r) => r.data),
  notificaciones: (id, body) => api.patch(`/departamentos/${id}/notificaciones`, body).then((r) => r.data),
  sincronizarGrupos: (forzar = false) => api.post('/departamentos/membresias/sincronizar', null, { params: { forzar } }).then((r) => r.data)
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
  eliminar: (id) => api.delete(`/tareas/${id}`).then((r) => r.data),
  duplicar: (id, body) => api.post(`/tareas/${id}/duplicar`, body).then((r) => r.data)
}

export const dependenciasApi = {
  listar: (idAsignacion) => api.get('/dependencias', { params: { asignacion: idAsignacion } }).then((r) => r.data),
  crear: (body) => api.post('/dependencias', body).then((r) => r.data),
  // Cada local de la tarea espera a la tarea prerrequisito DEL MISMO local.
  crearEnLote: (body) => api.post('/dependencias/lote', body).then((r) => r.data),
  borrar: (id) => api.delete(`/dependencias/${id}`).then((r) => r.data)
}

export const asignacionesApi = {
  listar: (params) => api.get('/asignaciones', { params }).then((r) => r.data),
  crear: (body) => api.post('/asignaciones', body).then((r) => r.data),
  definirAgenda: (id, body) => api.put(`/asignaciones/${id}/agenda`, body).then((r) => r.data),
  leerAgenda: (id) => api.get(`/asignaciones/${id}/agenda`).then((r) => r.data.agenda),
  // Agenda + datos de la asignacion (tarea, responsable, departamento dueño).
  leerAsignacion: (id) => api.get(`/asignaciones/${id}/agenda`).then((r) => r.data)
}

export const instanciasApi = {
  hoy: () => api.get('/instancias/hoy').then((r) => r.data),
  mias: ({ desde, hasta, soloMias } = {}) =>
    api.get('/instancias/mias', { params: { desde, hasta, solo_mias: soloMias || undefined } }).then((r) => r.data),
  // `conDependencias: false` salta la evaluacion de dependencias (lo mas lento
  // del listado: lee los calendarios de otros departamentos).
  listarRango: ({ departamento, desde, hasta, conDependencias = true }) =>
    api.get('/instancias', { params: { departamento, desde, hasta, ...(conDependencias ? {} : { con_dependencias: false }) } }).then((r) => r.data),
  marcar: (instanceId, idDepartamento) =>
    api.post(`/instancias/${instanceId}/marcar`, { departamento: idDepartamento }).then((r) => r.data),
  cadena: (instanceId, idDepartamento) =>
    api.get(`/instancias/${instanceId}/cadena`, { params: { departamento: idDepartamento } }).then((r) => r.data),
  noAplica: (instanceId, idDepartamento, motivo) =>
    api.post(`/instancias/${instanceId}/no-aplica`, { departamento: idDepartamento, motivo }).then((r) => r.data),
  reprogramar: (instanceId, idDepartamento, fecha, motivo) =>
    api.post(`/instancias/${instanceId}/fecha`, { departamento: idDepartamento, fecha, motivo }).then((r) => r.data)
}

export const reportesApi = {
  cumplimiento: (params) => api.get('/reportes/cumplimiento', { params }).then((r) => r.data),
  tablero: (params) => api.get('/reportes/tablero', { params }).then((r) => r.data)
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

// Pantallas de TV conectadas con QR (ver backend routes/pantallas.js y
// lib/tv-conexion.js). El codigo es el que muestra la TV ("BCD-FGH").
export const pantallasApi = {
  conexion: (codigo) => api.get(`/pantallas/conexion/${encodeURIComponent(codigo)}`).then((r) => r.data),
  aprobar: (codigo, body) => api.post(`/pantallas/conexion/${encodeURIComponent(codigo)}/aprobar`, body).then((r) => r.data),
  rechazar: (codigo) => api.post(`/pantallas/conexion/${encodeURIComponent(codigo)}/rechazar`).then((r) => r.data),
  departamentos: () => api.get('/pantallas/departamentos').then((r) => r.data.departamentos),
  listar: () => api.get('/pantallas').then((r) => r.data.pantallas),
  editar: (id, body) => api.patch(`/pantallas/${id}`, body).then((r) => r.data),
  desconectar: (id) => api.delete(`/pantallas/${id}`).then((r) => r.data)
}

// Pantalla Agendas (ver backend routes/agendas.js): todo el departamento en un
// pedido, crear una tarea completa en un paso, y cambios en lote por local.
export const agendasApi = {
  listar: ({ departamento, inactivas } = {}) =>
    api.get('/agendas', { params: { departamento: departamento || undefined, inactivas: inactivas || undefined } }).then((r) => r.data),
  crearTarea: (body) => api.post('/agendas/tareas', body).then((r) => r.data),
  agregarAlcance: (idTarea, body) => api.post(`/agendas/tareas/${idTarea}/alcance`, body).then((r) => r.data),
  cambiarAgenda: (body) => api.post('/agendas/asignaciones/agenda', body).then((r) => r.data),
  quitar: (ids) => api.post('/agendas/asignaciones/quitar', { ids }).then((r) => r.data)
}
