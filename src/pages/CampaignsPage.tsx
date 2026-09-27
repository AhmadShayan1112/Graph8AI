import { useEffect, useState, type FC, type FormEvent } from 'react'
import {
  createCampaign, deleteCampaign, getCampaign, getSearch, listCampaigns, removeCampaignLead, updateCampaign,
  type Campaign, type CampaignDetail, type CampaignInput, type CampaignLead, type CampaignSummary, type SavedSearch,
} from '../lib/api'
import { useSession } from '../components/LoginGate'

interface Props {
  // Campaign to show when the page opens (e.g. coming back from Discover).
  openId: string | null
  onOpenId: (id: string | null) => void
  onSearch: (c: Campaign) => void
  onOpenLead: (c: Campaign, lead: CampaignLead) => void
  onOpenSearch: (c: Campaign, s: SavedSearch) => void
  onDeleted: (id: string) => void
}

const splitList = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

function targetText(c: CampaignInput) {
  const what = c.target.industries.join(', ')
  const where = c.target.locations.map(l => l.value).join(', ')
  if (what && where) return `${what} in ${where}`
  return what || (where ? `Any industry in ${where}` : 'No target set')
}

const CampaignsPage: FC<Props> = props => {
  if (props.openId) return <CampaignView key={props.openId} id={props.openId} {...props} />
  return <CampaignList onOpen={id => props.onOpenId(id)} />
}

const CampaignList: FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { user } = useSession()
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [who, setWho] = useState<'mine' | 'all'>('mine')

  useEffect(() => {
    listCampaigns().then(r => {
      setCampaigns(r.campaigns)
      if (!r.campaigns.length) setCreating(true)
    }).catch(err => setError(err.message))
  }, [])

  const shown = (campaigns ?? []).filter(c => user.role !== 'admin' || who === 'all' || c.mine)

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Campaigns</div>
          <h1 className="page-title">Your campaigns</h1>
          <div className="page-subtitle">
            A campaign keeps every search you run for one goal, and every lead those searches find.
          </div>
        </div>
        {!creating && (
          <div className="page-header-actions">
            <button className="btn-primary" onClick={() => setCreating(true)}>+ New campaign</button>
          </div>
        )}
      </header>

      {error && <div className="settings-alert">{error}</div>}

      {creating && (
        <CampaignForm
          title="New campaign"
          submitLabel="Create campaign"
          onCancel={campaigns?.length ? () => setCreating(false) : undefined}
          onSubmit={async input => { const { campaign } = await createCampaign(input); onOpen(campaign.id) }}
        />
      )}

      {user.role === 'admin' && !!campaigns?.length && (
        <div className="history-toolbar">
          <div className="auth-tabs history-scope" role="tablist">
            <button type="button" role="tab" aria-selected={who === 'mine'} className={`auth-tab ${who === 'mine' ? 'active' : ''}`} onClick={() => setWho('mine')}>Mine</button>
            <button type="button" role="tab" aria-selected={who === 'all'} className={`auth-tab ${who === 'all' ? 'active' : ''}`} onClick={() => setWho('all')}>Everyone</button>
          </div>
        </div>
      )}

      {!campaigns && !error && <p className="text-muted"><span className="pulse">Loading…</span></p>}
      {campaigns && campaigns.length > 0 && !shown.length && <p className="text-muted">No campaigns here yet.</p>}

      <div className="campaign-grid">
        {shown.map((c, i) => (
          <button key={c.id} className="campaign-card fade-in" style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }} onClick={() => onOpen(c.id)}>
            <div className="campaign-card-name">{c.name}</div>
            <div className="campaign-card-target">{targetText(c)}</div>
            {c.description && <div className="campaign-card-desc">{c.description}</div>}
            <div className="campaign-card-stats">
              <span><strong>{c.leadCount}</strong> leads</span>
              <span><strong>{c.searchCount}</strong> searches</span>
            </div>
            <div className="campaign-card-foot">
              {c.lastSearchAt ? `Last search ${new Date(c.lastSearchAt).toLocaleDateString()}` : 'No searches yet'}
              {!c.mine && <> · by {c.username}</>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const CampaignForm: FC<{
  title: string
  submitLabel: string
  initial?: CampaignInput
  onSubmit: (input: CampaignInput) => Promise<void>
  onCancel?: () => void
}> = ({ title, submitLabel, initial, onSubmit, onCancel }) => {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [industries, setIndustries] = useState(initial?.target.industries.join(', ') ?? '')
  const [locations, setLocations] = useState(initial?.target.locations.map(l => l.value).join(', ') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Keep the exact place type (city/state/country) for places that didn't change.
      const known = new Map(initial?.target.locations.map(l => [l.value, l]) ?? [])
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        target: {
          industries: splitList(industries),
          locations: splitList(locations).map(v => known.get(v) ?? { value: v }),
        },
      })
    } catch (err: any) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="settings-card campaign-form" onSubmit={submit}>
      <div className="settings-card-label">{title}</div>
      <label className="auth-field">
        <span className="campaign-field-label">Name</span>
        <input className="input" placeholder="e.g. Lahore dentists — Q4" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
      </label>
      <label className="auth-field">
        <span className="campaign-field-label">Goal <span className="text-muted">(optional)</span></span>
        <textarea
          className="input campaign-textarea"
          placeholder="e.g. Sell booking pages to clinics without online booking"
          value={description}
          maxLength={500}
          onChange={e => setDescription(e.target.value)}
        />
      </label>
      <div className="campaign-form-row">
        <label className="auth-field">
          <span className="campaign-field-label">Target industries</span>
          <input className="input" placeholder="Dentists, Dental clinics" value={industries} onChange={e => setIndustries(e.target.value)} />
        </label>
        <label className="auth-field">
          <span className="campaign-field-label">Target locations</span>
          <input className="input" placeholder="Lahore, Karachi" value={locations} onChange={e => setLocations(e.target.value)} />
        </label>
      </div>
      <div className="settings-card-help">Separate several with commas. They fill in the search filters when you search in this campaign.</div>
      <div className="settings-card-row">
        <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button className="btn-secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
      {error && <div className="settings-message bad">{error}</div>}
    </form>
  )
}

