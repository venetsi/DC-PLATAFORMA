import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuthStore } from './store/authStore.js'
import { ProtectedRoute, GestionRoute } from './components/ProtectedRoute.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Sso from './pages/Sso.jsx'
import Calendario from './pages/Calendario.jsx'
import MisTareas from './pages/MisTareas.jsx'
import Reportes from './pages/Reportes.jsx'
import AdminTareas from './pages/admin/AdminTareas.jsx'

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
          <Route element={<GestionRoute />}>
            <Route path="/admin/tareas" element={<AdminTareas />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
