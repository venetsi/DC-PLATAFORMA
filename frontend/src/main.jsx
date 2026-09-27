import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// Direccion oficial: dc-plataforma.dcsmart.app. Las de Firebase siguen vivas
// (el boton Tareas de dcsmart todavia abre la .web.app): se pasa a la nueva
// conservando ruta y parametros -- el ?ticket= de /sso incluido --, asi la
// sesion (que vive en el localStorage de cada dominio) queda siempre en uno solo.
const DOMINIO_OFICIAL = 'dc-plataforma.dcsmart.app'
const DOMINIOS_VIEJOS = ['dc-plataforma.web.app', 'dc-plataforma.firebaseapp.com']

if (DOMINIOS_VIEJOS.includes(window.location.hostname)) {
  const { pathname, search, hash } = window.location
  window.location.replace(`https://${DOMINIO_OFICIAL}${pathname}${search}${hash}`)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  )
}
