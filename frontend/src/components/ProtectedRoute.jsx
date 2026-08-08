import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

export function ProtectedRoute() {
  const { usuario, cargando } = useAuthStore()
  if (cargando) return <p style={{ padding: '2rem' }}>Cargando...</p>
  if (!usuario) return <Navigate to="/login" replace />
  return <Outlet />
}

export function AdminRoute() {
  const { esAdminGlobal, cargando } = useAuthStore()
  if (cargando) return <p style={{ padding: '2rem' }}>Cargando...</p>
  if (!esAdminGlobal) return <Navigate to="/" replace />
  return <Outlet />
}
