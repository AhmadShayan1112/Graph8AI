import { useEffect, useState, type FC } from 'react'
import {
  getCampaignAnalysis, listCampaigns, refreshCampaignAnalysis,
  type BreakdownOption, type CampaignAnalysis, type CampaignSummary,
} from '../lib/api'
import { useSession } from '../components/LoginGate'

interface Props {
  campaignId: string | null
  onCampaignId: (id: string | null) => void
  onOpenCampaign: (id: string) => void
  onNewCampaign: () => void
}

const fmt = (n: number) => n.toLocaleString()
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

const BREAKDOWNS: Array<{ field: string; title: string; note: string }> = [
  { field: 'employee_count', title: 'Company size', note: 'Employees' },
  { field: 'revenue', title: 'Revenue', note: 'Annual revenue band' },
  { field: 'city', title: 'Top cities', note: 'Where the market is' },
  { field: 'industry', title: 'Top industries', note: 'How Graph8 labels them' },
]

// One series, magnitude only: a single accent hue, values in text, a tooltip on each bar.
const BarList: FC<{ items: Array<{ label: string; count: number }>; total: number; empty: string }> = ({ items, total, empty }) => {
  if (!items.length) return <div className="an-empty">{empty}</div>
  const max = Math.max(...items.map(i => i.count), 1)
  return (
    <ul className="an-bars">
      {items.map(i => (
        <li key={i.label} className="an-bar-row" title={`${i.label}: ${fmt(i.count)}${total ? ` (${pct(i.count, total)}%)` : ''}`}>
          <span className="an-bar-label">{i.label}</span>
          <span className="an-bar-track"><span className="an-bar-fill" style={{ width: `${Math.max((i.count / max) * 100, 1.5)}%` }} /></span>
          <span className="an-bar-value mono">{fmt(i.count)}{total ? <span className="an-bar-pct"> {pct(i.count, total)}%</span> : null}</span>
        </li>
      ))}
    </ul>
  )
}

