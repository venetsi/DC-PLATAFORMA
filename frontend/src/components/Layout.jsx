import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

export default function Layout() {
  const { usuario, departamento, esAdminGlobal, logout } = useAuthStore()
  const navigate = useNavigate()

  async function onLogout() {
    await logout()
    navigate('/login')
  }

  const linkStyle = ({ isActive }) => ({
    color: isActive ? 'var(--teal)' : 'var(--texto)',
    textDecoration: 'none',
    fontWeight: isActive ? 600 : 400
  })

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <strong style={{ color: 'var(--gold)' }}>DC-PLATAFORMA</strong>
          <nav style={{ display: 'flex', gap: '1rem' }}>
            <NavLink to="/" style={linkStyle} end>Mi agenda</NavLink>
            <NavLink to="/reportes" style={linkStyle}>Reportes</NavLink>
            {(esAdminGlobal || departamento) && <NavLink to="/admin/tareas" style={linkStyle}>Tareas</NavLink>}
            {(esAdminGlobal || departamento) && <NavLink to="/admin/agenda" style={linkStyle}>Definir agenda</NavLink>}
          </nav>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--texto-tenue)' }}>
          <span>{usuario?.email}{departamento ? ` · ${departamento.nombre}` : ''}</span>
          <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
        </div>
      </header>
      <main style={{ padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  )
}
