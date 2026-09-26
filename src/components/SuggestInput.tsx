import { useEffect, useRef, useState, type FC } from 'react'
import { suggest, type Suggestion } from '../lib/api'

interface Props {
  kind: 'industry' | 'location'
  value: string
  placeholder: string
  onChange: (value: string, field?: Suggestion['field']) => void
  onSubmit: () => void
}

const FIELD_LABEL: Record<Suggestion['field'], string> = {
  industry: '', city: 'City', country: 'Country', state: 'State',
}

const SuggestInput: FC<Props> = ({ kind, value, placeholder, onChange, onSubmit }) => {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef(false)

  useEffect(() => {
    if (!typed.current || value.trim().length < 2) { setItems([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      suggest(kind, value, ctrl.signal)
        .then(s => { setItems(s); setActive(-1); setOpen(true) })
        .catch(() => {})
    }, 220)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [kind, value])

  const pick = (s: Suggestion) => {
    typed.current = false
    onChange(s.value, s.field)
    setOpen(false)
  }

  return (
    <div className="suggest">
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={e => { typed.current = true; onChange(e.target.value) }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (open && items.length && e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)) }
          else if (open && items.length && e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Enter') {
            if (open && active >= 0) pick(items[active])
            else { setOpen(false); onSubmit() }
          }
        }}
      />
      {open && items.length > 0 && (
        <ul className="suggest-list">
          {items.map((s, i) => (
            <li
              key={`${s.field}:${s.value}`}
              className={`suggest-item ${i === active ? 'active' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(s) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggest-value">{s.value}</span>
              <span className="suggest-meta mono">
                {FIELD_LABEL[s.field] && <span className="suggest-kind">{FIELD_LABEL[s.field]}</span>}
                {s.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SuggestInput
