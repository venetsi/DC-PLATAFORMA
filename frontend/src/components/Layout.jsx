import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'
import { usePermisos, NOMBRE_ROL } from '../lib/permisos.js'

export default function Layout() {
  const { usuario, departamento, departamentos, esDireccion, esAdminGlobal, logout } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { enAlguno } = usePermisos()
  const navRef = useRef(null)

  // En celular el menu es una sola fila que se desliza de costado: la pantalla
  // actual queda a la vista (si no, "Ayuda" o "Documentos" quedaban afuera).
  useEffect(() => {
    navRef.current?.querySelector('a.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

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
          <strong className="marca">
            <img src="/favicon.svg" alt="" aria-hidden="true" />
            DC-PLATAFORMA
          </strong>
          <nav className="cabecera-nav" ref={navRef}>
            <NavLink to="/" style={linkStyle} end>Mi agenda</NavLink>
            {departamento && <NavLink to="/mis-tareas" style={linkStyle}>Mis tareas</NavLink>}
            {/* Los reportes los ven MANAGER y OWNER (y Direccion). */}
            {enAlguno('reportes') && <NavLink to="/reportes" style={linkStyle}>Reportes</NavLink>}
            {(esAdminGlobal || departamento) && <NavLink to="/agendas" style={linkStyle}>Agendas</NavLink>}
            {esAdminGlobal && <NavLink to="/admin/repositorios" style={linkStyle}>Documentos</NavLink>}
            {/* Conecta una TV cualquiera que vea alguna agenda. */}
            {(esAdminGlobal || departamento) && <NavLink to="/pantallas" style={linkStyle}>Pantallas</NavLink>}
            <NavLink to="/ayuda" style={linkStyle}>Ayuda</NavLink>
          </nav>
        </div>
        <div className="cabecera-der">
          <span className="cabecera-usuario" title={[usuario?.email, ...departamentos.map((d) => `${d.nombre}: ${NOMBRE_ROL[d.rol] || 'Miembro'}`)].join('\n')}>
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
