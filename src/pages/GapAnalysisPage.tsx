import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import {
  getCampaign, listCampaigns, listGapAnalyses,
  type Campaign, type CampaignLead, type CampaignSummary, type GapAnalysis, type GapLevel, type GapStage,
} from '../lib/api'
import {
  averageMs, dismissPaused, formatDuration as seconds, leadPercent, overallPercent, resumeRun, startRun, stopRun,
  useGapRunner, type Phase,
} from '../lib/gapRunner'
import { useSession } from '../components/LoginGate'
import { buildLeadReport, openReportWindow, showReport } from '../lib/report'
import { confirmDialog } from '../components/Dialog'
import { OFFER_LABEL } from '../lib/offers'

interface Props {
  campaignId: string | null
  onCampaignId: (id: string | null) => void
  onBuild: (c: Campaign, lead: CampaignLead, mvpType: string) => void
  onAudit: (c: Campaign, lead: CampaignLead) => void
  onNewCampaign: () => void
}

const LEVEL_LABEL: Record<GapLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' }

const STEPS: Array<{ key: GapStage; label: string }> = [
  { key: 'graph8', label: 'Reading the Graph8 company record' },
  { key: 'research', label: 'Researching the business on the web' },
  { key: 'saving', label: 'Writing the gaps and prospect profile' },
]

const fitClass = (n: number) => (n >= 70 ? 'good' : n >= 40 ? 'fair' : 'poor')

