import { useEffect, useState, type FC } from 'react'
import type { Lead } from '../types/lead'
import { discoverLeads, EMPTY_FILTERS, type Campaign, type DiscoverFilters } from '../lib/api'
import FilterPanel from '../components/FilterPanel'
import { useSession } from '../components/LoginGate'

interface Props {
  onSelectLead: (lead: Lead) => void
  leads: Lead[]
  setLeads: (leads: Lead[]) => void
  // When set, searches and the leads they find are saved to this campaign.
  campaign: Campaign | null
  onOpenCampaign: (id: string) => void
  onLeaveCampaign: () => void
}

const GAP_FILTERS: Array<[string, string]> = [
  ['All gaps', ''],
  ['No website', 'no website'],
  ['No booking', 'no online booking'],
  ['Slow site', 'slow website'],
  ['Not mobile', 'not mobile-friendly'],
  ['No SSL', 'no ssl'],
  ['Poor SEO', 'poor seo'],
]

const TRY_PROMPTS = ['Dentists in Lahore', 'Restaurants in Karachi', 'SaaS in Dubai', 'Logistics in UAE', 'Plumbers in Texas']

// Survives navigating to Audit and back.
let lastFilters: DiscoverFilters = { ...EMPTY_FILTERS, industries: ['Dentists'], locations: [{ value: 'Lahore', field: 'city' }] }
let lastTotal: number | null = null

// Lets History reopen a saved search with the filters and match count it had.
export function restoreDiscover(filters: DiscoverFilters, total: number | null) {
  lastFilters = { ...EMPTY_FILTERS, ...filters }
  lastTotal = total
}

function activeCount(f: DiscoverFilters) {
  return f.industries.length + f.locations.length + f.keywords.length + f.employees.length + f.revenue.length
    + (f.foundedFrom || f.foundedTo ? 1 : 0) + (f.website !== 'any' ? 1 : 0) + (f.hasPhone ? 1 : 0)
}

