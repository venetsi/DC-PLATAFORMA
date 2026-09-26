import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

export function ProtectedRoute() {
  const { usuario, cargando } = useAuthStore()
  const location = useLocation()
  if (cargando) return <p style={{ padding: '2rem' }}>Cargando...</p>
  // Se conserva el destino (p.ej. el link "Ver todas" de Chat a /mis-tareas).
  if (!usuario) return <Navigate to={`/login?volver=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

export function AdminRoute() {
  const { esAdminGlobal, cargando } = useAuthStore()
  if (cargando) return <p style={{ padding: '2rem' }}>Cargando...</p>
  if (!esAdminGlobal) return <Navigate to="/" replace />
  return <Outlet />
}

// Catalogo de tareas y definicion de agenda ya no son solo-admin: un
// usuario de departamento puede crear/editar (no borrar) las suyas, ver
// tareas.js#puedeGestionarDepartamento. El backend es quien de verdad
// acota por departamento -- esto solo tapa la puerta a quien no tiene
// ninguno de los dos (sin departamento y sin ser admin).
export function GestionRoute() {
  const { esAdminGlobal, departamento, cargando } = useAuthStore()
  if (cargando) return <p style={{ padding: '2rem' }}>Cargando...</p>
  if (!esAdminGlobal && !departamento) return <Navigate to="/" replace />
  return <Outlet />
}
