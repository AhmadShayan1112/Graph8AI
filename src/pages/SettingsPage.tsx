import { useEffect, useState, type FC, type FormEvent } from 'react'
import { deleteSecret, getSettings, saveSecret, testGeminiKey, type SecretKind, type SettingsStatus } from '../lib/api'

const FIELDS: Array<{ kind: SecretKind; label: string; help: string; placeholder: string }> = [
  {
    kind: 'claude',
    label: 'Claude Code OAuth token',
    help: 'Used to build lead MVPs. Create one with `claude setup-token`.',
    placeholder: 'sk-ant-oat01-…',
  },
  {
    kind: 'graph8',
    label: 'Graph8 API key',
    help: 'Used to discover and enrich leads.',
    placeholder: 'Paste your Graph8 API key',
  },
  {
    kind: 'gemini',
    label: 'Gemini API key',
    help: 'Powers gap analysis (web research on each lead). Create one in Google AI Studio. Users only ever see “gap analysis”, never the provider.',
    placeholder: 'AIza…',
  },
]

const SettingsPage: FC = () => {
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    getSettings().then(setStatus).catch(err => setLoadError(err.message))
  }, [])

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Workspace</div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">
            Keys are encrypted (AES-256-GCM) before they reach the database and are never sent back to the browser.
          </div>
        </div>
      </header>

      {loadError && <div className="settings-alert">{loadError}</div>}

      {status && (
        <div className="settings-list">
          <div className="settings-card">
            <div className="settings-card-head">
              <span className="settings-card-label">Database</span>
              <span className="settings-badge ok">Connected</span>
            </div>
            <div className="settings-card-help">
              MongoDB database <span className="mono">{status.database.name}</span>, set by the <span className="mono">MONGODB_URI</span> environment variable.
            </div>
          </div>
          {FIELDS.map(f => (
            <SecretField
              key={f.kind}
              {...f}
              state={status[f.kind]}
              onChange={next => setStatus(s => (s ? { ...s, ...next } : s))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FieldProps {
  kind: SecretKind
  label: string
  help: string
  placeholder: string
  state: { configured: boolean; updatedAt: string | null; source?: 'settings' | 'env' | null }
  onChange: (s: Omit<SettingsStatus, 'database'>) => void
}

const SecretField: FC<FieldProps> = ({ kind, label, help, placeholder, state, onChange }) => {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<'save' | 'delete' | 'test' | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [checks, setChecks] = useState<Array<{ label: string; ok: boolean; text: string }> | null>(null)
  const savedHere = state.configured && state.source !== 'env'

  // Gemini only: try the saved key for a plain answer and for web research, and show Google's reply.
  const test = async () => {
    setBusy('test')
    setMessage(null)
    setChecks(null)
    try {
      const r = await testGeminiKey()
      setChecks([
        { label: 'Assistant', ok: r.assistant.ok, text: r.assistant.ok ? `Works (model ${r.assistant.model})` : r.assistant.error ?? 'Failed' },
        { label: 'Gap analysis (web research)', ok: r.research.ok, text: r.research.ok ? `Works (model ${r.research.model})` : r.research.error ?? 'Failed' },
      ])
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy(null)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setBusy('save')
    setMessage(null)
    try {
      onChange(await saveSecret(kind, value.trim()))
      setMessage({ text: 'Saved.', ok: true })
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      // Drop the typed value from memory whether or not the save worked.
      setValue('')
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete the saved ${label}? This takes effect immediately.`)) return
    setBusy('delete')
    setMessage(null)
    try {
      onChange(await deleteSecret(kind))
      setMessage({ text: 'Deleted.', ok: true })
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy(null)
    }
  }

  return (
    <form className="settings-card" onSubmit={save} autoComplete="off">
      <div className="settings-card-head">
        <label className="settings-card-label" htmlFor={`secret-${kind}`}>{label}</label>
        <span className={`settings-badge ${state.configured ? 'ok' : ''}`}>
          {!state.configured ? 'Not set' : state.source === 'env' ? 'From environment' : 'Saved'}
        </span>
      </div>
      <div className="settings-card-help">
        {help}
        {savedHere && state.updatedAt && <> Last updated {new Date(state.updatedAt).toLocaleString()}.</>}
      </div>
      <div className="settings-card-row">
        {/* Uncontrolled by the password manager and never pre-filled: the saved value is not known to the browser. */}
        <input
          id={`secret-${kind}`}
          className="input settings-input mono"
          type="password"
          name={`gapwise-${kind}`}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={savedHere ? '•••••••••••• (enter a new value to replace)' : placeholder}
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <button className="btn-primary" type="submit" disabled={!value.trim() || !!busy}>
          {busy === 'save' ? 'Saving…' : savedHere ? 'Replace' : 'Save'}
        </button>
        {savedHere && kind === 'gemini' && (
          <button className="btn-secondary" type="button" onClick={test} disabled={!!busy}>
            {busy === 'test' ? 'Testing… (up to a few minutes)' : 'Test key'}
          </button>
        )}
        {savedHere && (
          <button className="btn-secondary btn-danger" type="button" onClick={remove} disabled={!!busy}>
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      {message && <div className={`settings-message ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
      {checks && (
        <ul className="key-checks">
          {checks.map(c => (
            <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
              <strong>{c.ok ? '✓' : '✕'} {c.label}:</strong> {c.text}
            </li>
          ))}
          {checks.some(c => !c.ok) && (
            <li className="key-hint">
              “429” or “quota” means Google is limiting this key: wait and test again, turn on billing for the key’s
              Google Cloud project, or create a new key in Google AI Studio. “API key not valid” means the key is wrong.
            </li>
          )}
        </ul>
      )}
    </form>
  )
}

export default SettingsPage
