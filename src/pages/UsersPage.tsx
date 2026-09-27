import { useEffect, useState, type FC, type FormEvent } from 'react'
import {
  createUser, deleteUser, getSettings, listUsers, updateUser,
  type AppUser, type Permission, type Permissions, type SettingsStatus,
} from '../lib/api'

const KEYS: Array<{ id: Permission; label: string; help: string }> = [
  { id: 'claude', label: 'Claude', help: 'Build MVP sites' },
  { id: 'graph8', label: 'Graph8', help: 'Search & enrich leads' },
]

export const Toggle: FC<{ on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }> = ({ on, label, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    className={`toggle ${on ? 'on' : ''}`}
    disabled={disabled}
    onClick={() => onChange(!on)}
  >
    <span className="toggle-knob" />
  </button>
)

const UsersPage: FC = () => {
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [keys, setKeys] = useState<SettingsStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listUsers().then(r => setUsers(r.users)).catch(err => setError(err.message))
    getSettings().then(setKeys).catch(() => {})
  }, [])

  const replace = (u: AppUser) => setUsers(list => list?.map(x => (x.id === u.id ? u : x)) ?? null)
  const remove = (id: string) => setUsers(list => list?.filter(x => x.id !== id) ?? null)

  const active = users ?? []
  const missing = keys ? KEYS.filter(k => !keys[k.id].configured) : []

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Workspace</div>
          <h1 className="page-title">Users</h1>
          <div className="page-subtitle">
            Choose which of the workspace's API keys each person can use. Changes take effect on their next action.
          </div>
        </div>
      </header>

      {error && <div className="settings-alert">{error}</div>}

      <div className="settings-list">
        {missing.length > 0 && (
          <div className="settings-alert">
            {missing.map(k => k.label).join(' and ')} {missing.length > 1 ? 'keys are' : 'key is'} not set in Settings yet, so
            nobody can use {missing.length > 1 ? 'them' : 'it'} even when switched on.
          </div>
        )}

        <AddUser onCreated={u => setUsers(list => [...(list ?? []), u].sort((a, b) => a.username.localeCompare(b.username)))} />

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-card-label">Team</span>
            <span className="settings-badge">{active.length} {active.length === 1 ? 'user' : 'users'}</span>
          </div>
          <div className="user-list">
            <div className="user-row user-row-admin">
              <div className="user-ident">
                <div className="user-avatar">A</div>
                <div>
                  <div className="user-name">admin</div>
                  <div className="user-meta">Full access · signs in with ADMIN_PASSWORD</div>
                </div>
              </div>
              <span className="settings-badge ok">Admin</span>
            </div>
            {users && !active.length && <div className="settings-card-help user-empty">No users yet. Add one above, or people can sign up themselves.</div>}
            {active.map(u => <UserRow key={u.id} user={u} onChange={replace} onRemove={remove} />)}
          </div>
        </section>
      </div>
    </div>
  )
}

const AddUser: FC<{ onCreated: (u: AppUser) => void }> = ({ onCreated }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [perms, setPerms] = useState<Permissions>({ claude: false, graph8: true })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const { user } = await createUser(username.trim(), password, perms)
      onCreated(user)
      setMessage({ text: `Created ${user.username}. Share the password with them securely.`, ok: true })
      setUsername('')
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <form className="settings-card" onSubmit={submit} autoComplete="off">
      <div className="settings-card-head">
        <span className="settings-card-label">Add a user</span>
      </div>
      <div className="settings-card-row">
        <input
          className="input settings-input"
          placeholder="Username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <input
          className="input settings-input"
          type="password"
          autoComplete="new-password"
          placeholder="Temporary password (8+ characters)"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
      </div>
      <div className="user-perms">
        {KEYS.map(k => (
          <label key={k.id} className="user-perm">
            <Toggle on={perms[k.id]} label={`${k.label} access`} onChange={on => setPerms(p => ({ ...p, [k.id]: on }))} />
            <span><strong>{k.label}</strong> <span className="text-muted">{k.help}</span></span>
          </label>
        ))}
      </div>
      <div className="settings-card-row">
        <button className="btn-primary" type="submit" disabled={busy || !username.trim() || password.length < 8}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </div>
      {message && <div className={`settings-message ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
    </form>
  )
}

interface RowProps { user: AppUser; onChange: (u: AppUser) => void; onRemove: (id: string) => void }

function useRowActions({ user, onChange, onRemove }: RowProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      if (done) setMessage({ text: done, ok: true })
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const patch = (p: Parameters<typeof updateUser>[1], done?: string) =>
    run(async () => onChange((await updateUser(user.id, p)).user), done)

  const del = (what: string) => {
    if (!confirm(`${what} ${user.username}? This cannot be undone.`)) return
    run(async () => { await deleteUser(user.id); onRemove(user.id) })
  }

  return { busy, message, patch, del }
}

const Avatar: FC<{ name: string }> = ({ name }) => <div className="user-avatar">{name[0]?.toUpperCase()}</div>

const UserRow: FC<RowProps> = props => {
  const { user } = props
  const { busy, message, patch, del } = useRowActions(props)

  const resetPassword = () => {
    const pw = prompt(`New password for ${user.username} (8+ characters). They will be signed out.`)
    if (pw) patch({ password: pw }, 'Password changed. Share it with them securely.')
  }

  return (
    <div className={`user-row ${user.disabled ? 'is-disabled' : ''}`}>
      <div className="user-ident">
        <Avatar name={user.username} />
        <div>
          <div className="user-name">
            {user.username} {user.disabled && <span className="settings-badge">Disabled</span>}
          </div>
          <div className="user-meta">{user.selfSignup ? 'Signed up' : 'Added'} {new Date(user.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
      <div className="user-perms">
        {KEYS.map(k => (
          <label key={k.id} className="user-perm" title={k.help}>
            <Toggle
              on={user.permissions[k.id]}
              label={`${k.label} access for ${user.username}`}
              disabled={busy}
              onChange={on => patch({ permissions: { [k.id]: on } as Partial<Permissions> })}
            />
            <span>{k.label}</span>
          </label>
        ))}
      </div>
      <div className="user-actions">
        <button className="btn-secondary" disabled={busy} onClick={resetPassword}>Reset password</button>
        <button className="btn-secondary" disabled={busy} onClick={() => patch({ disabled: !user.disabled })}>
          {user.disabled ? 'Enable' : 'Disable'}
        </button>
        <button className="btn-secondary btn-danger" disabled={busy} onClick={() => del('Delete')}>Delete</button>
      </div>
      {message && <div className={`settings-message user-row-message ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
    </div>
  )
}

export default UsersPage