const GapAnalysisPage: FC<Props> = ({ campaignId, onCampaignId, onBuild, onAudit, onNewCampaign }) => {
  const { user } = useSession()
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [leads, setLeads] = useState<CampaignLead[]>([])
  const [savedResults, setResults] = useState<Record<string, GapAnalysis>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  // Runs live in the app-wide runner, so they continue while this page is closed.
  const run = useGapRunner()
  const active = !!run.current || run.queue.length > 0 || !!run.retry
  const mine = !!campaign && run.campaignId === campaign.id
  const progress = mine ? run.current : null
  const running = progress?.leadId ?? null
  const batch = mine && active && run.total > 1 ? { done: run.done, total: run.total } : null
  const paused = run.paused && campaign && run.paused.campaignId === campaign.id ? run.paused : null
  // Saved analyses plus any the runner finished while this page was open or closed.
  const results = useMemo(() => {
    if (!campaign) return savedResults
    const prefix = `${campaign.id}:`
    const fresh = Object.fromEntries(Object.entries(run.results).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]))
    return { ...savedResults, ...fresh }
  }, [savedResults, run.results, campaign])

  const canRun = user.permissions.gemini

  useEffect(() => {
    if (!run.current && !run.retry) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [run.current, run.retry])

  // During "Analyse all", keep the lead being researched on screen.
  useEffect(() => {
    if (batch && progress) setSelected(progress.leadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.leadId])

  useEffect(() => {
    listCampaigns().then(r => {
      setCampaigns(r.campaigns)
      if (!campaignId && r.campaigns.length) onCampaignId(r.campaigns[0].id)
    }).catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSelected(null)
    Promise.all([getCampaign(campaignId), listGapAnalyses(campaignId)])
      .then(([detail, gaps]) => {
        if (cancelled) return
        setCampaign(detail.campaign)
        setLeads(detail.leads)
        setResults(Object.fromEntries(gaps.analyses.map(a => [a.leadId, a])))
        setSelected(gaps.analyses[0]?.leadId ?? detail.leads[0]?.id ?? null)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [campaignId])

  const analyseOne = (lead: CampaignLead) => {
    if (!campaign) return
    setSelected(lead.id)
    startRun(campaign, [lead])
  }

  // One lead at a time: each is a web-research call, and a sequence keeps within the rate limits.
  const analyseAll = async () => {
    if (!campaign) return
    const todo = leads.filter(l => !results[l.id])
    if (!todo.length) return
    if (!(await confirmDialog({
      title: `Analyse ${todo.length} lead${todo.length > 1 ? 's' : ''}?`,
      message: `Gapwise researches each lead on the web, one at a time, which takes up to a minute per lead${todo.length > 1 ? ` (about ${Math.ceil(todo.length * 0.75)} min in total)` : ''}. You can keep using Gapwise while it runs; progress shows in the sidebar.`,
      confirmLabel: 'Start analysis',
      tone: 'info',
    }))) return
    startRun(campaign, todo)
  }

  const analysed = leads.filter(l => results[l.id])
  const avgMs = averageMs(run)
  const leadPct = progress ? leadPercent(progress, now, avgMs || 30_000) : 0
  const overallPct = batch ? overallPercent(run, now) : 0
  const timeLeft = batch && avgMs && progress
    ? Math.max(0, avgMs * (batch.total - batch.done) - (now - progress.startedAt))
    : null
  const avgFit = analysed.length
    ? Math.round(analysed.reduce((s, l) => s + results[l.id].result.prospect.fitScore, 0) / analysed.length)
    : null
  const highGaps = analysed.reduce((s, l) => s + results[l.id].result.gaps.filter(g => g.severity === 'high').length, 0)
  const offerCounts = new Map<string, number>()
  for (const l of analysed) {
    const o = results[l.id].result.prospect.recommendedOffer
    offerCounts.set(o, (offerCounts.get(o) ?? 0) + 1)
  }
  const topOffer = [...offerCounts].sort((a, b) => b[1] - a[1])[0]?.[0]

  // Best prospects first once analysed; the rest keep their saved order.
  const ordered = [...leads].sort((a, b) =>
    (results[b.id]?.result.prospect.fitScore ?? -1) - (results[a.id]?.result.prospect.fitScore ?? -1))
  const lead = leads.find(l => l.id === selected) ?? null
  const gap = lead ? results[lead.id] : undefined

  const select = (id: string) => {
    setSelected(id)
    // On phones the detail sits below the list, so bring it into view.
    if (window.matchMedia('(max-width: 1024px)').matches) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Gap analysis</div>
          <h1 className="page-title">{campaign?.name ?? 'Gap analysis'}</h1>
          <div className="page-subtitle">
            Gapwise researches each lead on the web, on top of Graph8's data, to find its real gaps, what it needs and how to pitch it.
          </div>
        </div>
        {!!campaigns?.length && (
          <div className="page-header-actions an-actions">
            <select className="input an-select" value={campaignId ?? ''} onChange={e => onCampaignId(e.target.value || null)} aria-label="Campaign">
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.mine ? '' : ` (${c.username})`}</option>)}
            </select>
            {batch ? (
              <button className="btn-secondary" onClick={stopRun} disabled={run.stopping}>{run.stopping ? 'Stopping after this lead…' : 'Stop after this lead'}</button>
            ) : (
              <button
                className="btn-accent"
                onClick={analyseAll}
                disabled={!canRun || active || leads.length === analysed.length}
                title={canRun ? '' : 'Gap analysis is turned off for your account'}
              >
                {leads.length && leads.length === analysed.length ? 'All leads analysed' : `Analyse all (${leads.length - analysed.length})`}
              </button>
            )}
          </div>
        )}
      </header>

      {!canRun && (
        <div className="settings-alert">Gap analysis is turned off for your account. You can read saved analyses; ask the admin to turn it on to run new ones.</div>
      )}
      {error && <div className="settings-alert">{error}</div>}
      {mine && !active && run.lastError && <div className="settings-alert">{run.lastError}</div>}

      {active && !mine && (
        <div className="gap-progress gap-elsewhere">
          <span>A gap analysis is running for <strong>{run.campaignName}</strong>. New runs can start when it finishes.</span>
          <button className="dash-link" onClick={() => run.campaignId && onCampaignId(run.campaignId)}>View it</button>
        </div>
      )}

      {mine && run.retry && (
        <div className="gap-progress gap-paused" role="status" aria-live="polite">
          <div className="gap-progress-row">
            <span className="gap-progress-title">Usage limit reached. Trying {run.queue[0]?.name ?? 'the lead'} again in {seconds(Math.max(0, run.retry.at - now))}</span>
            <span className="gap-progress-pct">Retry {run.retry.attempt} of {run.retry.of}</span>
          </div>
          <div className="gap-progress-meta"><span>{run.retry.reason}</span></div>
        </div>
      )}

      {paused && !active && (
        <div className="gap-progress gap-paused" role="status">
          <div className="gap-progress-row">
            <span className="gap-progress-title">Stopped with {paused.queue.length} lead{paused.queue.length === 1 ? '' : 's'} left</span>
            <span className="gap-progress-pct">{paused.done} / {paused.total}</span>
          </div>
          <div className="gap-bar"><span className="is-still" style={{ width: `${(paused.done / paused.total) * 100}%` }} /></div>
          <div className="gap-paused-actions">
            <button className="btn-accent" onClick={resumeRun} disabled={!canRun}>Resume</button>
            <button className="btn-secondary" onClick={dismissPaused}>Dismiss</button>
          </div>
        </div>
      )}

      {batch && (
        <div className="gap-progress" role="status" aria-live="polite">
          <div className="gap-progress-row">
            <span className="gap-progress-title">
              Lead {Math.min(batch.done + 1, batch.total)} of {batch.total}
              {progress && <> — {leads.find(l => l.id === progress.leadId)?.name}</>}
            </span>
            <span className="gap-progress-pct">{Math.floor(overallPct)}%</span>
          </div>
          <div className="gap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(overallPct)} aria-label="Overall progress">
            <span style={{ width: `${overallPct}%` }} />
          </div>
          <div className="gap-progress-meta">
            <span>{batch.done} done, {batch.total - batch.done} to go</span>
            <span>{timeLeft != null ? `About ${seconds(timeLeft)} left` : 'Estimating time left…'}</span>
          </div>
        </div>
      )}

      {campaigns && !campaigns.length && (
        <div className="an-callout">
          <div className="an-callout-title">No campaigns yet</div>
          <div className="text-muted">Create a campaign and search for leads in it. Its saved leads show up here for gap analysis.</div>
          <button className="btn-primary" onClick={onNewCampaign}>Create a campaign</button>
        </div>
      )}

      {loading && <p className="text-muted"><span className="pulse">Loading…</span></p>}

      {campaign && !loading && !leads.length && (
        <div className="an-callout">
          <div className="an-callout-title">This campaign has no saved leads</div>
          <div className="text-muted">Search in the campaign first. Every lead the search finds is saved and can be analysed here.</div>
        </div>
      )}

      {campaign && !loading && leads.length > 0 && (
        <>
          <section className="an-tiles">
            <div className="an-tile an-tile-hero">
              <div className="an-tile-label">Analysed</div>
              <div className="an-tile-value">{analysed.length} / {leads.length}</div>
              <div className="an-tile-note">saved leads researched</div>
            </div>
            <div className="an-tile">
              <div className="an-tile-label">Average fit</div>
              <div className="an-tile-value">{avgFit ?? '—'}</div>
              <div className="an-tile-note">likelihood to buy, 0–100</div>
            </div>
            <div className="an-tile">
              <div className="an-tile-label">High-severity gaps</div>
              <div className="an-tile-value">{highGaps}</div>
              <div className="an-tile-note">found with evidence</div>
            </div>
            <div className="an-tile">
              <div className="an-tile-label">Most needed offer</div>
              <div className="an-tile-value gap-tile-text">{topOffer ? OFFER_LABEL[topOffer] ?? topOffer : '—'}</div>
              <div className="an-tile-note">{topOffer ? `${offerCounts.get(topOffer)} of ${analysed.length} leads` : 'run an analysis'}</div>
            </div>
          </section>

          <div className="gap-layout">
            <ul className="gap-list" aria-label="Leads">
              {ordered.map(l => {
                const r = results[l.id]
                return (
                  <li key={l.id}>
                    <button className={`gap-item ${selected === l.id ? 'active' : ''}`} onClick={() => select(l.id)}>
                      <span className="gap-item-main">
                        <span className="gap-item-name">{l.name}</span>
                        <span className="gap-item-meta">{l.city} · {l.site || 'no website'}</span>
                        {r?.result.gaps[0] && <span className="gap-item-gap">{r.result.gaps[0].title}</span>}
                      </span>
                      {running === l.id ? (
                        <span className="gap-fit pending">{Math.floor(leadPct)}%</span>
                      ) : r ? (
                        <span className={`gap-fit ${fitClass(r.result.prospect.fitScore)}`} title="Fit score">{r.result.prospect.fitScore}</span>
                      ) : (
                        <span className="gap-fit none">New</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="gap-detail" ref={detailRef}>
              {!lead && <div className="an-empty">Select a lead.</div>}

              {lead && (
                <>
                  <div className="gap-detail-head">
                    <div className="gap-detail-title">
                      <h2>{lead.name}</h2>
                      <div className="gap-item-meta">
                        {lead.type} · {lead.city} · {lead.site
                          ? <a className="deploy-link" href={`https://${lead.site}`} target="_blank" rel="noopener noreferrer">{lead.site}</a>
                          : 'no website on record'}
                      </div>
                    </div>
                    <div className="gap-detail-actions">
                      <button className="btn-secondary" onClick={() => onAudit(campaign, lead)}>Audit</button>
                      {gap && (
                        <button
                          className="btn-secondary"
                          onClick={() => showReport(openReportWindow(), buildLeadReport(
                            lead,
                            (lead.analysis?.categories ?? []).flatMap(c => c.findings.map(f => ({ title: f, cat: c.label }))),
                            gap,
                          ))}
                        >
                          Export PDF
                        </button>
                      )}
                      <button className={gap ? 'btn-secondary' : 'btn-accent'} onClick={() => analyseOne(lead)} disabled={!canRun || active}>
                        {running === lead.id ? 'Researching…' : gap ? 'Re-run' : 'Run gap analysis'}
                      </button>
                    </div>
                  </div>

                  {progress && running === lead.id && (
                    <div className="lead-progress" role="status" aria-live="polite">
                      <div className="gap-progress-row">
                        <span className="gap-progress-title">{gap ? 'Re-running' : 'Researching'} {lead.name}</span>
                        <span className="gap-progress-pct">{Math.floor(leadPct)}%</span>
                      </div>
                      <div className="gap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(leadPct)} aria-label="Progress for this lead">
                        <span style={{ width: `${leadPct}%` }} />
                      </div>
                      <ol className="lead-steps">
                        {STEPS.map((step, i) => {
                          const order: Phase[] = ['starting', 'graph8', 'research', 'saving']
                          const cur = order.indexOf(progress.phase)
                          const mine = order.indexOf(step.key)
                          const skipped = step.key === 'graph8' && !progress.seen.includes('graph8') && cur > mine
                          const state = skipped ? 'skipped' : cur > mine ? 'done' : cur === mine ? 'active' : 'waiting'
                          return (
                            <li key={step.key} className={`lead-step ${state}`}>
                              <span className="lead-step-icon" aria-hidden>{state === 'done' ? '✓' : state === 'skipped' ? '–' : i + 1}</span>
                              <span className="lead-step-label">
                                {step.label}
                                {state === 'skipped' && <span className="lead-step-note"> — skipped, no Graph8 access or website</span>}
                              </span>
                              {state === 'active' && <span className="lead-step-time">{seconds(now - progress.phaseAt)}</span>}
                            </li>
                          )
                        })}
                      </ol>
                      <div className="gap-progress-meta">
                        <span>Elapsed {seconds(now - progress.startedAt)}</span>
                        <span>{avgMs ? `Usually about ${seconds(avgMs)}` : 'Usually 20–60s'}</span>
                      </div>
                    </div>
                  )}

                  {!gap && running !== lead.id && (
                    <div className="an-callout">
                      <div className="an-callout-title">Not analysed yet</div>
                      <div className="text-muted">Run the gap analysis to find this business's real gaps, what it is looking for, and a ready-to-use prospect profile.</div>
                    </div>
                  )}

                  {gap && <GapDetail gap={gap} onBuild={offer => onBuild(campaign, lead, offer)} />}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const GapDetail: FC<{ gap: GapAnalysis; onBuild: (offer: string) => void }> = ({ gap, onBuild }) => {
  const r = gap.result
  const p = r.prospect
  const [copied, setCopied] = useState(false)
  const email = `Subject: ${p.emailSubject}\n\n${p.emailOpening}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked; the text is still selectable */ }
  }

  const presence: Array<[string, string]> = [
    ['Website', [r.onlinePresence.website, r.onlinePresence.websiteStatus].filter(Boolean).join(' — ')],
    ['Google listing', r.onlinePresence.googleBusiness],
    ['Reviews', r.onlinePresence.reviews],
    ['Social', r.onlinePresence.social],
  ]

  return (
    <div className="gap-sections">
      {r.summary && <p className="gap-summary">{r.summary}</p>}

      <section className="gap-prospect">
        <div className="gap-prospect-head">
          <div>
            <div className="an-tile-label">Prospect profile</div>
            <div className="gap-offer">{OFFER_LABEL[p.recommendedOffer] ?? p.recommendedOffer}</div>
            {p.offerReason && <div className="gap-muted">{p.offerReason}</div>}
          </div>
          <div className={`gap-fit-big ${fitClass(p.fitScore)}`}>
            <span>{p.fitScore}</span>
            <small>fit</small>
          </div>
        </div>
        {p.pitch && <blockquote className="gap-pitch">{p.pitch}</blockquote>}
        {p.talkingPoints.length > 0 && (
          <ul className="gap-points">{p.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul>
        )}
        <div className="gap-meta-grid">
          {p.decisionMaker && <div><span>Talk to</span>{p.decisionMaker}</div>}
          {p.bestChannel && <div><span>Best channel</span>{p.bestChannel}</div>}
        </div>
        {(p.emailSubject || p.emailOpening) && (
          <div className="gap-email">
            <div className="gap-email-head">
              <span className="an-tile-label">Email opener</span>
              <button className="btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="gap-email-subject">{p.emailSubject}</div>
            <div className="gap-email-body">{p.emailOpening}</div>
          </div>
        )}
        <div className="gap-prospect-actions">
          <button className="btn-primary" onClick={() => onBuild(p.recommendedOffer)}>
            Build the {(OFFER_LABEL[p.recommendedOffer] ?? 'MVP').toLowerCase()} →
          </button>
        </div>
      </section>

      <section>
        <div className="an-section-title gap-h">Gaps found</div>
        <div className="gap-cards">
          {r.gaps.map((g, i) => (
            <div key={i} className={`gap-card sev-${g.severity}`}>
              <div className="gap-card-head">
                <span className="gap-card-title">{g.title}</span>
                <span className={`gap-sev ${g.severity}`}>{LEVEL_LABEL[g.severity]}</span>
              </div>
              {g.evidence && <div className="gap-card-text"><strong>Evidence:</strong> {g.evidence}</div>}
              {g.impact && <div className="gap-card-text gap-muted"><strong>Impact:</strong> {g.impact}</div>}
            </div>
          ))}
          {!r.gaps.length && <div className="an-empty">No clear gaps found.</div>}
        </div>
      </section>

      {r.needs.length > 0 && (
        <section>
          <div className="an-section-title gap-h">What they are looking for</div>
          <ul className="gap-needs">
            {r.needs.map((n, i) => (
              <li key={i}>
                <span className={`gap-sev ${n.priority}`}>{LEVEL_LABEL[n.priority]}</span>
                <div><strong>{n.solution}</strong><div className="gap-muted">{n.why}</div></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="an-section-title gap-h">Online presence</div>
        <dl className="gap-presence">
          {presence.filter(([, v]) => v).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>

      {gap.sources.length > 0 && (
        <section>
          <div className="an-section-title gap-h">Sources</div>
          <ol className="gap-sources">
            {gap.sources.map(s => (
              <li key={s.url}>
                {/* Older results kept the research provider's redirect links; show those as plain text. */}
                {/vertexaisearch\.cloud\.google\.com/.test(s.url)
                  ? <span>{s.title || 'Web source'}</span>
                  : <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="an-foot text-muted">
        Researched {new Date(gap.createdAt).toLocaleString()} by {gap.username}
        {gap.usedGraph8 ? ' · Graph8 company data and web research' : ' · web research'}
        {gap.queries.length > 0 && <> · searched “{gap.queries.slice(0, 3).join('”, “')}”</>}
      </div>
    </div>
  )
}

export default GapAnalysisPage
