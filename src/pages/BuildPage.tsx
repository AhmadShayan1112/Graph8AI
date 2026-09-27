import { useState, type FC } from 'react'
import type { Lead, MvpData } from '../types/lead'
import { deploySite, generateMvp } from '../lib/api'
import { useSession } from '../components/LoginGate'

interface Props {
  lead: Lead
  mvpType: string
  onOutreach: (siteUrl?: string) => void
  onBack: () => void
  // Only the admin can open Settings.
  onOpenSettings?: () => void
}

const MVP_OPTIONS = [
  { type: 'booking-page', label: 'Online Booking Page', tag: 'recommended', desc: 'Branded booking page with their real services and hours.', fixes: 'No online booking, Phone-only appointments' },
  { type: 'contact-form', label: 'Lead Capture Form', tag: 'quick win', desc: 'Smart contact form with service selection and instant notifications.', fixes: 'No contact form, Missing lead capture' },
  { type: 'mobile-landing', label: 'Mobile-First Landing', tag: 'high impact', desc: 'Responsive landing page optimized for mobile visitors.', fixes: 'Not mobile-friendly, Poor mobile experience' },
  { type: 'speed-landing', label: 'Fast Landing Page', tag: 'performance', desc: 'Lightweight page that loads in under 1 second.', fixes: 'Slow website, Poor Core Web Vitals' },
]

const BuildPage: FC<Props> = ({ lead, mvpType, onOutreach, onBack, onOpenSettings }) => {
  const { user } = useSession()
  const canBuild = user.permissions.claude
  const [selected, setSelected] = useState(mvpType)
  const [mvp, setMvp] = useState<MvpData | null>(null)
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)
  const [stepIndex, setStepIndex] = useState(-1)
  const [error, setError] = useState<{ text: string; settings: boolean } | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [siteUrl, setSiteUrl] = useState('')

  const resetBuild = () => { setBuilt(false); setStepIndex(-1); setSiteUrl(''); setError(null) }

  const handleGenerate = async () => {
    resetBuild()
    setBuilding(true)
    setStepIndex(0)
    // Claude takes a minute or two; walk the steps while it works, holding on the last one.
    const timer = setInterval(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 12_000)
    try {
      const result = await generateMvp(lead, selected)
      setMvp(result.mvp)
      setStepIndex(result.mvp.steps.length)
      setBuilt(true)
    } catch (err: any) {
      setStepIndex(-1)
      setError({ text: err.message, settings: !!onOpenSettings && err.status === 400 && /Settings/.test(err.message) })
    } finally {
      clearInterval(timer)
      setBuilding(false)
    }
  }

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

  const previewUrl = siteUrl || 'Not deployed yet'
  const steps = mvp?.steps || [
    'Extracting content from website',
    'Applying brand identity',
    'Building components',
    'Generating preview',
    'Running quality checks',
  ]

  const deltas = [
    { k: 'Digital health', a: String(lead.score), b: String(Math.min(lead.score + 22, 95)) },
    { k: 'Mobile score', a: '34', b: '92' },
    { k: 'Load time', a: '4.2s', b: '0.8s' },
    { k: 'Lead capture', a: 'None', b: 'Active' },
  ]

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back to audit</button>
          <div className="page-step">Build & deploy</div>
          <h1 className="page-title">MVP for {lead.name}</h1>
        </div>
        <div className="page-subtitle" style={{ marginTop: -8 }}>
          Uses their logo, colors, services and hours from <span className="mono">{lead.site}</span>
        </div>
      </header>

      <div className="build-grid">
        <div className="build-options">
          {MVP_OPTIONS.map((opt, i) => (
            <button
              key={opt.type}
              className={`mvp-card fade-in ${selected === opt.type ? 'active' : ''}`}
              style={{ animationDelay: `${i * 0.06}s` }}
              onClick={() => { setSelected(opt.type); resetBuild() }}
            >
              <div className="mvp-card-header">
                <span className="mvp-card-label">{opt.label}</span>
                <span className="mvp-card-tag">{opt.tag}</span>
              </div>
              <span className="mvp-card-desc">{opt.desc}</span>
              <span className="mvp-card-fixes">
                <span className="text-muted">Fixes · </span>{opt.fixes}
              </span>
            </button>
          ))}
          {!canBuild && (
            <div className="settings-alert build-error">
              MVP generation with Claude is turned off for your account. Ask the admin to enable it.
            </div>
          )}
          <button
            className="btn-primary full-width"
            onClick={handleGenerate}
            disabled={building || !canBuild}
          >
            {building ? 'Generating with Claude…' : built ? '✓ Generated — Regenerate' : 'Generate MVP'}
          </button>
          {error && (
            <div className="settings-alert build-error">
              {error.text}
              {error.settings && <> <button className="back-link" onClick={onOpenSettings}>Open Settings →</button></>}
            </div>
          )}
        </div>

        <div className="build-preview-area">
          <div className="build-steps-bar">
            {steps.map((s, i) => (
              <div key={i} className={`build-step ${i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}`}>
                <span className={`build-step-dot ${i < stepIndex ? 'done' : i === stepIndex ? 'active pulse' : ''}`} />
                {s}
              </div>
            ))}
          </div>

          <div className="browser-frame">
            <div className="browser-bar">
              <div className="browser-dots">
                <span /><span /><span />
              </div>
              <div className="browser-url mono">{previewUrl}</div>
              {siteUrl && (
                <a className="browser-open-btn" href={siteUrl} target="_blank" rel="noopener noreferrer">Open full</a>
              )}
            </div>
            {built && mvp ? (
              // No allow-same-origin: generated code runs with an opaque origin, isolated from this app.
              <iframe
                className="preview-frame fade-in"
                title={`${mvp.title} preview`}
                sandbox="allow-scripts allow-forms"
                srcDoc={mvp.html}
              />
            ) : (
              <div className="preview-placeholder">
                {building ? 'Claude is building the page…' : 'Preview appears after generation'}
              </div>
            )}
          </div>

          {built && (
            <>
              <div className="delta-grid">
                {deltas.map((d, i) => (
                  <div key={d.k} className="delta-card fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
                    <div className="delta-label">{d.k}</div>
                    <div className="delta-values mono">
                      <span className="delta-before">{d.a}</span>
                      <span className="delta-after">{d.b}</span>
                    </div>
                  </div>
                ))}
              </div>

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
                    <button className="btn-secondary" onClick={handleDeploy} disabled={deploying}>
                      {deploying ? 'Deploying…' : 'Deploy'}
                    </button>
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
