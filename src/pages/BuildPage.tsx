import { useEffect, useState, type FC } from 'react'
import type { Lead, MvpData } from '../types/lead'
import {
  cancelJob, deploySite, fetchJob, isActiveJob, listJobs, resumeJob, startMvpJob, type MvpAgent, type MvpJob,
} from '../lib/api'
import { refreshRunner } from '../lib/gapRunner'
import { useSession } from '../components/LoginGate'
import { OFFER_LABEL } from '../lib/offers'

interface Props {
  lead: Lead
  // A solution type suggested by gap analysis, or '' to let the agents decide.
  mvpType: string
  // The campaign the lead came from, so the agents can use its gap analysis.
  campaignId?: string
  onOutreach: (siteUrl?: string) => void
  onBack: () => void
  // Only the admin can open Settings.
  onOpenSettings?: () => void
}

const AGENTS: Array<{ key: MvpAgent; name: string; job: string }> = [
  { key: 'research', name: 'Researcher', job: 'Researches the business on the web and finds how the best sites in its industry do this' },
  { key: 'strategy', name: 'Strategist', job: 'Picks the solution that fixes the top gap and designs the user flow' },
  { key: 'design', name: 'Designer', job: 'Sets colours, type, mood, industry animations and photos' },
  { key: 'build', name: 'Builder', job: 'Claude Code builds the site in its own workspace, reviews it against the plan and fixes it' },
]
type Status = 'waiting' | 'active' | 'done' | 'skipped'

// A typical generated site is around this many characters; progress eases toward it and never claims 100% early.
const EXPECTED_CHARS = 30_000

