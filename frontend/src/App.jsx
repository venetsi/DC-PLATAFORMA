import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore.js'
import { ProtectedRoute, GestionRoute, AdminRoute } from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Sso from './pages/Sso.jsx'
import Calendario from './pages/Calendario.jsx'
import MisTareas from './pages/MisTareas.jsx'
import Reportes from './pages/Reportes.jsx'
import Agendas from './pages/Agendas.jsx'
import Ayuda from './pages/Ayuda.jsx'
import AdminRepositorios from './pages/admin/AdminRepositorios.jsx'
import Pantallas from './pages/Pantallas.jsx'

// /tv es la direccion corta que muestra la TV (y la que lleva el QR): pasa a
// Pantallas conservando ?codigo=.
function IrAPantallas() {
  const { search } = useLocation()
  return <Navigate to={`/pantallas${search}`} replace />
}

export default function App() {
  const cargarSesion = useAuthStore((s) => s.cargarSesion)
  useEffect(() => { cargarSesion() }, [cargarSesion])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sso" element={<Sso />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Calendario />} />
          <Route path="/mis-tareas" element={<MisTareas />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/ayuda" element={<Ayuda />} />
          <Route path="/pantallas" element={<Pantallas />} />
          <Route path="/tv" element={<IrAPantallas />} />
          <Route element={<GestionRoute />}>
            <Route path="/agendas" element={<Agendas />} />
            {/* La vieja pantalla de catalogo: la reemplaza Agendas. */}
            <Route path="/admin/tareas" element={<Navigate to="/agendas" replace />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin/repositorios" element={<AdminRepositorios />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
