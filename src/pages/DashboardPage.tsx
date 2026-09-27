import { useEffect, useState, type FC } from 'react'
import { getDashboard, type Dashboard, type LeadTemperature, type Temp } from '../lib/api'
import { useSession } from '../components/LoginGate'
import { OFFER_LABEL } from '../lib/offers'
import { BarChart, Donut, Funnel, HBars, SERIES } from '../components/Charts'

interface Props {
  onNavigate: (page: string) => void
  onOpenCampaign: (id: string | null) => void
  onOpenGaps: (campaignId: string) => void
  onOpenSearch: (searchId: string) => void
}


function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const fitClass = (n: number) => (n >= 70 ? 'good' : n >= 40 ? 'fair' : 'poor')

const DashboardPage: FC<Props> = ({ onNavigate, onOpenCampaign, onOpenGaps, onOpenSearch }) => {
  const { user } = useSession()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getDashboard().then(setData).catch(err => setError(err.message))
  }, [])

  const t = data?.totals
  const isAdmin = user.role === 'admin'

  // What to do next, in the order the product works. Key steps only matter to the admin, who sets them.
  const steps = data ? [
    ...(isAdmin && data.keys ? [
      { done: data.keys.graph8, label: 'Add the Graph8 API key', hint: 'Needed to find and enrich leads', go: () => onNavigate('settings') },
      { done: data.keys.gemini, label: 'Add the Gemini API key', hint: 'Needed for gap analysis', go: () => onNavigate('settings') },
      { done: data.keys.claude, label: 'Add the Claude token', hint: 'Needed to build MVP sites', go: () => onNavigate('settings') },
    ] : []),
    { done: t!.campaigns > 0, label: 'Create a campaign', hint: 'Pick an industry and a location', go: () => onOpenCampaign(null) },
    { done: t!.leads > 0, label: 'Find leads for it', hint: 'Search inside the campaign', go: () => onNavigate('campaigns') },
    { done: t!.gapAnalyses > 0, label: 'Run a gap analysis', hint: 'Research what each lead is missing', go: () => onNavigate('gaps') },
    { done: t!.sites > 0, label: 'Build and deploy an MVP', hint: 'Send the lead a working page', go: () => onNavigate('build') },
  ] : []
  // Headline numbers, each with a line of context from data the dashboard already has.
  const weekly = data?.charts?.weekly ?? []
  const thisWeek = weekly[weekly.length - 1]?.count ?? 0
  const mvpsBuilt = data?.charts?.funnel.find(f => f.stage === 'MVPs built')?.count ?? 0
  const analysedPct = t && t.leads ? Math.round((t.gapAnalyses / t.leads) * 100) : 0
  const metrics = t ? [
    { label: 'Campaigns', value: t.campaigns, go: () => onNavigate('campaigns'), tone: 'blue', note: t.campaigns ? 'Open your campaigns' : 'Create your first one', good: false,
      icon: <><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></> },
    { label: 'Saved leads', value: t.leads, go: () => onNavigate('campaigns'), tone: 'green', note: thisWeek ? `+${thisWeek} this week` : 'None added this week', good: thisWeek > 0,
      icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M17 8v6M14 11h6" /></> },
    { label: 'Searches run', value: t.searches, go: () => onNavigate('history'), tone: 'violet', note: 'See search history', good: false,
      icon: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></> },
    { label: 'Gap analyses', value: t.gapAnalyses, go: () => onNavigate('gaps'), tone: 'amber', note: t.leads ? `${analysedPct}% of leads analysed` : 'Analyse your leads', good: analysedPct >= 50,
      icon: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /></> },
    { label: 'Sites live', value: t.sites, go: () => onNavigate('pipeline'), tone: 'rose', note: `${mvpsBuilt} MVP${mvpsBuilt === 1 ? '' : 's'} built`, good: false,
      icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></> },
  ] : []

  const doneCount = steps.filter(s => s.done).length
  const allDone = steps.length > 0 && doneCount === steps.length

  // One timeline from searches and deployed sites, newest first.
  const activity = data ? [
    ...data.recentSearches.map(s => ({
      at: s.createdAt,
      kind: 'search' as const,
      title: s.prompt || [s.filters.industries?.join(', '), s.filters.locations?.map(l => l.value).join(', ')].filter(Boolean).join(' in ') || 'Lead search',
      detail: `${s.leadCount} leads saved${s.campaignName ? ` to ${s.campaignName}` : ''}${!s.mine ? `, by ${s.username}` : ''}`,
      open: () => onOpenSearch(s.id),
    })),
    ...data.sites.map(s => ({
      at: s.updatedAt,
      kind: 'site' as const,
      title: `${s.leadName}`,
      detail: `${OFFER_LABEL[s.mvpType] ?? s.mvpType.replace(/-/g, ' ')} deployed`,
      open: () => window.open(`${window.location.origin}/${s.slug}`, '_blank', 'noopener,noreferrer'),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 7) : []

  return (
    <div className="page-content fade-in dash">
      <header className="page-header">
        <div className="page-header-text">
          <div className="dash-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="page-title dash-title">{greeting()}, {user.username}</h1>
          <div className="page-subtitle">
            {!data ? 'Loading your pipeline…'
              : t!.campaigns === 0 ? 'Start with a campaign: choose who you want to sell to, then let Gapwise find them.'
              : `${t!.leads.toLocaleString()} saved leads across ${t!.campaigns} campaign${t!.campaigns === 1 ? '' : 's'}${data.scope === 'workspace' ? ' in the workspace' : ''}.`}
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn-secondary" onClick={() => onNavigate('discover')}>Search leads</button>
          <button className="btn-primary" onClick={() => onOpenCampaign(null)}>New campaign</button>
        </div>
      </header>

      {error && <div className="settings-alert">{error}</div>}

      {data && (
        <>
          <section className="dash-metrics" aria-label="Totals" data-tour="dash-stats">
            {metrics.map(m => (
              <button key={m.label} className="dash-metric" onClick={m.go}>
                <span className={`dash-metric-icon ${m.tone}`} aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{m.icon}</svg>
                </span>
                <span className="dash-metric-label">{m.label}</span>
                <span className="dash-metric-value">{m.value.toLocaleString()}</span>
                <span className={`dash-metric-note ${m.good ? 'good' : ''}`}>{m.note}</span>
              </button>
            ))}
          </section>

          <div className="dash-layout">
            <div className="dash-main">
              {data.charts && (data.temperature?.total ?? 0) > 0 && (
                <ChartsPanel d={data} onOpenCampaign={onOpenCampaign} />
              )}

              {data.temperature && data.temperature.total > 0 && (
                <TemperaturePanel t={data.temperature} onNavigate={onNavigate} onOpenGaps={onOpenGaps} />
              )}
                <section className="dash-panel dash-prospects">
                  <div className="dash-panel-head">
                    <h2>Top prospects</h2>
                    <button className="dash-link" onClick={() => onNavigate('gaps')}>Gap analysis</button>
                  </div>
                  {data.topProspects.length ? (
                    <ul className="dash-list">
                      {data.topProspects.map(p => (
                        <li key={`${p.campaignId}-${p.leadId}`}>
                          <button className="dash-row" onClick={() => onOpenGaps(p.campaignId)}>
                            <span className={`gap-fit ${fitClass(p.fitScore)}`} title="Fit score">{p.fitScore}</span>
                            <span className="dash-row-main">
                              <span className="dash-row-title">{p.leadName}</span>
                              <span className="dash-row-sub">{p.topGap || 'No major gap found'}{p.campaignName && ` · ${p.campaignName}`}</span>
                            </span>
                            <span className="dash-tag">{OFFER_LABEL[p.offer] ?? p.offer}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="dash-empty">
                      <p>Prospects appear here once you run a gap analysis. Gapwise ranks them by how likely they are to buy.</p>
                      <button className="btn-secondary" onClick={() => onNavigate('gaps')}>Open gap analysis</button>
                    </div>
                  )}
                </section>
                <section className="dash-panel dash-campaigns">
                  <div className="dash-panel-head">
                    <h2>Campaigns</h2>
                    <button className="dash-link" onClick={() => onNavigate('campaigns')}>See all</button>
                  </div>
                  {data.campaigns.length ? (
                    <ul className="dash-list">
                      {data.campaigns.map(c => {
                        const target = [c.target.industries.join(', '), c.target.locations.map(l => l.value).join(', ')].filter(Boolean).join(' in ')
                        return (
                          <li key={c.id}>
                            <button className="dash-row" onClick={() => onOpenCampaign(c.id)}>
                              <span className="dash-row-main">
                                <span className="dash-row-title">{c.name}</span>
                                <span className="dash-row-sub">{target || 'No target set'}{!c.mine && ` · ${c.username}`}</span>
                              </span>
                              <span className="dash-row-num">
                                <strong>{c.leadCount}</strong> leads
                                <span>{c.lastSearchAt ? ago(c.lastSearchAt) : 'no searches yet'}</span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="dash-empty">
                      <p>No campaigns yet. A campaign groups your searches and saved leads for one goal, like “Dentists in Lahore”.</p>
                      <button className="btn-primary" onClick={() => onOpenCampaign(null)}>Create a campaign</button>
                    </div>
                  )}
                </section>
            </div>
            <aside className="dash-rail">
                <section className="dash-panel dash-setup">
                  <div className="dash-panel-head">
                    <h2>{allDone ? 'You are all set' : 'Getting started'}</h2>
                    <span className="dash-count">{doneCount}/{steps.length}</span>
                  </div>
                  <div className="dash-meter" aria-hidden><span style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} /></div>
                  <ol className="dash-steps">
                    {steps.map(s => (
                      <li key={s.label}>
                        <button className={`dash-step ${s.done ? 'done' : ''}`} onClick={s.go}>
                          <span className="dash-step-mark" aria-hidden>{s.done ? '✓' : ''}</span>
                          <span className="dash-row-main">
                            <span className="dash-row-title">{s.label}</span>
                            {!s.done && <span className="dash-row-sub">{s.hint}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {!isAdmin && (
                    <div className="dash-access">
                      Your access:
                      {(['graph8', 'gemini', 'claude'] as const).map(k => (
                        <span key={k} className={`settings-badge ${user.permissions[k] ? 'ok' : ''}`}>
                          {k === 'graph8' ? 'Graph8' : k === 'gemini' ? 'Gap analysis' : 'Claude'} {user.permissions[k] ? 'on' : 'off'}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
                <section className="dash-panel dash-activity">
                  <div className="dash-panel-head">
                    <h2>Recent activity</h2>
                    <button className="dash-link" onClick={() => onNavigate('history')}>History</button>
                  </div>
                  {activity.length ? (
                    <ul className="dash-timeline">
                      {activity.map((a, i) => (
                        <li key={i}>
                          <button className="dash-event" onClick={a.open}>
                            <span className={`dash-dot ${a.kind}`} aria-hidden />
                            <span className="dash-row-main">
                              <span className="dash-row-title">{a.kind === 'search' ? `Searched ${a.title}` : `Deployed ${a.title}`}</span>
                              <span className="dash-row-sub">{a.detail}</span>
                            </span>
                            <span className="dash-when">{ago(a.at)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="dash-empty"><p>Searches and deployed sites will show up here.</p></div>
                  )}
                </section>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

export default DashboardPage

const TEMP: Record<Temp, { label: string; next: string; action: string; page: string }> = {
  hot: { label: 'Hot', next: 'Strong fit and a way to reach them. Contact these first.', action: 'Write outreach', page: 'outreach' },
  warm: { label: 'Warm', next: 'Promising but missing evidence. Run gap analysis or enrich them.', action: 'Run gap analysis', page: 'gaps' },
  cold: { label: 'Cold', next: 'Little to go on yet. Enrich them, or keep them for later.', action: 'Audit leads', page: 'audit' },
}

const TemperaturePanel: FC<{ t: LeadTemperature; onNavigate: (p: string) => void; onOpenGaps: (id: string) => void }> = ({ t, onNavigate, onOpenGaps }) => {
  const [showHow, setShowHow] = useState(false)
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0)
  const temps: Temp[] = ['hot', 'warm', 'cold']
  return (
    <section className="dash-panel temp-panel" aria-label="Lead temperature">
      <div className="dash-panel-head">
        <div>
          <h2>Lead temperature</h2>
          <div className="dash-row-sub">{t.total.toLocaleString()} saved leads scored from their fit, contact details and website gaps</div>
        </div>
        <button className="dash-link" onClick={() => setShowHow(v => !v)} aria-expanded={showHow}>{showHow ? 'Hide scoring' : 'How it’s scored'}</button>
      </div>

      {showHow && (
        <div className="temp-how">
          Points: gap-analysis fit ÷ 2 (up to 50), verified email 20, named decision maker 10, phone 5, no website 15
          (or a weak site 10, a fair one 5). <strong>Hot</strong> 55+, <strong>warm</strong> 30–54, <strong>cold</strong> under 30.
        </div>
      )}

      <div className="temp-grid">
        <div className="temp-cards">
          <Donut
            centerLabel="saved leads"
            slices={[
              { label: 'Hot', value: t.hot, color: '#E5484D' },
              { label: 'Warm', value: t.warm, color: '#E09B1A' },
              { label: 'Cold', value: t.cold, color: '#5B7FB8' },
            ]}
          />
          {temps.map(k => (
            <div key={k} className={`temp-card ${k}`}>
              <div className="temp-card-top">
                <span className={`temp-dot ${k}`} aria-hidden />
                <span className="temp-card-label">{TEMP[k].label}</span>
                <span className="temp-card-count">{t[k].toLocaleString()}</span>
                <span className="temp-card-pct">{pct(t[k])}%</span>
              </div>
              <p>{TEMP[k].next}</p>
              {t[k] > 0 && <button className="dash-link" onClick={() => onNavigate(TEMP[k].page)}>{TEMP[k].action}</button>}
            </div>
          ))}
          {(t.notAnalysed > 0 || t.notEnriched > 0) && (
            <div className="temp-nudge">
              {t.notAnalysed > 0 && <span><strong>{t.notAnalysed}</strong> leads have no gap analysis yet, so their fit is unknown. </span>}
              {t.notEnriched > 0 && <span><strong>{t.notEnriched}</strong> aren’t enriched, so contact details are missing. </span>}
              <button className="dash-link" onClick={() => onNavigate('gaps')}>Analyse leads</button>
            </div>
          )}
        </div>

        <div className="temp-hot-list">
          <div className="temp-sub-head">Hottest leads</div>
          {t.hottest.length ? (
            <ul className="dash-list">
              {t.hottest.map(l => (
                <li key={`${l.campaignId}-${l.leadId}`}>
                  <button className="dash-row" onClick={() => onOpenGaps(l.campaignId)}>
                    <span className={`temp-points ${l.temp}`} title={`${TEMP[l.temp].label}, ${l.points} points`}>{l.points}</span>
                    <span className="dash-row-main">
                      <span className="dash-row-title">{l.name}</span>
                      <span className="temp-reasons">
                        {l.reasons.slice(0, 4).map(r => <span key={r}>{r}</span>)}
                      </span>
                    </span>
                    <span className="dash-row-num"><span>{l.campaignName}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty"><p>No hot or warm leads yet. Run gap analysis and enrich leads to find them.</p></div>
          )}
        </div>
      </div>

      {t.byCampaign.length > 1 && (
        <div className="temp-campaigns">
          <div className="temp-sub-head">By campaign</div>
          {t.byCampaign.map(c => {
            const total = c.hot + c.warm + c.cold
            return (
              <div key={c.id} className="temp-campaign-row">
                <span className="temp-campaign-name">{c.name}</span>
                <span className="temp-mini" role="img" aria-label={`Hot ${c.hot}, warm ${c.warm}, cold ${c.cold}`}>
                  {temps.map(k => c[k] > 0 && <span key={k} className={`temp-seg ${k}`} style={{ flexGrow: c[k] }} />)}
                </span>
                <span className="temp-campaign-nums"><b className="hot">{c.hot}</b> / <b className="warm">{c.warm}</b> / {c.cold} of {total}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const shortWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Charts: momentum (leads per week), the pipeline, what leads need, and the biggest campaigns.
const ChartsPanel: FC<{ d: Dashboard; onOpenCampaign: (id: string | null) => void }> = ({ d, onOpenCampaign }) => {
  const c = d.charts!
  const weekTotal = c.weekly.reduce((s, w) => s + w.count, 0)
  const thisWeek = c.weekly[c.weekly.length - 1]?.count ?? 0
  const lastWeek = c.weekly[c.weekly.length - 2]?.count ?? 0
  const offers = d.temperature?.offers ?? []
  const top = offers.slice(0, 4)
  const other = offers.slice(4).reduce((s, o) => s + o.count, 0)
  const offerSlices = [
    ...top.map((o, i) => ({ label: OFFER_LABEL[o.offer] ?? o.offer, value: o.count, color: SERIES[i] })),
    ...(other ? [{ label: 'Other', value: other, color: '#b5b3ad' }] : []),
  ]
  return (
    <section className="dash-charts" aria-label="Charts">
      <div className="dash-panel chart-card">
        <div className="dash-panel-head">
          <div>
            <h2>Leads saved per week</h2>
            <div className="dash-row-sub">{weekTotal.toLocaleString()} in the last 8 weeks · this week {thisWeek}{lastWeek ? ` (${thisWeek >= lastWeek ? '+' : ''}${thisWeek - lastWeek} vs last week)` : ''}</div>
          </div>
        </div>
        <BarChart unit="leads saved" data={c.weekly.map(w => ({ label: shortWeek(w.week), value: w.count, title: `Week of ${shortWeek(w.week)}` }))} />
      </div>

      <div className="dash-panel chart-card">
        <div className="dash-panel-head">
          <div>
            <h2>Pipeline</h2>
            <div className="dash-row-sub">How far your leads have come; % made it from the step before</div>
          </div>
        </div>
        <Funnel stages={c.funnel} />
      </div>

      <div className="dash-panel chart-card">
        <div className="dash-panel-head">
          <div>
            <h2>What your leads need</h2>
            <div className="dash-row-sub">Solutions recommended by gap analysis</div>
          </div>
        </div>
        {offerSlices.length ? <Donut slices={offerSlices} centerLabel="analysed leads" /> : (
          <div className="dash-empty"><p>Run gap analysis on your leads to see which solutions they need most.</p></div>
        )}
      </div>

      <div className="dash-panel chart-card">
        <div className="dash-panel-head">
          <div>
            <h2>Leads by campaign</h2>
            <div className="dash-row-sub">Your largest campaigns</div>
          </div>
        </div>
        {c.campaignLeads.length ? (
          <HBars data={c.campaignLeads.map(x => ({ label: x.name, value: x.count }))} onClick={i => onOpenCampaign(c.campaignLeads[i].id)} />
        ) : <div className="dash-empty"><p>No campaigns yet.</p></div>}
      </div>
    </section>
  )
}
