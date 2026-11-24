import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'
import { usePermisos, NOMBRE_ROL } from '../lib/permisos.js'

// Armado de gestion 2.0: menu lateral (logo, secciones, usuario abajo) y el
// contenido a la derecha. En celular el menu se abre desde la barra de arriba.
// Mismas clases y medidas que dcsmart2/apps/gestion (Sidebar.jsx + app.css).

const ICONOS = {
  agenda: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  mias: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  agendas: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  reportes: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
  pantallas: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  documentos: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  ayuda: <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>,
  salir: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />
}

function Icono({ nombre }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONOS[nombre]}
    </svg>
  )
}

function Item({ to, icono, children, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <Icono nombre={icono} />
      <span>{children}</span>
    </NavLink>
  )
}

function iniciales(texto) {
  const partes = String(texto || '').split(/[\s@.]+/).filter(Boolean)
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase() || '·'
}

export default function Layout() {
  const { usuario, departamento, departamentos, esDireccion, esAdminGlobal, logout } = useAuthStore()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { enAlguno } = usePermisos()
  const [menuAbierto, setMenuAbierto] = useState(false)

  // En celular el menu se cierra solo al cambiar de pantalla.
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  async function onLogout() {
    await logout()
    navigate('/login')
  }

  const nombre = usuario?.nombre || usuario?.email || ''
  const detalle = esDireccion ? 'Dirección · ve todo' : departamentos.map((d) => d.nombre).join(', ')

  return (
    <div className="app-layout">
      <div className="barra-celular">
        <button type="button" className="barra-celular-menu" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú">
          <Icono nombre="menu" />
        </button>
        <img src="/logo-tareas.png" alt="DCSMART Tareas" className="barra-celular-logo" />
      </div>
      <div className={`lateral-fondo${menuAbierto ? ' abierto' : ''}`} onClick={() => setMenuAbierto(false)} aria-hidden="true" />

      <aside className={`lateral${menuAbierto ? ' abierto' : ''}`}>
        <div className="lateral-marca">
          <img src="/logo-tareas.png" alt="DCSMART Tareas" />
        </div>
        <nav className="lateral-nav" aria-label="Secciones">
          <Item to="/" icono="agenda" end>Mi agenda</Item>
          {departamento && <Item to="/mis-tareas" icono="mias">Mis tareas</Item>}
          {(esAdminGlobal || departamento) && <Item to="/agendas" icono="agendas">Agendas</Item>}
          {/* Los reportes los ven MANAGER y OWNER (y Direccion). */}
          {enAlguno('reportes') && <Item to="/reportes" icono="reportes">Reportes</Item>}
          {/* Conecta una TV cualquiera que vea alguna agenda. */}
          {(esAdminGlobal || departamento) && <Item to="/pantallas" icono="pantallas">Pantallas</Item>}
          {esAdminGlobal && (
            <>
              <div className="nav-seccion">Admin</div>
              <Item to="/admin/repositorios" icono="documentos">Documentos</Item>
            </>
          )}
          <Item to="/ayuda" icono="ayuda">Ayuda</Item>
        </nav>
        <div className="lateral-usuario" title={[usuario?.email, ...departamentos.map((d) => `${d.nombre}: ${NOMBRE_ROL[d.rol] || 'Miembro'}`)].join('\n')}>
          <div className="lateral-avatar">{iniciales(nombre)}</div>
          <div className="lateral-usuario-datos">
            <b>{nombre}</b>
            {detalle && <span>{detalle}</span>}
          </div>
          <button type="button" className="lateral-salir" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icono nombre="salir" />
          </button>
        </div>
      </aside>

      <main className="contenido">
        <Outlet />
      </main>
    </div>
  )
}
