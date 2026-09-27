import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'
import { STORAGE_KEY } from '../api/client.js'
import { destinoSeguro, guardarDestino, tomarDestino } from '../lib/destino.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const DCSMART_URL = import.meta.env.VITE_DCSMART_URL || 'https://gestion.dcsmart.app'

// Entradas: "Entrar con Google" (la principal, todos usan Workspace) y el boton
// "Tareas" de dcsmart (ver /sso). El formulario por email solo en `vite dev`.
export default function Login() {
  const [searchParams] = useSearchParams()
  const volver = destinoSeguro(searchParams.get('volver'))
  const [error, setError] = useState('')
  const loginGoogle = useAuthStore((s) => s.loginGoogle)
  const cargarSesion = useAuthStore((s) => s.cargarSesion)
  const usuario = useAuthStore((s) => s.usuario)
  const navigate = useNavigate()
  const botonRef = useRef(null)
  const conectandoTv = /^\/(tv|pantallas)(\?|$)/.test(volver)

  // Si se entra por dcsmart -> Tareas (otra pestaña, /sso), el destino tiene
  // que sobrevivir: se guarda para que /sso lo retome.
  useEffect(() => { guardarDestino(volver) }, [volver])

  // Ya hay sesion (o aparece desde otra pestaña, la de /sso): seguir solo.
  // Aca NO se consume el destino guardado: lo usa la pestaña de /sso, que es
  // la que la persona tiene adelante (si esta lo borrara primero, aquella
  // caeria en el inicio).
  useEffect(() => {
    if (usuario) navigate(volver, { replace: true })
  }, [usuario, navigate, volver])
  useEffect(() => {
    const alCambiar = (e) => { if (e.key === STORAGE_KEY && e.newValue) cargarSesion() }
    window.addEventListener('storage', alCambiar)
    return () => window.removeEventListener('storage', alCambiar)
  }, [cargarSesion])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    const iniciar = () => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError('')
          try {
            await loginGoogle(credential)
            tomarDestino() // se entro en esta pestaña: el guardado ya no hace falta
            navigate(volver, { replace: true })
          } catch (err) {
            setError(err.response?.data?.error || 'No se pudo entrar con Google')
          }
        }
      })
      window.google.accounts.id.renderButton(botonRef.current, { theme: 'filled_black', size: 'large', text: 'signin_with', locale: 'es', width: 280 })
    }
    if (window.google?.accounts?.id) return iniciar()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = iniciar
    document.head.appendChild(script)
  }, [loginGoogle, navigate, volver])

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="card" style={{ width: 340, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <h2 style={{ margin: 0, color: 'var(--gold)' }}>DC-PLATAFORMA</h2>
        {conectandoTv && !GOOGLE_CLIENT_ID && (
          <>
            <p style={{ margin: 0 }}>
              Para conectar la pantalla, entrá con tu usuario: abrí dcsmart y tocá <strong>Tareas</strong> en el menú.
              Después volvés acá solo.
            </p>
            <a className="btn" href={DCSMART_URL} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none' }}>Abrir dcsmart</a>
          </>
        )}
        {GOOGLE_CLIENT_ID && (
          <>
            <p style={{ margin: 0 }}>Entrá con tu cuenta de Google de trabajo.</p>
            <div ref={botonRef} />
            {error && <div style={{ color: 'var(--rojo)', fontSize: '0.85rem' }}>{error}</div>}
          </>
        )}
        {!(conectandoTv && !GOOGLE_CLIENT_ID) && (
          <p style={{ margin: 0, color: GOOGLE_CLIENT_ID ? 'var(--texto-tenue)' : 'var(--texto)', fontSize: GOOGLE_CLIENT_ID ? '0.85rem' : '1rem' }}>
            {GOOGLE_CLIENT_ID ? 'También podés entrar' : 'Para entrar,'} desde dcsmart con el botón <strong>Tareas</strong> del menú lateral.
          </p>
        )}
        {!GOOGLE_CLIENT_ID && (
          <p style={{ color: 'var(--texto-tenue)', fontSize: '0.85rem', margin: 0 }}>
            Si no ves esa opción en dcsmart, pedile acceso a un administrador.
          </p>
        )}
        {import.meta.env.DEV && <LoginDev volver={volver} />}
      </div>
    </div>
  )
}

function LoginDev({ volver }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const loginDev = useAuthStore((s) => s.loginDev)
  const navigate = useNavigate()

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await loginDev(email)
      tomarDestino() // se entro en esta pestaña: el guardado ya no hace falta
      navigate(volver)
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
