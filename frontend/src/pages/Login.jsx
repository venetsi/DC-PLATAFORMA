import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

// Login temporal de desarrollo (Fase 2-6). Se reemplaza por el canje del
// ticket SSO real de dcsmart en la Fase 7 -- ver /sso.
export default function Login() {
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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 320, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h2 style={{ margin: 0, color: 'var(--gold)' }}>DC-PLATAFORMA</h2>
        <p style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem', margin: 0 }}>
          Login temporal de desarrollo -- se reemplaza por el SSO real de dcsmart en la Fase 7.
        </p>
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
    </div>
  )
}