const AnalysisPage: FC<Props> = ({ campaignId, onCampaignId, onOpenCampaign, onNewCampaign }) => {
  const { user } = useSession()
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [data, setData] = useState<CampaignAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listCampaigns().then(r => {
      setCampaigns(r.campaigns)
      // Default to the most recently used campaign.
      if (!campaignId && r.campaigns.length) onCampaignId(r.campaigns[0].id)
    }).catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!campaignId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    setError('')
    getCampaignAnalysis(campaignId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) { setData(null); setError(err.message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [campaignId])

  const refresh = async () => {
    if (!campaignId) return
    setRefreshing(true)
    setError('')
    try {
      setData(await refreshCampaignAnalysis(campaignId))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  const canRefresh = user.permissions.graph8
  const m = data?.market
  const l = data?.leads
  const hasTarget = !!data && (data.campaign.target.industries.length > 0 || data.campaign.target.locations.length > 0)

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Analysis</div>
          <h1 className="page-title">{data?.campaign.name ?? 'Campaign analysis'}</h1>
          <div className="page-subtitle">
            The campaign's target market from Graph8, and how far your saved leads cover it.
          </div>
        </div>
        {!!campaigns?.length && (
          <div className="page-header-actions an-actions">
            <select
              className="input an-select"
              value={campaignId ?? ''}
              onChange={e => onCampaignId(e.target.value || null)}
              aria-label="Campaign"
            >
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.mine ? '' : ` (${c.username})`}</option>)}
            </select>
            <button
              className="btn-accent"
              onClick={refresh}
              disabled={!campaignId || refreshing || !canRefresh || !hasTarget}
              title={!canRefresh ? 'Lead search with Graph8 is turned off for your account' : ''}
            >
              {refreshing ? 'Analysing…' : m ? 'Refresh from Graph8' : 'Run analysis'}
            </button>
          </div>
        )}
      </header>

      {error && <div className="settings-alert">{error}</div>}

      {campaigns && !campaigns.length && (
        <div className="an-callout">
          <div className="an-callout-title">No campaigns yet</div>
          <div className="text-muted">Create a campaign with a target industry and location, then analyse its market here.</div>
          <button className="btn-primary" onClick={onNewCampaign}>Create a campaign</button>
        </div>
      )}

      {(loading || (!campaigns && !error)) && <p className="text-muted"><span className="pulse">Loading…</span></p>}

      {data && !loading && (
        <>
          <div className="an-target">
            {data.campaign.target.industries.map(x => <span key={`i${x}`} className="active-chip">{x}</span>)}
            {data.campaign.target.locations.map(x => <span key={`l${x.value}`} className="active-chip">{x.value}</span>)}
            {!hasTarget && <span className="text-muted">This campaign has no target yet.</span>}
            <button className="back-link an-open" onClick={() => onOpenCampaign(data.campaign.id)}>Open campaign →</button>
          </div>

          {!hasTarget && (
            <div className="an-callout">
              <div className="an-callout-title">Add a target to analyse</div>
              <div className="text-muted">The analysis sizes the market for the campaign's industries and locations. Edit the campaign to add them.</div>
              <button className="btn-primary" onClick={() => onOpenCampaign(data.campaign.id)}>Edit campaign</button>
            </div>
          )}

          {hasTarget && !m && (
            <div className="an-callout">
              <div className="an-callout-title">Market not analysed yet</div>
              <div className="text-muted">
                Run the analysis to size this market with Graph8: how many businesses match, how many have no website,
                and how they split by size, revenue, city and industry.
              </div>
              {!canRefresh && <div className="settings-message bad">Lead search with Graph8 is turned off for your account. Ask the admin to enable it.</div>}
            </div>
          )}

          {m && (
            <>
              <section className="an-tiles">
                <div className="an-tile an-tile-hero">
                  <div className="an-tile-label">Market size</div>
                  <div className="an-tile-value">{fmt(m.total)}</div>
                  <div className="an-tile-note">businesses match this target in Graph8</div>
                </div>
                <div className="an-tile">
                  <div className="an-tile-label">No website</div>
                  <div className="an-tile-value">{fmt(m.noWebsite)}</div>
                  <div className="an-tile-note">{pct(m.noWebsite, m.total)}% of the market · strongest leads</div>
                </div>
                <div className="an-tile">
                  <div className="an-tile-label">Have a phone number</div>
                  <div className="an-tile-value">{fmt(m.withPhone)}</div>
                  <div className="an-tile-note">{pct(m.withPhone, m.total)}% reachable by phone</div>
                </div>
                <div className="an-tile">
                  <div className="an-tile-label">Saved in campaign</div>
                  <div className="an-tile-value">{fmt(l!.saved)}</div>
                  <div className="an-tile-note">{m.total ? `${pct(l!.saved, m.total) || '<1'}% of the market covered` : 'no market to cover'}</div>
                  <div className="an-meter" aria-hidden><span style={{ width: `${Math.min(pct(l!.saved, m.total), 100)}%` }} /></div>
                </div>
              </section>

              <section className="an-insights">
                <div className="an-section-title">What this means</div>
                <ul>
                  {m.total === 0 && <li>Graph8 found no businesses for this target. Try a broader industry or location.</li>}
                  {m.total > 0 && m.noWebsite > 0 && (
                    <li><strong>{pct(m.noWebsite, m.total)}%</strong> of this market ({fmt(m.noWebsite)} businesses) has no website: a ready audience for a first site or booking page.</li>
                  )}
                  {m.total > 0 && m.noWebsite === 0 && <li>Every business here has a website, so pitch improvements (speed, booking, lead capture) rather than a first site.</li>}
                  {m.total > 0 && <li><strong>{pct(m.withPhone, m.total)}%</strong> list a phone number, so a call or SMS can follow the email.</li>}
                  {m.total > 0 && l!.saved < m.total && (
                    <li>You have saved <strong>{fmt(l!.saved)}</strong> of <strong>{fmt(m.total)}</strong>. {fmt(m.total - l!.saved)} more businesses in this market are still to reach.</li>
                  )}
                  {m.breakdowns.city?.[0] && m.total > 0 && (
                    <li>The biggest cluster is <strong>{m.breakdowns.city[0].label}</strong> with {fmt(m.breakdowns.city[0].count)} businesses.</li>
                  )}
                  {m.filtersUsed.industryField === 'description' && (
                    <li>Graph8 has no exact industry label for “{m.filtersUsed.industries.join(', ')}”, so these numbers match company descriptions instead.</li>
                  )}
                </ul>
              </section>

              <section className="an-grid">
                {BREAKDOWNS.map(b => (
                  <div key={b.field} className="an-card">
                    <div className="an-card-head">
                      <span className="an-section-title">{b.title}</span>
                      <span className="an-card-note">{b.note}</span>
                    </div>
                    <BarList
                      items={(m.breakdowns[b.field] ?? []) as BreakdownOption[]}
                      total={m.total}
                      empty="Graph8 returned no breakdown for this field."
                    />
                  </div>
                ))}
              </section>
            </>
          )}

          <section className="an-grid">
            <div className="an-card">
              <div className="an-card-head">
                <span className="an-section-title">Saved lead health</span>
                <span className="an-card-note">{fmt(l!.saved)} leads · {data.searchCount} searches</span>
              </div>
              {l!.saved ? (
                <>
                  <div className="an-stack" role="img" aria-label={`Poor ${l!.scores.poor}, fair ${l!.scores.fair}, good ${l!.scores.good}`}>
                    {(['poor', 'fair', 'good'] as const).map(k => l!.scores[k] > 0 && (
                      <span key={k} className={`an-stack-seg ${k}`} style={{ flexGrow: l!.scores[k] }} title={`${k}: ${l!.scores[k]}`} />
                    ))}
                  </div>
                  <ul className="an-legend">
                    <li><span className="an-dot poor" />Poor (under 40) <strong>{l!.scores.poor}</strong></li>
                    <li><span className="an-dot fair" />Fair (40–69) <strong>{l!.scores.fair}</strong></li>
                    <li><span className="an-dot good" />Good (70+) <strong>{l!.scores.good}</strong></li>
                  </ul>
                  <div className="an-mini-stats">
                    <div><span className="mono">{l!.noWebsite}</span> without a website</div>
                    <div><span className="mono">{l!.enriched}</span> enriched</div>
                    <div><span className="mono">{l!.verifiedEmail}</span> verified emails</div>
                  </div>
                </>
              ) : (
                <div className="an-empty">No saved leads yet. Search in this campaign to save some.</div>
              )}
            </div>
            <div className="an-card">
              <div className="an-card-head">
                <span className="an-section-title">Most common gaps</span>
                <span className="an-card-note">Across saved leads</span>
              </div>
              <BarList items={l!.topGaps} total={l!.saved} empty="Gaps appear once the campaign has saved leads." />
            </div>
          </section>

          {m && (
            <div className="an-foot text-muted">
              Market data from Graph8, updated {new Date(m.computedAt).toLocaleString()} by {m.computedBy}.
              Refreshing runs a few Graph8 searches.
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AnalysisPage
