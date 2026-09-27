import { createContext, useCallback, useContext, useEffect, useState, type FC, type FormEvent, type ReactNode } from 'react'
import { getSession, login, signUp, UNAUTHORIZED_EVENT, type SessionInfo, type SessionUser } from '../lib/api'
import AuditDemo from './AuditDemo'

const FULL_ACCESS: SessionUser = { username: 'admin', role: 'admin', permissions: { claude: true, graph8: true, gemini: true } }

interface SessionContextValue {
  user: SessionUser
  // Re-reads the session so permission changes made by the admin show up without signing in again.
  refresh: () => void
}

const SessionContext = createContext<SessionContextValue>({ user: FULL_ACCESS, refresh: () => {} })
export const useSession = () => useContext(SessionContext)

const LoginGate: FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    getSession().then(setSession).catch(() => {})
  }, [])

  useEffect(() => {
    getSession().then(setSession).catch(() => setError('Could not reach the server.'))
    const onUnauthorized = () => setSession(s => (s ? { ...s, authenticated: false, user: null } : s))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setError('')
    setNotice('')
    setPassword('')
    setConfirm('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    if (mode === 'signup' && password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const res = await login(username.trim(), password)
        setSession(s => (s ? { ...s, authenticated: true, user: res.user } : s))
      } else {
        const res = await signUp(username.trim(), password)
        setSession(s => (s ? { ...s, authenticated: true, user: res.user } : s))
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPassword('')
      setConfirm('')
      setBusy(false)
    }
  }

  if (session?.authenticated) {
    return (
      <SessionContext.Provider value={{ user: session.user ?? FULL_ACCESS, refresh }}>
        {children}
      </SessionContext.Provider>
    )
  }

  const signup = mode === 'signup'

  return (
    <div className="auth-split">
      <aside className="auth-showcase">
        <div className="sidebar-brand auth-brand">
          <div className="sidebar-logo"><div className="sidebar-logo-dot" /></div>
          <div className="sidebar-name">Gapwise</div>
        </div>

        <div className="auth-showcase-body">
          <h1 className="auth-headline">
            <span>Spot the gap.</span>
            <span>Ship the fix.</span>
            <span>Win the client.</span>
          </h1>
          <p className="auth-lede">
            Gapwise finds local businesses with weak websites, builds each one a working page, and sends it to the owner.
          </p>
        </div>

        <AuditDemo />
      </aside>

      <main className="auth-panel">
        <form className="auth-card fade-in" onSubmit={submit} key={mode}>
          <div className="sidebar-brand auth-brand-mobile">
            <div className="sidebar-logo"><div className="sidebar-logo-dot" /></div>
            <div className="sidebar-name">Gapwise</div>
          </div>

          {session && !session.passwordConfigured ? (
            <div className="settings-alert">
              Set the <span className="mono">ADMIN_PASSWORD</span> environment variable on the server, then reload.
            </div>
          ) : (
            <>
              <div className="auth-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={!signup} className={`auth-tab ${!signup ? 'active' : ''}`} onClick={() => switchMode('signin')}>
                  Sign in
                </button>
                <button type="button" role="tab" aria-selected={signup} className={`auth-tab ${signup ? 'active' : ''}`} onClick={() => switchMode('signup')}>
                  Sign up
                </button>
              </div>

              <div>
                <h2 className="auth-title">{signup ? 'Create your account' : 'Welcome back'}</h2>
                <p className="auth-sub">
                  {signup
                    ? 'Get started in seconds. The admin chooses which tools your account can use.'
                    : 'Sign in to continue to your workspace.'}
                </p>
              </div>

              <label className="auth-field">
                <span className="settings-card-label">Username</span>
                <input
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  placeholder={signup ? 'e.g. sara.k' : 'admin or your username'}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <span className="settings-card-label">Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  placeholder={signup ? 'At least 8 characters' : ''}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
              {signup && (
                <label className="auth-field">
                  <span className="settings-card-label">Confirm password</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                  />
                </label>
              )}

              <button
                className="btn-primary full-width"
                type="submit"
                disabled={busy || !session || !password || (signup && (!username.trim() || !confirm))}
              >
                {busy ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
              </button>

              {notice && <div className="settings-message ok">{notice}</div>}
              {error && <div className="settings-message bad">{error}</div>}

              <div className="auth-switch">
                {signup ? 'Already have an account?' : 'New here?'}{' '}
                <button type="button" className="auth-link" onClick={() => switchMode(signup ? 'signin' : 'signup')}>
                  {signup ? 'Sign in' : 'Create an account'}
                </button>
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  )
}

export default LoginGate
