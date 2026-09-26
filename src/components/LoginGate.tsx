import { useEffect, useState, type FC, type FormEvent, type ReactNode } from 'react'
import { getSession, login, UNAUTHORIZED_EVENT, type SessionInfo } from '../lib/api'

const LoginGate: FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSession().then(setSession).catch(() => setError('Could not reach the server.'))
    const onUnauthorized = () => setSession(s => (s ? { ...s, authenticated: false } : s))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(password)
      setSession(s => (s ? { ...s, authenticated: true } : s))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  if (session?.authenticated) return <>{children}</>

  return (
    <div className="login-screen">
      <form className="login-card fade-in" onSubmit={submit}>
        <div className="sidebar-brand">
          <div className="sidebar-logo"><div className="sidebar-logo-dot" /></div>
          <div className="sidebar-name">Gapwise</div>
        </div>
        {session && !session.passwordConfigured ? (
          <div className="settings-alert">
            Set the <span className="mono">ADMIN_PASSWORD</span> environment variable on the server, then reload.
          </div>
        ) : (
          <>
            <label className="settings-card-label" htmlFor="gw-password">Password</label>
            <input
              id="gw-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy || !password || !session}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        )}
        {error && <div className="settings-message bad">{error}</div>}
      </form>
    </div>
  )
}

export default LoginGate