const DiscoverPage: FC<Props> = ({ onSelectLead, leads, setLeads, campaign, onOpenCampaign, onLeaveCampaign }) => {
  const canSearch = useSession().user.permissions.graph8
  const [filters, setFiltersState] = useState<DiscoverFilters>(lastFilters)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [gapFilter, setGapFilter] = useState('')
  const [total, setTotal] = useState<number | null>(lastTotal)
  const [error, setError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  const setFilters = (f: DiscoverFilters) => { lastFilters = f; setFiltersState(f) }

  const runSearch = async (f: DiscoverFilters, promptText = '', save = true) => {
    if (!canSearch) return
    setLoading(true)
    setError('')
    try {
      const result = await discoverLeads({ ...f, prompt: promptText || undefined }, save, campaign?.id)
      setLeads(result.leads)
      setTotal(lastTotal = result.total)
      // Turn the prompt into real filter chips so the user can refine it.
      if (promptText && result.matchedOn) {
        const ind = promptText.match(/^(.+?)\s+(?:in|near|at|from)\s+/i)?.[1] ?? promptText
        setFilters({
          ...f,
          industries: f.industries.includes(ind.trim()) ? f.industries : [...f.industries, ind.trim()],
          locations: result.matchedOn.locations ?? f.locations,
        })
        setPrompt('')
      }
    } catch (err: any) {
      setError(err.status === 403 ? err.message : 'Lead search failed. Try loosening a filter.')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // The first load is the app's own search, not the user's, so it is not saved to History.
    // Inside a campaign, wait for the user to search so nothing is filed there by accident.
    if (!leads.length && !campaign) runSearch(filters, '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = () => { setPanelOpen(false); runSearch(filters, prompt.trim()) }
  const clearAll = () => setFilters({ ...EMPTY_FILTERS, limit: filters.limit })

  const filtered = gapFilter ? leads.filter(l => l.gaps.some(g => g.toLowerCase().includes(gapFilter))) : leads
  const n = activeCount(filters)

  const kpis = [
    { label: 'Businesses loaded', value: String(leads.length), note: total != null ? `of ${total.toLocaleString()} matches` : 'in this market' },
    { label: 'With fixable gaps', value: String(leads.filter(l => l.score < 70).length), note: 'score < 70' },
    { label: 'No website', value: String(leads.filter(l => !l.site).length), note: 'strongest leads' },
    { label: 'Total est. value', value: leads.length ? `$${leads.reduce((s, l) => s + (parseInt(l.value.replace(/[$,]/g, '')) || 0), 0).toLocaleString()}` : '—', note: 'addressable' },
  ]

  return (
    <div className="discover-layout">
      <aside className={`discover-filters ${panelOpen ? 'open' : ''}`}>
        <div className="df-head">
          <span className="df-title">Filters</span>
          {n > 0 && <button className="df-clear" onClick={clearAll}>Clear all</button>}
          <button className="df-close" onClick={() => setPanelOpen(false)} aria-label="Close filters">×</button>
        </div>
        <FilterPanel filters={filters} onChange={setFilters} />
        <div className="df-foot">
          <button className="btn-primary full-width" onClick={search} disabled={loading || !canSearch}>
            {loading ? 'Searching…' : 'Apply filters'}
          </button>
        </div>
      </aside>
      {panelOpen && <div className="df-overlay" onClick={() => setPanelOpen(false)} />}

      <div className="page-content fade-in discover-main">
        <header className="page-header">
          <div className="page-header-text">
            <div className="page-step">Step 1 · Discover</div>
            <h1 className="page-title">Businesses with fixable digital gaps</h1>
          </div>
        </header>

        {campaign && (
          <div className="campaign-banner">
            <div className="campaign-banner-text">
              <span className="campaign-banner-label mono">Campaign</span>
              <strong>{campaign.name}</strong>
              <span className="text-muted">Searches and every lead they find are saved here.</span>
            </div>
            <div className="campaign-banner-actions">
              <button className="btn-secondary" onClick={() => onOpenCampaign(campaign.id)}>View campaign</button>
              <button className="btn-secondary" onClick={onLeaveCampaign}>Leave</button>
            </div>
          </div>
        )}

        {!canSearch && (
          <div className="settings-alert access-note">
            Lead search with Graph8 is turned off for your account. Ask the admin to enable it.
          </div>
        )}

        <div className="prompt-card">
          <div className="prompt-row">
            <span className="prompt-spark" aria-hidden>✦</span>
            <input
              className="prompt-input"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Describe who you want, e.g. Dentists in Lahore"
            />
            <button className="btn-accent prompt-btn" onClick={search} disabled={loading || !canSearch}>
              {loading ? 'Searching…' : 'Search leads →'}
            </button>
          </div>
          <div className="prompt-meta">
            <div className="prompt-try">
              <span className="text-muted">Try</span>
              {TRY_PROMPTS.map(t => (
                <button key={t} className="try-chip" onClick={() => { setPrompt(''); runSearch({ ...filters, industries: [], locations: [] }, t) }}>
                  + {t}
                </button>
              ))}
            </div>
            <label className="prompt-max">
              <span className="text-muted">Max leads</span>
              <input
                type="number" min={1} max={100} className="input prompt-max-input"
                value={filters.limit}
                onChange={e => setFilters({ ...filters, limit: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </label>
          </div>
        </div>

        <div className="active-row">
          <button className="btn-secondary filters-toggle" onClick={() => setPanelOpen(true)}>
            Filters{n ? ` · ${n}` : ''}
          </button>
          {filters.locations.map((l, i) => (
            <span key={`l${i}`} className="active-chip">{l.value}{l.field ? ` · ${l.field}` : ''}</span>
          ))}
          {filters.industries.map(x => <span key={`i${x}`} className="active-chip">{x}</span>)}
          {filters.keywords.map(x => <span key={`k${x}`} className="active-chip">“{x}”</span>)}
          {filters.employees.length > 0 && <span className="active-chip">{filters.employees.join(', ')} employees</span>}
          {filters.revenue.length > 0 && <span className="active-chip">{filters.revenue.length} revenue band{filters.revenue.length > 1 ? 's' : ''}</span>}
          {(filters.foundedFrom || filters.foundedTo) && <span className="active-chip">Founded {filters.foundedFrom ?? '…'}–{filters.foundedTo ?? '…'}</span>}
          {filters.website !== 'any' && <span className="active-chip">{filters.website === 'none' ? 'No website' : 'Has website'}</span>}
          {filters.hasPhone && <span className="active-chip">Has phone</span>}
        </div>

        <div className="kpi-grid">
          {kpis.map((k, i) => (
            <div key={i} className="kpi-card fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-note">{k.note}</div>
            </div>
          ))}
        </div>

        <div className="filter-row">
          {GAP_FILTERS.map(([label, match]) => (
            <button key={label} className={`filter-btn ${gapFilter === match ? 'active' : ''}`} onClick={() => setGapFilter(match)}>
              {label}
            </button>
          ))}
        </div>

        <div className="leads-table">
          <div className="leads-header">
            <div>Business</div>
            <div>Digital health</div>
            <div>Top gaps</div>
            <div>Est. value</div>
            <div></div>
          </div>
          {!loading && filtered.map((lead, i) => (
            <div
              key={lead.id}
              className="lead-row fade-in"
              style={{ animationDelay: `${i * 0.04}s` }}
              onClick={() => onSelectLead(lead)}
            >
              <div className="lead-info">
                <div className="lead-name">{lead.name}</div>
                <div className="lead-meta">
                  {lead.type} · {lead.city} · <span className="mono">{lead.site || 'no website'}</span>
                </div>
              </div>
              <div className="lead-score-cell">
                <span className="lead-score-num" style={{ color: lead.color }}>{lead.score}</span>
                <div className="lead-score-bar">
                  <div className="lead-score-fill bar-animate" style={{ width: `${lead.score}%`, background: lead.color, animationDelay: `${i * 0.04}s` }} />
                </div>
              </div>
              <div className="lead-gaps">
                {lead.gaps.slice(0, 2).map(g => <span key={g} className="gap-tag">{g}</span>)}
              </div>
              <div className="lead-value mono">{lead.value}</div>
              <div className="lead-audit-link">Audit →</div>
            </div>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="empty-state">
              {error || (total === 0
                ? 'No businesses match these filters. Remove one and search again.'
                : leads.length ? 'No leads with this gap in the current results.' : 'Set filters or describe who you want, then search.')}
            </div>
          )}
          {loading && <div className="empty-state"><span className="pulse">Searching…</span></div>}
        </div>
      </div>
    </div>
  )
}

export default DiscoverPage
