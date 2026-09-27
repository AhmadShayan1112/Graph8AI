import { useEffect, useMemo, useState, type FC } from 'react'
import {
  getCampaign, listCampaigns, listGapAnalyses,
  type Campaign, type CampaignLead, type CampaignSummary, type GapAnalysis,
} from '../lib/api'

// Shown on Audit / Build / Outreach when no lead is selected: pick a campaign, then one of its saved leads.
// Leads Graph8 already enriched open with that data straight away; the rest are enriched when opened.

interface Props {
  title: string
  subtitle: string
  initialCampaignId?: string | null
  onPick: (campaign: Campaign, lead: CampaignLead) => void
  onNewCampaign: () => void
}

const fitClass = (n: number) => (n >= 70 ? 'good' : n >= 40 ? 'fair' : 'poor')

const LeadPicker: FC<Props> = ({ title, subtitle, initialCampaignId, onPick, onNewCampaign }) => {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId ?? null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [leads, setLeads] = useState<CampaignLead[] | null>(null)
  const [gaps, setGaps] = useState<Record<string, GapAnalysis>>({})
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    listCampaigns()
      .then(r => {
        setCampaigns(r.campaigns)
        setCampaignId(id => (id && r.campaigns.some(c => c.id === id) ? id : r.campaigns[0]?.id ?? null))
      })
      .catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    setLeads(null)
    setError('')
    Promise.all([getCampaign(campaignId), listGapAnalyses(campaignId).catch(() => ({ analyses: [] as GapAnalysis[] }))])
      .then(([detail, g]) => {
        if (cancelled) return
        setCampaign(detail.campaign)
        setLeads(detail.leads)
        setGaps(Object.fromEntries(g.analyses.map(a => [a.leadId, a])))
      })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [campaignId])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = leads ?? []
    const filtered = q ? list.filter(l => `${l.name} ${l.city} ${l.site} ${l.type}`.toLowerCase().includes(q)) : list
    // Leads with research first (best fit on top), then enriched ones, then the rest.
    return [...filtered].sort((a, b) =>
      (gaps[b.id]?.result.prospect.fitScore ?? -1) - (gaps[a.id]?.result.prospect.fitScore ?? -1)
      || Number(!!b.enrichment) - Number(!!a.enrichment))
  }, [leads, gaps, query])

  const enrichedCount = (leads ?? []).filter(l => l.enrichment).length

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{subtitle}</div>
        </div>
        {!!campaigns?.length && (
          <div className="page-header-actions an-actions">
            <select className="input an-select" value={campaignId ?? ''} onChange={e => setCampaignId(e.target.value || null)} aria-label="Campaign">
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.leadCount}){c.mine ? '' : ` · ${c.username}`}</option>)}
            </select>
          </div>
        )}
      </header>

      {error && <div className="settings-alert">{error}</div>}

      {campaigns && !campaigns.length && (
        <div className="an-callout">
          <div className="an-callout-title">No campaigns yet</div>
          <div className="text-muted">Search for leads in Discover, or create a campaign. Every search saves its leads to a campaign, and they appear here.</div>
          <button className="btn-primary" onClick={onNewCampaign}>Create a campaign</button>
        </div>
      )}

      {(!campaigns || (campaignId && !leads)) && !error && <p className="text-muted"><span className="pulse">Loading…</span></p>}

      {campaign && leads && (
        <>
          <div className="picker-toolbar">
            <input
              className="input picker-search"
              placeholder={`Search ${leads.length} lead${leads.length === 1 ? '' : 's'} in ${campaign.name}`}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <span className="text-muted picker-count">
              {enrichedCount} of {leads.length} enriched by Graph8 · {Object.keys(gaps).length} with gap analysis
            </span>
          </div>

          {!leads.length && (
            <div className="an-callout">
              <div className="an-callout-title">No saved leads in this campaign</div>
              <div className="text-muted">Search in the campaign first; every lead the search finds is saved here.</div>
            </div>
          )}

          {leads.length > 0 && (
            <ul className="picker-list">
              {shown.map(l => {
                const g = gaps[l.id]
                return (
                  <li key={l.id}>
                    <button className="picker-item" onClick={() => onPick(campaign, l)}>
                      <span className="picker-score" style={{ color: l.color }}>{l.score}</span>
                      <span className="picker-main">
                        <span className="picker-name">{l.name}</span>
                        <span className="picker-meta">{l.type} · {l.city} · {l.site || 'no website'}</span>
                      </span>
                      <span className="picker-badges">
                        {l.enrichment
                          ? <span className="settings-badge ok" title="Company, decision maker and email already looked up">Graph8 enriched</span>
                          : <span className="settings-badge" title="Graph8 will look it up when you open it">Not enriched</span>}
                        {g && <span className={`gap-fit ${fitClass(g.result.prospect.fitScore)}`} title="Gap analysis fit score">{g.result.prospect.fitScore}</span>}
                      </span>
                      <span className="picker-open" aria-hidden>Open ›</span>
                    </button>
                  </li>
                )
              })}
              {!shown.length && <li className="an-empty">No leads match “{query}”.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default LeadPicker
