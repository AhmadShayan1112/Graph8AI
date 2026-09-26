import { useEffect, useState, type FC, type ReactNode } from 'react'
import SuggestInput from './SuggestInput'
import { getFilterOptions, type DiscoverFilters, type FilterOption } from '../lib/api'

interface Props {
  filters: DiscoverFilters
  onChange: (f: DiscoverFilters) => void
}

const Section: FC<{ title: string; icon: string; count: number; defaultOpen?: boolean; children: ReactNode }> = ({
  title, icon, count, defaultOpen, children,
}) => {
  const [open, setOpen] = useState(!!defaultOpen || count > 0)
  return (
    <div className="fp-section">
      <button className="fp-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="fp-icon" aria-hidden>{icon}</span>
        <span className="fp-title">{title}</span>
        {count > 0 && <span className="fp-count">{count}</span>}
        <span className={`fp-caret ${open ? 'open' : ''}`} aria-hidden>⌄</span>
      </button>
      {open && <div className="fp-body">{children}</div>}
    </div>
  )
}

const Chips: FC<{ items: string[]; onRemove: (i: number) => void }> = ({ items, onRemove }) =>
  items.length ? (
    <div className="fp-chips">
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="fp-chip">
          {t}
          <button onClick={() => onRemove(i)} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
    </div>
  ) : null

const FIELD_TAG: Record<string, string> = { city: 'city', country: 'country', state: 'state' }

const FilterPanel: FC<Props> = ({ filters: f, onChange }) => {
  const [options, setOptions] = useState<{ employee_count: FilterOption[]; revenue: FilterOption[] }>({ employee_count: [], revenue: [] })
  const [locDraft, setLocDraft] = useState('')
  const [indDraft, setIndDraft] = useState('')
  const [kwDraft, setKwDraft] = useState('')

  useEffect(() => { getFilterOptions().then(setOptions).catch(() => {}) }, [])

  const set = (patch: Partial<DiscoverFilters>) => onChange({ ...f, ...patch })
  const toggle = (key: 'employees' | 'revenue', id: string) =>
    set({ [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] })

  const addLocation = (value: string, field?: 'city' | 'country' | 'state') => {
    const v = value.trim()
    if (!v || f.locations.some(l => l.value.toLowerCase() === v.toLowerCase() && l.field === field)) return
    set({ locations: [...f.locations, { value: v, field }] })
    setLocDraft('')
  }
  const addIndustry = (value: string) => {
    const v = value.trim()
    if (!v || f.industries.includes(v)) return
    set({ industries: [...f.industries, v] })
    setIndDraft('')
  }
  const addKeyword = () => {
    const v = kwDraft.trim()
    if (!v || f.keywords.includes(v)) return
    set({ keywords: [...f.keywords, v] })
    setKwDraft('')
  }

  return (
    <div className="fp">
      <Section title="Location" icon="◎" count={f.locations.length} defaultOpen>
        <SuggestInput
          kind="location"
          value={locDraft}
          placeholder="Country, state or city"
          onChange={(v, field) => (field && field !== 'industry' ? addLocation(v, field) : setLocDraft(v))}
          onSubmit={() => addLocation(locDraft)}
        />
        <Chips
          items={f.locations.map(l => (l.field ? `${l.value} · ${FIELD_TAG[l.field]}` : l.value))}
          onRemove={i => set({ locations: f.locations.filter((_, j) => j !== i) })}
        />
      </Section>

      <Section title="Industry" icon="▦" count={f.industries.length} defaultOpen>
        <SuggestInput
          kind="industry"
          value={indDraft}
          placeholder="e.g. Dentists, Restaurants"
          onChange={(v, field) => (field ? addIndustry(v) : setIndDraft(v))}
          onSubmit={() => addIndustry(indDraft)}
        />
        <Chips items={f.industries} onRemove={i => set({ industries: f.industries.filter((_, j) => j !== i) })} />
      </Section>

      <Section title="Keywords" icon="⌕" count={f.keywords.length}>
        <input
          className="input fp-input"
          value={kwDraft}
          placeholder="In company description, e.g. implants"
          onChange={e => setKwDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addKeyword()}
        />
        <Chips items={f.keywords} onRemove={i => set({ keywords: f.keywords.filter((_, j) => j !== i) })} />
        <div className="fp-hint">Matches any keyword. Press Enter to add.</div>
      </Section>

      <Section title="# Employees" icon="⚇" count={f.employees.length}>
        <div className="fp-checks">
          {options.employee_count.map(o => (
            <label key={o.id} className="fp-check">
              <input type="checkbox" checked={f.employees.includes(o.id)} onChange={() => toggle('employees', o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
          {!options.employee_count.length && <div className="fp-hint">Loading…</div>}
        </div>
      </Section>

      <Section title="Revenue" icon="$" count={f.revenue.length}>
        <div className="fp-checks">
          {options.revenue.map(o => (
            <label key={o.id} className="fp-check">
              <input type="checkbox" checked={f.revenue.includes(o.id)} onChange={() => toggle('revenue', o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
          {!options.revenue.length && <div className="fp-hint">Loading…</div>}
        </div>
      </Section>

      <Section title="Founded year" icon="◷" count={f.foundedFrom || f.foundedTo ? 1 : 0}>
        <div className="fp-range">
          <input
            className="input fp-input" type="number" inputMode="numeric" placeholder="From"
            min={1800} max={2100} value={f.foundedFrom ?? ''}
            onChange={e => set({ foundedFrom: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-muted">–</span>
          <input
            className="input fp-input" type="number" inputMode="numeric" placeholder="To"
            min={1800} max={2100} value={f.foundedTo ?? ''}
            onChange={e => set({ foundedTo: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </Section>

      <Section title="Online presence" icon="⌘" count={(f.website !== 'any' ? 1 : 0) + (f.hasPhone ? 1 : 0)} defaultOpen>
        <div className="fp-seg" role="radiogroup" aria-label="Website">
          {([['any', 'Any'], ['has', 'Has website'], ['none', 'No website']] as const).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={f.website === id}
              className={f.website === id ? 'active' : ''} onClick={() => set({ website: id })}>
              {label}
            </button>
          ))}
        </div>
        <div className="fp-hint">"No website" finds businesses that need one most.</div>
        <label className="fp-check">
          <input type="checkbox" checked={f.hasPhone} onChange={e => set({ hasPhone: e.target.checked })} />
          <span>Has a phone number</span>
        </label>
      </Section>
    </div>
  )
}

export default FilterPanel
