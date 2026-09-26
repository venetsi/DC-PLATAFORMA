import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

// En producción la única entrada es el botón "Tareas" de dcsmart (ver /sso).
// El formulario por email solo se muestra en `vite dev`, contra un backend
// local con ALLOW_DEV_LOGIN=true.
export default function Login() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: 340, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, color: 'var(--gold)' }}>DC-PLATAFORMA</h2>
        <p style={{ margin: 0 }}>
          Para entrar, abrí dcsmart y hacé click en <strong>Tareas</strong> en el menú lateral.
        </p>
        <p style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem', margin: 0 }}>
          Si no ves esa opción en dcsmart, pedile acceso a un administrador.
        </p>
        {import.meta.env.DEV && <LoginDev />}
      </div>
    </div>
  )
}

function LoginDev() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const loginDev = useAuthStore((s) => s.loginDev)
  const navigate = useNavigate()

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await loginDev(email)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar sesion')
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--texto-tenue)', paddingTop: '0.75rem' }}>
      <span style={{ color: 'var(--texto-tenue)', fontSize: '0.75rem' }}>Solo desarrollo local</span>
      <input
        type="email"
        placeholder="tuemail@dcsmart.app"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--texto-tenue)', background: 'var(--bg-0)', color: 'var(--texto)' }}
      />
      {error && <div style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{error}</div>}
      <button type="submit" className="btn">Entrar</button>
    </form>
  )
}
