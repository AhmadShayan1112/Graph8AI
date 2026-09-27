import { useEffect, useRef, useState, type FC } from 'react'
import {
  getCampaign, listCampaigns, listGapAnalyses, runGapAnalysis,
  type Campaign, type CampaignLead, type CampaignSummary, type GapAnalysis, type GapLevel,
} from '../lib/api'
import { useSession } from '../components/LoginGate'

interface Props {
  campaignId: string | null
  onCampaignId: (id: string | null) => void
  onBuild: (c: Campaign, lead: CampaignLead, mvpType: string) => void
  onAudit: (c: Campaign, lead: CampaignLead) => void
  onNewCampaign: () => void
}

const OFFER_LABEL: Record<string, string> = {
  'booking-page': 'Online booking page',
  'contact-form': 'Lead capture form',
  'mobile-landing': 'Mobile-first landing page',
  'speed-landing': 'Fast landing page',
}
const LEVEL_LABEL: Record<GapLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' }

const fitClass = (n: number) => (n >= 70 ? 'good' : n >= 40 ? 'fair' : 'poor')

const GapAnalysisPage: FC<Props> = ({ campaignId, onCampaignId, onBuild, onAudit, onNewCampaign }) => {
  const { user } = useSession()
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [leads, setLeads] = useState<CampaignLead[]>([])
  const [results, setResults] = useState<Record<string, GapAnalysis>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const stopRef = useRef(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const canRun = user.permissions.gemini

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

  const analyse = async (lead: CampaignLead) => {
    if (!campaign) return false
    setRunning(lead.id)
    setError('')
    try {
      const { analysis } = await runGapAnalysis(campaign.id, lead.id)
      setResults(r => ({ ...r, [lead.id]: analysis }))
      return true
    } catch (err: any) {
      setError(`${lead.name}: ${err.message}`)
      return false
    } finally {
      setRunning(null)
    }
  }

  const analyseOne = async (lead: CampaignLead) => {
    setSelected(lead.id)
    await analyse(lead)
  }

  // One lead at a time: each is a web-research call, and a sequence keeps within Gemini's rate limits.
  const analyseAll = async () => {
    const todo = leads.filter(l => !results[l.id])
    if (!todo.length) return
    if (!confirm(`Run gap analysis on ${todo.length} lead${todo.length > 1 ? 's' : ''}? Each one is a Gemini web search and takes up to a minute.`)) return
    stopRef.current = false
    setBatch({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      if (stopRef.current) break
      setSelected(todo[i].id)
      const ok = await analyse(todo[i])
      setBatch({ done: i + 1, total: todo.length })
      // A key or quota problem will fail every lead the same way, so stop early.
      if (!ok) break
    }
    setBatch(null)
  }

  const analysed = leads.filter(l => results[l.id])
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
            Gemini researches each lead on the web, on top of Graph8's data, to find its real gaps, what it needs and how to pitch it.
          </div>
        </div>
        {!!campaigns?.length && (
          <div className="page-header-actions an-actions">
            <select className="input an-select" value={campaignId ?? ''} onChange={e => onCampaignId(e.target.value || null)} aria-label="Campaign" disabled={!!batch}>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.mine ? '' : ` (${c.username})`}</option>)}
            </select>
            {batch ? (
              <button className="btn-secondary" onClick={() => { stopRef.current = true }}>Stop after this lead</button>
            ) : (
              <button
                className="btn-accent"
                onClick={analyseAll}
                disabled={!canRun || !!running || leads.length === analysed.length}
                title={canRun ? '' : 'Gap analysis is turned off for your account'}
              >
                {leads.length && leads.length === analysed.length ? 'All leads analysed' : `Analyse all (${leads.length - analysed.length})`}
              </button>
            )}
          </div>
        )}
      </header>

      {!canRun && (
        <div className="settings-alert">Gap analysis with Gemini is turned off for your account. You can read saved analyses; ask the admin to enable Gemini to run new ones.</div>
      )}
      {error && <div className="settings-alert">{error}</div>}

      {batch && (
        <div className="gap-progress">
          <div className="gap-progress-text">
            <span className="pulse">Analysing</span> {Math.min(batch.done + 1, batch.total)} of {batch.total}
            {lead && <> · <strong>{lead.name}</strong></>}
          </div>
          <div className="an-meter"><span style={{ width: `${(batch.done / batch.total) * 100}%` }} /></div>
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
                        <span className="gap-fit pending pulse">…</span>
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
                      <button className={gap ? 'btn-secondary' : 'btn-accent'} onClick={() => analyseOne(lead)} disabled={!canRun || !!running || !!batch}>
                        {running === lead.id ? 'Researching…' : gap ? 'Re-run' : 'Run gap analysis'}
                      </button>
                    </div>
                  </div>

                  {running === lead.id && !gap && (
                    <div className="an-callout">
                      <div className="an-callout-title pulse">Researching {lead.name}…</div>
                      <div className="text-muted">Gemini is searching the web for their website, Google listing, reviews and social pages. This takes up to a minute.</div>
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
              <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>
            ))}
          </ol>
        </section>
      )}

      <div className="an-foot text-muted">
        Researched {new Date(gap.createdAt).toLocaleString()} by {gap.username}
        {gap.usedGraph8 ? ' · Graph8 company data + Gemini web search' : ' · Gemini web search'}
        {gap.queries.length > 0 && <> · searched “{gap.queries.slice(0, 3).join('”, “')}”</>}
      </div>
    </div>
  )
}

export default GapAnalysisPage
