import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

// Destino real del botón "Tareas" del Sidebar de dcsmart (Fase 8) -- dcsmart
// abre esta URL en una pestaña nueva con ?ticket=<jwt corto>, esta pantalla
// lo canjea por una sesión propia y redirige. Pública, sin Layout: todavía
// no hay sesión cuando se llega acá.
export default function Sso() {
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const loginSso = useAuthStore((s) => s.loginSso)
  const navigate = useNavigate()

  useEffect(() => {
    const ticket = searchParams.get('ticket')
    if (!ticket) {
      setError('Falta el ticket de acceso -- volvé a hacer click en "Tareas" desde dcsmart.')
      return
    }
    loginSso(ticket)
      .then(() => navigate('/', { replace: true }))
      .catch((err) => setError(err.response?.data?.error || 'No se pudo iniciar sesión'))
    // Un ticket es de un solo uso y expira en 60s -- no reintentar en cambios
    // posteriores de searchParams/loginSso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 320, textAlign: 'center' }}>
        {error ? (
          <>
            <p style={{ color: 'var(--rojo)', fontSize: '0.9rem' }}>{error}</p>
            <a href="/login" style={{ color: 'var(--teal)' }}>Ir al login</a>
          </>
        ) : (
          <p style={{ color: 'var(--texto-tenue)' }}>Ingresando...</p>
        )}
      </div>
    </div>
  )
}
