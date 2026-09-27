import { useEffect, useRef, useState, useSyncExternalStore, type FC, type FormEvent, type ReactNode } from 'react'

// Gapwise's own confirm / prompt dialogs, replacing the browser's "site says" boxes. Call confirmDialog() or
// promptDialog() from anywhere; <DialogHost /> (mounted once in App) shows them one at a time.

type Tone = 'default' | 'danger' | 'info'

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Tone
}
interface PromptOptions extends ConfirmOptions {
  label: string
  type?: 'text' | 'password'
  placeholder?: string
  // Returns an error message to show under the field, or null when the value is fine.
  validate?: (value: string) => string | null
}

type Request =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }

let nextId = 1

let queue: Request[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function confirmDialog(opts: ConfirmOptions) {
  return new Promise<boolean>(resolve => { queue = [...queue, { id: nextId++, kind: 'confirm', opts, resolve }]; emit() })
}

export function promptDialog(opts: PromptOptions) {
  return new Promise<string | null>(resolve => { queue = [...queue, { id: nextId++, kind: 'prompt', opts, resolve }]; emit() })
}

function finish(value: boolean | string | null) {
  const [current, ...rest] = queue
  if (!current) return
  queue = rest
  if (current.kind === 'confirm') current.resolve(value === true || typeof value === 'string')
  else current.resolve(typeof value === 'string' ? value : null)
  emit()
}

const ICONS: Record<Tone, ReactNode> = {
  default: <path d="M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  danger: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
}

export const DialogHost: FC = () => {
  const current = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => queue[0])
  if (!current) return null
  return <DialogView key={current.id} request={current} />
}

const DialogView: FC<{ request: Request }> = ({ request }) => {
  const { opts } = request
  const tone = opts.tone ?? 'default'
  const isPrompt = request.kind === 'prompt'
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<Element | null>(document.activeElement)

  useEffect(() => {
    ;(isPrompt ? inputRef.current : confirmRef.current)?.focus()
    const prev = returnFocus.current
    return () => { if (prev instanceof HTMLElement) prev.focus() }
  }, [isPrompt])

  // Esc cancels; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null) }
      if (e.key === 'Tab' && panelRef.current) {
        const items = panelRef.current.querySelectorAll<HTMLElement>('button, input')
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (request.kind === 'prompt') {
      const problem = request.opts.validate?.(value) ?? null
      if (problem) { setError(problem); inputRef.current?.focus(); return }
      finish(value)
    } else {
      finish(true)
    }
  }

  return (
    <div className="dlg-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) finish(null) }}>
      <div
        ref={panelRef}
        className={`dlg dlg-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby={opts.message ? 'dlg-message' : undefined}
      >
        <form onSubmit={submit}>
          <div className="dlg-top">
            <span className="dlg-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[tone]}
              </svg>
            </span>
            <div className="dlg-text">
              <h2 id="dlg-title">{opts.title}</h2>
              {opts.message && <div id="dlg-message" className="dlg-message">{opts.message}</div>}
            </div>
          </div>
          {request.kind === 'prompt' && (
            <label className="dlg-field">
              <span>{request.opts.label}</span>
              <input
                ref={inputRef}
                className="input"
                type={request.opts.type ?? 'text'}
                placeholder={request.opts.placeholder}
                autoComplete={request.opts.type === 'password' ? 'new-password' : 'off'}
                value={value}
                onChange={e => { setValue(e.target.value); setError(null) }}
                aria-invalid={!!error}
              />
              {error && <span className="dlg-error">{error}</span>}
            </label>
          )}
          <div className="dlg-actions">
            <button type="button" className="btn-secondary" onClick={() => finish(null)}>{opts.cancelLabel ?? 'Cancel'}</button>
            <button ref={confirmRef} type="submit" className={tone === 'danger' ? 'btn-primary dlg-danger' : 'btn-primary'}>
              {opts.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