const CampaignView: FC<Props & { id: string }> = ({ id, onOpenId, onSearch, onOpenLead, onOpenSearch, onDeleted }) => {
  const { user } = useSession()
  const [data, setData] = useState<CampaignDetail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'leads' | 'searches'>('leads')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    getCampaign(id).then(setData).catch(err => setError(err.message))
  }, [id])

  if (error && !data) {
    return (
      <div className="page-content fade-in">
        <button className="back-link" onClick={() => onOpenId(null)}>← All campaigns</button>
        <div className="settings-alert">{error}</div>
      </div>
    )
  }
  if (!data) return <div className="page-content"><p className="text-muted"><span className="pulse">Loading…</span></p></div>

  const { campaign, leads, searches } = data

  const remove = async () => {
    if (!confirm(`Delete "${campaign.name}" with its ${leads.length} saved leads and ${searches.length} searches? This cannot be undone.`)) return
    setBusy('delete')
    try {
      await deleteCampaign(campaign.id)
      onDeleted(campaign.id)
      onOpenId(null)
    } catch (err: any) {
      setError(err.message)
      setBusy(null)
    }
  }

  const removeLead = async (lead: CampaignLead) => {
    if (!confirm(`Remove ${lead.name} from this campaign?`)) return
    setBusy(lead.id)
    try {
      await removeCampaignLead(campaign.id, lead.id)
      setData(d => d && { ...d, leads: d.leads.filter(l => l.id !== lead.id) })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const openSearch = async (searchId: string) => {
    setBusy(searchId)
    try {
      onOpenSearch(campaign, (await getSearch(searchId)).search)
    } catch (err: any) {
      setError(err.message)
      setBusy(null)
    }
  }

  const q = query.trim().toLowerCase()
  const shownLeads = q
    ? leads.filter(l => `${l.name} ${l.type} ${l.city} ${l.site} ${l.gaps.join(' ')}`.toLowerCase().includes(q))
    : leads
  const noWebsite = leads.filter(l => !l.site).length
  const enriched = leads.filter(l => l.enrichment).length
  const canSearch = user.permissions.graph8

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={() => onOpenId(null)}>← All campaigns</button>
          <div className="page-step">Campaign{!campaign.mine && ` · by ${campaign.username}`}</div>
          <h1 className="page-title">{campaign.name}</h1>
          <div className="page-subtitle">{campaign.description || targetText(campaign)}</div>
        </div>
        <div className="page-header-actions">
          <button className="btn-accent" onClick={() => onSearch(campaign)} disabled={!canSearch} title={canSearch ? '' : 'Lead search is turned off for your account'}>
            Search in this campaign →
          </button>
          <button className="btn-secondary" onClick={() => setEditing(e => !e)}>{editing ? 'Close' : 'Edit'}</button>
          <button className="btn-secondary btn-danger" onClick={remove} disabled={busy === 'delete'}>Delete</button>
        </div>
      </header>

      {!canSearch && <div className="settings-alert">Lead search with Graph8 is turned off for your account. You can still view and audit the saved leads.</div>}
      {error && <div className="settings-alert">{error}</div>}

      {editing && (
        <CampaignForm
          title="Edit campaign"
          submitLabel="Save changes"
          initial={campaign}
          onCancel={() => setEditing(false)}
          onSubmit={async input => {
            const { campaign: next } = await updateCampaign(campaign.id, input)
            setData(d => d && { ...d, campaign: next })
            setEditing(false)
          }}
        />
      )}

      <div className="campaign-target-row">
        {campaign.target.industries.map(x => <span key={`i${x}`} className="active-chip">{x}</span>)}
        {campaign.target.locations.map(l => <span key={`l${l.value}`} className="active-chip">{l.value}</span>)}
        {!campaign.target.industries.length && !campaign.target.locations.length && <span className="text-muted">No target set. Edit the campaign to add one.</span>}
      </div>

      <div className="kpi-grid">
        {[
          { label: 'Saved leads', value: leads.length, note: 'across all searches' },
          { label: 'Searches', value: searches.length, note: 'run in this campaign' },
          { label: 'No website', value: noWebsite, note: 'strongest leads' },
          { label: 'Enriched', value: enriched, note: 'contact details found' },
        ].map(k => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-note">{k.note}</div>
          </div>
        ))}
      </div>

      <div className="history-toolbar campaign-toolbar">
        <div className="auth-tabs history-scope campaign-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'leads'} className={`auth-tab ${tab === 'leads' ? 'active' : ''}`} onClick={() => setTab('leads')}>Leads · {leads.length}</button>
          <button type="button" role="tab" aria-selected={tab === 'searches'} className={`auth-tab ${tab === 'searches' ? 'active' : ''}`} onClick={() => setTab('searches')}>Searches · {searches.length}</button>
        </div>
        {tab === 'leads' && leads.length > 0 && (
          <input className="input history-search" placeholder="Filter leads by name, city or gap" value={query} onChange={e => setQuery(e.target.value)} />
        )}
      </div>

      {tab === 'leads' && (
        <div className="leads-table">
          {shownLeads.map(lead => (
            <div key={lead.id} className="lead-row campaign-lead-row" onClick={() => onOpenLead(campaign, lead)}>
              <div className="lead-info">
                <div className="lead-name">{lead.name}</div>
                <div className="lead-meta">
                  {lead.type} · {lead.city} · <span className="mono">{lead.site || 'no website'}</span>
                </div>
                <div className="lead-meta">
                  Added {new Date(lead.addedAt).toLocaleDateString()}
                  {lead.enrichment && ' · enriched'}
                </div>
              </div>
              <div className="lead-score-cell">
                <span className="lead-score-num" style={{ color: lead.color }}>{lead.score}</span>
                <div className="lead-score-bar"><div className="lead-score-fill" style={{ width: `${lead.score}%`, background: lead.color }} /></div>
              </div>
              <div className="lead-gaps">{lead.gaps.slice(0, 2).map(g => <span key={g} className="gap-tag">{g}</span>)}</div>
              <div className="campaign-lead-actions" onClick={e => e.stopPropagation()}>
                <button className="btn-secondary" onClick={() => onOpenLead(campaign, lead)}>Audit →</button>
                <button className="btn-secondary btn-danger" disabled={busy === lead.id} onClick={() => removeLead(lead)} aria-label={`Remove ${lead.name}`}>✕</button>
              </div>
            </div>
          ))}
          {!shownLeads.length && (
            <div className="empty-state">
              {leads.length ? 'No saved leads match.' : 'No leads yet. Run a search in this campaign and every lead it finds is saved here.'}
            </div>
          )}
        </div>
      )}

      {tab === 'searches' && (
        <div className="settings-list">
          {searches.map(s => (
            <div key={s.id} className="settings-card history-card">
              <div className="settings-card-head">
                <span className="settings-card-label">{s.prompt || [s.filters.industries?.join(', '), s.filters.locations?.map(l => l.value).join(', ')].filter(Boolean).join(' in ') || 'Search'}</span>
                <span className="settings-badge ok">{s.leadCount} leads</span>
              </div>
              <div className="history-foot">
                <span className="text-muted">{new Date(s.createdAt).toLocaleString()} · {s.total.toLocaleString()} matches{!s.mine && ` · by ${s.username}`}</span>
                <button className="btn-primary" disabled={!!busy} onClick={() => openSearch(s.id)}>{busy === s.id ? 'Opening…' : 'Open results'}</button>
              </div>
            </div>
          ))}
          {!searches.length && <p className="text-muted">No searches yet.</p>}
        </div>
      )}
    </div>
  )
}

export default CampaignsPage
