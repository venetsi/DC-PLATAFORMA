import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuthStore } from './store/authStore.js'
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Calendario from './pages/Calendario.jsx'
import Reportes from './pages/Reportes.jsx'
import AdminTareas from './pages/admin/AdminTareas.jsx'
import AdminAgenda from './pages/admin/AdminAgenda.jsx'

export default function App() {
  const cargarSesion = useAuthStore((s) => s.cargarSesion)
  useEffect(() => { cargarSesion() }, [cargarSesion])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Calendario />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/tareas" element={<AdminTareas />} />
            <Route path="/admin/agenda" element={<AdminAgenda />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
