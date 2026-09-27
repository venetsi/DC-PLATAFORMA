import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

export default function Layout() {
  const { usuario, departamento, departamentos, esDireccion, esAdminGlobal, logout } = useAuthStore()
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
      <header className="cabecera">
        <div className="cabecera-izq">
          <strong style={{ color: 'var(--gold)' }}>DC-PLATAFORMA</strong>
          <nav className="cabecera-nav">
            <NavLink to="/" style={linkStyle} end>Mi agenda</NavLink>
            {departamento && <NavLink to="/mis-tareas" style={linkStyle}>Mis tareas</NavLink>}
            <NavLink to="/reportes" style={linkStyle}>Reportes</NavLink>
            {(esAdminGlobal || departamento) && <NavLink to="/agendas" style={linkStyle}>Agendas</NavLink>}
            {esAdminGlobal && <NavLink to="/admin/repositorios" style={linkStyle}>Documentos</NavLink>}
          </nav>
        </div>
        <div className="cabecera-der">
          <span className="cabecera-usuario" title={usuario?.email}>
            {usuario?.email}
            {departamentos.length ? ` · ${departamentos.map((d) => d.nombre).join(', ')}` : ''}
            {esDireccion ? ' · ve todo' : ''}
          </span>
          <button className="btn btn-secondary" onClick={onLogout}>Salir</button>
        </div>
      </header>
      <main style={{ padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  )
}