const seconds = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const BuildPage: FC<Props> = ({ lead, mvpType, campaignId, onOutreach, onBack, onOpenSettings }) => {
  const { user } = useSession()
  const canBuild = user.permissions.claude
  const [preference, setPreference] = useState(mvpType && OFFER_LABEL[mvpType] ? mvpType : '')
  // The build runs on the server as a job; this page only watches it, so leaving or refreshing loses nothing.
  const [job, setJob] = useState<MvpJob | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<{ text: string; settings: boolean } | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [siteUrl, setSiteUrl] = useState('')

  // The latest build for this lead: running, finished or failed.
  useEffect(() => {
    listJobs<MvpJob>({ kind: 'mvp', leadId: String(lead.id), limit: 1 })
      .then(r => setJob(r.jobs[0] ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [lead.id])

  const active = isActiveJob(job)

  // Watch the job while it runs.
  useEffect(() => {
    if (!job || !active) return
    const t = setInterval(() => {
      setNow(Date.now())
      fetchJob<MvpJob>(job.id).then(r => setJob(r.job)).catch(() => {})
    }, 2000)
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => { clearInterval(t); clearInterval(tick) }
  }, [job?.id, active])

  const start = async (planId?: string) => {
    setStarting(true)
    setError(null)
    setSiteUrl('')
    try {
      setJob((await startMvpJob(lead, campaignId, preference, planId)).job)
      refreshRunner()
    } catch (err: any) {
      setError({ text: err.message, settings: !!onOpenSettings && err.status === 400 && /Settings/.test(err.message) })
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => { if (job) setJob((await cancelJob(job.id)).job as MvpJob) }
  const resume = async () => { if (job) setJob((await resumeJob(job.id)).job as MvpJob) }

  const s = job?.state ?? {}
  const agentStatus = (k: MvpAgent): Status => {
    const v = s.agents?.[k]
    if (v === 'done') return 'done'
    if (v === 'skipped') return 'skipped'
    if (v === 'active' && active) return 'active'
    return 'waiting'
  }
  const status: Record<MvpAgent, Status> = {
    research: agentStatus('research'), strategy: agentStatus('strategy'), design: agentStatus('design'), build: agentStatus('build'),
  }
  const timeOf = (a?: string, b?: string) => (a ? seconds((b ? new Date(b).getTime() : now) - new Date(a).getTime()) : '')
  const elapsed = (k: MvpAgent) =>
    k === 'research' ? timeOf(s.researchStartedAt, s.researchDoneAt)
      : k === 'build' ? timeOf(s.buildStartedAt, s.buildDoneAt)
      : timeOf(s.planStartedAt, s.planDoneAt)
  const research = s.research !== undefined || s.researchNote ? { data: s.research ?? null, note: s.researchNote ?? '' } : null
  const plan = s.plan ? { plan: s.plan, images: s.images ?? [], planId: s.planId ?? '' } : null
  const chars = s.build?.chars ?? 0
  const buildAction = s.build?.action ?? ''
  const mvp: MvpData | null = job?.status === 'done' ? job.output : null
  const running = active || starting
  const failed = job?.status === 'failed' || job?.status === 'paused'

  const handleDeploy = async () => {
    if (!mvp) return
    setDeploying(true)
    setError(null)
    try {
      const { path } = await deploySite(mvp.draftId)
      setSiteUrl(`${window.location.origin}${path}`)
    } catch (err: any) {
      setError({ text: err.message, settings: false })
    } finally {
      setDeploying(false)
    }
  }

  const buildPct = status.build === 'done' ? 100 : Math.min(95, Math.round((chars / EXPECTED_CHARS) * 100))
  const r = research?.data
  const pl = plan?.plan
  const imgById = new Map((plan?.images ?? []).map(i => [i.id, i]))

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back to audit</button>
          <h1 className="page-title">MVP for {lead.name}</h1>
          <div className="page-subtitle">
            Four agents research {lead.name}, plan the solution that fixes its top gap, design it for its industry and build it.
          </div>
        </div>
      </header>

      <div className="build-grid">
        <div className="build-options">
          <div className="settings-card-label">Solution</div>
          <div className="mvp-choices" role="radiogroup" aria-label="Solution">
            <button role="radio" aria-checked={preference === ''} className={`mvp-choice ${preference === '' ? 'active' : ''}`} onClick={() => setPreference('')} disabled={running}>
              <strong>Let Gapwise decide</strong>
              <span>Recommended. Fixes the top gap from the gap analysis.</span>
            </button>
            {Object.entries(OFFER_LABEL).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={preference === id} className={`mvp-choice ${preference === id ? 'active' : ''}`} onClick={() => setPreference(id)} disabled={running}>
                <strong>{label}</strong>
                {id === mvpType && <span className="mvp-choice-tag">Recommended by gap analysis</span>}
              </button>
            ))}
          </div>
          {!canBuild && (
            <div className="settings-alert build-error">MVP generation with Claude is turned off for your account. Ask the admin to enable it.</div>
          )}
          {running ? (
            <button className="btn-secondary full-width" onClick={stop} disabled={!job || job.cancelRequested}>
              {job?.cancelRequested ? 'Stopping after this step…' : 'Stop'}
            </button>
          ) : (
            <button className="btn-primary full-width" onClick={() => start()} disabled={!canBuild || !loaded} data-tour="build-start">
              {mvp ? 'Re-plan and rebuild' : 'Plan & build MVP'}
            </button>
          )}
          {plan && !running && (
            <button className="btn-secondary full-width" onClick={() => start(plan.planId)} disabled={!canBuild}>Rebuild with this plan</button>
          )}
          {failed && !running && job && (
            <button className="btn-secondary full-width" onClick={resume} disabled={!canBuild}>Resume from where it stopped</button>
          )}
          {running && (
            <div className="settings-message ok build-bg-note">
              This keeps running on the server. You can leave this page or refresh; come back any time to see it.
            </div>
          )}
          {failed && job?.error && <div className="settings-alert build-error">{job.error}</div>}
          {error && (
            <div className="settings-alert build-error">
              {error.text}
              {error.settings && <> <button className="back-link" onClick={onOpenSettings}>Open Settings →</button></>}
            </div>
          )}
        </div>

        <div className="build-preview-area">
          <ol className="agents" aria-label="MVP agents">
            {AGENTS.map(a => (
              <li key={a.key} className={`agent ${status[a.key]}`}>
                <div className="agent-head">
                  <span className="agent-mark" aria-hidden>{status[a.key] === 'done' ? '✓' : status[a.key] === 'skipped' ? '–' : ''}</span>
                  <span className="agent-name">{a.name}</span>
                  <span className="agent-state">
                    {status[a.key] === 'active' ? `Working · ${elapsed(a.key)}` : status[a.key] === 'done' ? `Done · ${elapsed(a.key)}` : status[a.key] === 'skipped' ? 'Skipped' : 'Waiting'}
                  </span>
                </div>
                <div className="agent-job">{a.job}</div>

                {a.key === 'research' && research && (
                  <div className="agent-out">
                    {research.note && <p className="agent-note">{research.note}</p>}
                    {r && (
                      <>
                        {r.facts?.services?.length > 0 && <p><b>Services:</b> {r.facts.services.map((x: any) => x.name).filter(Boolean).slice(0, 6).join(', ')}</p>}
                        {r.facts?.hours && <p><b>Hours:</b> {r.facts.hours}</p>}
                        {r.facts?.team?.length > 0 && <p><b>Team:</b> {r.facts.team.map((t: any) => [t.name, t.role].filter(Boolean).join(', ')).slice(0, 4).join(' · ')}</p>}
                        {r.customerVoice?.praise?.length > 0 && <p><b>Customers praise:</b> {r.customerVoice.praise.slice(0, 2).join('; ')}</p>}
                        {r.customerVoice?.complaints?.length > 0 && <p><b>Complaints:</b> {r.customerVoice.complaints.slice(0, 2).join('; ')}</p>}
                        {r.references?.length > 0 && (
                          <p><b>Template references:</b>{' '}
                            {r.references.slice(0, 3).map((ref: any, i: number) => (
                              <span key={i}>{i > 0 && ' · '}{/^https?:\/\//.test(ref.url) ? <a href={ref.url} target="_blank" rel="noopener noreferrer">{ref.name || ref.url}</a> : ref.name}</span>
                            ))}
                          </p>
                        )}
                        {r.bestPractices?.length > 0 && <ul>{r.bestPractices.slice(0, 3).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>}
                      </>
                    )}
                  </div>
                )}

                {a.key === 'strategy' && pl && (
                  <div className="agent-out">
                    <p className="agent-solution"><b>{pl.solution.title || OFFER_LABEL[pl.solution.type]}</b> <span className="mvp-choice-tag">{OFFER_LABEL[pl.solution.type] ?? pl.solution.type}</span></p>
                    {pl.solution.whyItWillClick && <p><b>Why it will click:</b> {pl.solution.whyItWillClick}</p>}
                    {pl.flow?.length > 0 && (
                      <ol className="agent-flow">
                        {pl.flow.slice(0, 7).map((f, i) => <li key={i}><b>{f.screen}</b>{f.userAction && ` — ${f.userAction}`}</li>)}
                      </ol>
                    )}
                  </div>
                )}

                {a.key === 'design' && pl?.design && (
                  <div className="agent-out">
                    <div className="agent-palette">
                      {Object.entries(pl.design.palette ?? {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v))).map(([k, v]) => (
                        <span key={k} className="swatch" title={`${k} ${v}`}><i style={{ background: String(v) }} />{k}</span>
                      ))}
                    </div>
                    <p><b>Type:</b> {pl.design.fonts?.heading} / {pl.design.fonts?.body} · <b>Mood:</b> {pl.design.mood}</p>
                    {pl.design.animations?.length > 0 && <p><b>Animations:</b> {pl.design.animations.map(x => x.name).slice(0, 5).join(', ')}</p>}
                    {pl.design.imagery?.length > 0 && (
                      <div className="agent-photos">
                        {pl.design.imagery.map(x => imgById.get(x.imageId)).filter(Boolean).slice(0, 5).map(img => (
                          <img key={img!.id} src={img!.src} alt={img!.alt} title={img!.alt} loading="lazy" />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {a.key === 'build' && (status.build === 'active' || status.build === 'done') && (
                  <div className="agent-out">
                    <div className="gap-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={buildPct} aria-label="Build progress">
                      <span className={status.build === 'done' ? 'is-still' : ''} style={{ width: `${buildPct}%` }} />
                    </div>
                    <p className="agent-note">
                      {status.build === 'done' ? 'Site built, reviewed and fixed.' : `${buildAction || 'Starting'} · ${buildPct}% · ${Math.round(chars / 1000)} KB written`}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="browser-frame">
            <div className="browser-bar">
              <div className="browser-dots"><span /><span /><span /></div>
              <div className="browser-url mono">{siteUrl || 'Not deployed yet'}</div>
              {siteUrl && <a className="browser-open-btn" href={siteUrl} target="_blank" rel="noopener noreferrer">Open full</a>}
            </div>
            {mvp ? (
              // No allow-same-origin: generated code runs with an opaque origin, isolated from this app.
              <iframe className="preview-frame fade-in" title={`${mvp.title} preview`} sandbox="allow-scripts allow-forms" srcDoc={mvp.html} />
            ) : (
              <div className="preview-placeholder">{running ? 'The agents are working on it…' : 'The preview appears here once the MVP is built'}</div>
            )}
          </div>

          {mvp && (
            <>
              {pl?.solution?.fixesGaps?.length ? (
                <div className="fixes-row">
                  <span className="text-muted">Fixes:</span>
                  {pl.solution.fixesGaps.slice(0, 5).map(g => <span key={g} className="active-chip">{g}</span>)}
                </div>
              ) : null}

              <div className="deploy-bar fade-in">
                <div className="deploy-info">
                  <div className="deploy-title">{siteUrl ? 'MVP is live' : 'MVP is ready to deploy'}</div>
                  <div className="deploy-note">
                    {siteUrl
                      ? <>Live at <a className="deploy-link mono" href={siteUrl} target="_blank" rel="noopener noreferrer">{siteUrl}</a></>
                      : 'Deploying publishes it at a shareable link you can include in outreach.'}
                  </div>
                </div>
                <div className="deploy-actions">
                  {siteUrl ? (
                    <a className="btn-secondary visit-btn" href={siteUrl} target="_blank" rel="noopener noreferrer">Visit site ↗</a>
                  ) : (
                    <button className="btn-secondary" onClick={handleDeploy} disabled={deploying}>{deploying ? 'Deploying…' : 'Deploy'}</button>
                  )}
                  <button className="btn-accent" onClick={() => onOutreach(siteUrl || undefined)}>Write outreach →</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default BuildPage
