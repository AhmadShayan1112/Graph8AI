import { useEffect, useState, type FC, type FormEvent } from 'react'
import type { Lead } from '../types/lead'
import {
  cancelJob, createSecurityAudit, discoverSecurityProducts, getSecurity, isActiveJob, resumeJob, runSecurityAudit,
  saveSecurityProducts, securityReportUrl, type SecurityAudit, type SecurityJob, type SecurityProduct, type Severity,
} from '../lib/api'
import { confirmDialog } from '../components/Dialog'

interface Props {
  lead: Lead
  campaignId?: string
  onBack: () => void
  // Opens Outreach on the security report email.
  onEmail: () => void
}

type Row = Pick<SecurityProduct, 'name' | 'url' | 'kind' | 'description' | 'selected'> & { id?: string }

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Good practice' }
const scoreClass = (s: number | null) => (s === null ? '' : s >= 80 ? 'good' : s >= 60 ? 'fair' : s >= 40 ? 'poor' : 'bad')
const toRows = (a: SecurityAudit | null): Row[] =>
  (a?.products ?? []).map(p => ({ id: p.id, name: p.name, url: p.url, kind: p.kind, description: p.description, selected: p.selected }))

// A lead's web products (its website, apps, portals, stores), reviewed from the outside by Gapwise and explained by
// Claude, with a PDF report to send to the lead. Everything runs on the server, so the page can be left.
const SecurityPage: FC<Props> = ({ lead, campaignId, onBack, onEmail }) => {
  const [audit, setAudit] = useState<SecurityAudit | null>(null)
  const [job, setJob] = useState<SecurityJob | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'' | 'save' | 'discover' | 'run' | 'stop'>('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [add, setAdd] = useState({ name: '', url: '' })
  const [open, setOpen] = useState<string | null>(null)

  const apply = (a: SecurityAudit | null, keepRows = false) => {
    setAudit(a)
    if (!keepRows) setRows(toRows(a))
  }

  const load = async () => {
    const r = await getSecurity(String(lead.id))
    if (r.audit) apply(r.audit)
    else apply((await createSecurityAudit(lead, campaignId)).audit)
    setJob(r.job)
  }

  useEffect(() => {
    setLoading(true)
    load().catch(err => setMessage({ text: err.message, ok: false })).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  const running = isActiveJob(job)
  const dirty = JSON.stringify(rows) !== JSON.stringify(toRows(audit))

  // Watch the job; when it finishes, reload the audit (unsaved product edits are kept).
  useEffect(() => {
    if (!running || !job) return
    const t = setInterval(() => {
      getSecurity(String(lead.id)).then(r => {
        setJob(r.job)
        if (r.audit) apply(r.audit, dirty)
      }).catch(() => {})
    }, 2500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, job?.id, dirty])

  const saveRows = async (next = rows) => {
    if (!audit) return null
    const r = await saveSecurityProducts(audit.id, next)
    apply(r.audit)
    return r.audit
  }

  const save = async () => {
    setBusy('save')
    setMessage(null)
    try {
      await saveRows()
      setMessage({ text: 'Products saved.', ok: true })
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy('')
    }
  }

  const addProduct = (e: FormEvent) => {
    e.preventDefault()
    const url = add.url.trim()
    if (!url) return
    setRows(r => [...r, { name: add.name.trim() || url.replace(/^https?:\/\//, '').replace(/\/$/, ''), url, kind: 'Web product', description: '', selected: true }])
    setAdd({ name: '', url: '' })
  }

  const discover = async () => {
    if (!audit) return
    setBusy('discover')
    setMessage(null)
    try {
      if (dirty) await saveRows()
      setJob((await discoverSecurityProducts(audit.id, lead)).job)
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy('')
    }
  }

  const run = async () => {
    if (!audit) return
    const chosen = rows.filter(r => r.selected)
    const unconfirmed = audit.products.filter(p => p.selected && !p.sameDomain && p.source === 'discovered')
    if (!(await confirmDialog({
      title: `Run a security audit of ${chosen.length} product${chosen.length === 1 ? '' : 's'}?`,
      message: <>
        Gapwise looks only at what any visitor’s browser sees (certificate, headers, cookies, page code, public DNS). Nothing is attacked or submitted.
        {unconfirmed.length > 0 && <> <b>{unconfirmed.length} selected product{unconfirmed.length === 1 ? ' is' : 's are'} on a different domain</b> from {lead.name}’s website: make sure {unconfirmed.length === 1 ? 'it belongs' : 'they belong'} to them.</>}
        {audit.report && <> This replaces the current report.</>}
      </>,
      confirmLabel: 'Run audit', tone: 'info',
    }))) return
    setBusy('run')
    setMessage(null)
    try {
      if (dirty) await saveRows()
      setJob((await runSecurityAudit(audit.id, lead)).job)
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy('')
    }
  }

  const stop = async () => {
    if (!job) return
    setBusy('stop')
    try { setJob((await cancelJob(job.id)).job as SecurityJob) } catch (err: any) { setMessage({ text: err.message, ok: false }) } finally { setBusy('') }
  }

  const retry = async () => {
    if (!job) return
    try { setJob((await resumeJob(job.id)).job as SecurityJob) } catch (err: any) { setMessage({ text: err.message, ok: false }) }
  }

  const productOf = (id?: string) => audit?.products.find(p => p.id === id)
  const selectedCount = rows.filter(r => r.selected).length
  const results = (audit?.products ?? []).filter(p => p.status !== 'pending')
  const discovering = running && job?.step === 'discover'
  const progress = job?.state.total ? Math.round(((job.state.done ?? 0) / job.state.total) * 100) : 0

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back</button>
          <div className="page-step">Security audit</div>
          <h1 className="page-title">{lead.name}</h1>
          <div className="page-subtitle">
            Find the company’s web products, review each one from the outside, and send them a PDF report of the security gaps with fixes.
          </div>
        </div>
      </header>

      {loading && <p className="text-muted"><span className="pulse">Loading…</span></p>}

      {!loading && audit && (
        <div className="sec-layout">
          <section className="dash-panel" aria-label="Products">
            <div className="dash-panel-head">
              <h2>Products</h2>
              <button className="btn-secondary" onClick={discover} disabled={running || !!busy}>
                {discovering || busy === 'discover' ? 'Searching…' : 'Find products with Claude'}
              </button>
            </div>
            <p className="text-muted sec-note">
              The website, web apps, portals, online stores and booking systems this company runs. Tick the ones to audit.
              {audit.discoveryNote && <> <em>{audit.discoveryNote}</em></>}
            </p>

            {rows.length === 0 && <div className="dash-empty"><p>No products yet. Find them with Claude, or add an address below.</p></div>}
            <ul className="sec-products">
              {rows.map((r, i) => {
                const p = productOf(r.id)
                return (
                  <li key={r.id ?? `new-${i}`} className={r.selected ? 'on' : ''}>
                    <input type="checkbox" checked={r.selected} disabled={running}
                      aria-label={`Audit ${r.name}`}
                      onChange={e => setRows(list => list.map((x, n) => (n === i ? { ...x, selected: e.target.checked } : x)))} />
                    <div className="sec-product-main">
                      <input className="input sec-name" value={r.name} disabled={running} maxLength={120} aria-label="Product name"
                        onChange={e => setRows(list => list.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
                      <a className="sec-url" href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>
                      <div className="sec-tags">
                        <span className="sec-tag">{r.kind}</span>
                        {p?.source === 'discovered' && <span className="sec-tag">Found by Claude</span>}
                        {p && !p.sameDomain && <span className="sec-tag warn" title="Not on the same domain as the lead's website">Different domain: confirm it’s theirs</span>}
                        {p?.status === 'done' && p.score !== null && <span className={`sec-score-chip ${scoreClass(p.score)}`}>{p.score}/100</span>}
                        {p?.status === 'failed' && <span className="sec-tag warn">Not reviewed</span>}
                      </div>
                      {r.description && <div className="text-muted sec-desc">{r.description}</div>}
                    </div>
                    <button className="assist-icon-btn" aria-label={`Remove ${r.name}`} disabled={running}
                      onClick={() => setRows(list => list.filter((_, n) => n !== i))}>✕</button>
                  </li>
                )
              })}
            </ul>

            <form className="sec-add" onSubmit={addProduct}>
              <input className="input" placeholder="Name (optional)" value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} disabled={running} />
              <input className="input" placeholder="https://app.example.com" value={add.url} onChange={e => setAdd(a => ({ ...a, url: e.target.value }))} disabled={running} />
              <button className="btn-secondary" type="submit" disabled={running || !add.url.trim() || rows.length >= 10}>Add</button>
            </form>

            <div className="outreach-actions">
              {dirty && <button className="btn-secondary" onClick={save} disabled={!!busy || running}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>}
              <span className="outreach-spacer" />
              <button className="btn-primary" onClick={run} disabled={running || !!busy || !selectedCount}>
                {busy === 'run' ? 'Starting…' : `Run security audit${selectedCount ? ` (${selectedCount})` : ''}`}
              </button>
            </div>
            <p className="text-muted sec-note">
              Passive review only: certificate, security headers, cookies, visible software versions, mixed content, email spoofing
              protection (SPF, DMARC) and security.txt. Nothing is attacked, guessed or submitted.
            </p>
            {message && <div className={`settings-message ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
          </section>

          <aside className="dash-panel sec-side" aria-label="Report">
            {running && job && (
              <div className="sec-progress">
                <div className="dash-panel-head"><h2>{discovering ? 'Finding products' : 'Auditing'}</h2></div>
                <div className="pulse">
                  {job.state.current ? `${job.state.current.name}: ${job.state.current.phase}` : job.state.phase || 'Starting…'}
                </div>
                {!discovering && (
                  <>
                    <div className="sec-bar"><span style={{ width: `${progress}%` }} /></div>
                    <div className="text-muted">{job.state.done ?? 0} of {job.state.total ?? 0} products · keeps running if you leave</div>
                  </>
                )}
                {job.error && <div className="settings-message bad">{job.error}</div>}
                <button className="btn-secondary" onClick={stop} disabled={busy === 'stop' || job.cancelRequested}>
                  {job.cancelRequested ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            )}
            {!running && job && (job.status === 'failed' || job.status === 'paused') && (
              <div className="settings-message bad">
                {job.error || 'The last run stopped.'} <button className="dash-link" onClick={retry}>Try again</button>
              </div>
            )}

            {audit.report ? (
              <div className="sec-report">
                <div className="sec-report-head">
                  <span className={`sec-score ${scoreClass(audit.report.score)}`}>{audit.report.score}<small>/100</small></span>
                  <div>
                    <strong>{audit.report.headline}</strong>
                    <div className="text-muted">Report from {new Date(audit.report.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <p>{audit.report.summary}</p>
                {audit.report.topRisks.length > 0 && (
                  <>
                    <div className="sec-label">Most important risks</div>
                    <ol className="sec-list">{audit.report.topRisks.map(t => <li key={t}>{t}</li>)}</ol>
                  </>
                )}
                <div className="outreach-actions">
                  <a className="btn-secondary" href={securityReportUrl(audit.id)} target="_blank" rel="noopener noreferrer">View PDF</a>
                  <a className="btn-secondary" href={securityReportUrl(audit.id, true)}>Download</a>
                  <span className="outreach-spacer" />
                  <button className="btn-primary" onClick={onEmail}>Email this report</button>
                </div>
              </div>
            ) : !running && (
              <div className="dash-empty">
                <p>No report yet. Choose the products and press <b>Run security audit</b>. Claude explains each finding in plain words and Gapwise builds the PDF.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {!loading && results.length > 0 && (
        <section className="sec-results" aria-label="Findings">
          <h2 className="sec-results-title">Findings by product</h2>
          {results.map(p => (
            <article key={p.id} className="dash-panel sec-result">
              <button className="sec-result-head" onClick={() => setOpen(o => (o === p.id ? null : p.id))} aria-expanded={open === p.id}>
                <span className={`sec-score small ${scoreClass(p.score)}`}>{p.score ?? '–'}</span>
                <span className="sec-result-name">
                  <strong>{p.name}</strong>
                  <span className="text-muted">{p.url}</span>
                </span>
                <span className="sec-counts">
                  {(['critical', 'high', 'medium', 'low'] as Severity[]).map(s => {
                    const n = p.findings.filter(f => f.severity === s).length
                    return n ? <span key={s} className={`sev sev-${s}`}>{n} {SEVERITY_LABEL[s]}</span> : null
                  })}
                  {p.status === 'failed' && <span className="sev sev-high">Not reviewed</span>}
                </span>
                <span aria-hidden>{open === p.id ? '▴' : '▾'}</span>
              </button>
              {open === p.id && (
                <div className="sec-result-body">
                  {p.status === 'failed' ? <div className="settings-message bad">{p.error}</div> : (
                    <>
                      {p.summary && <p>{p.summary}</p>}
                      <ul className="sec-checks">
                        {p.checks.map(c => <li key={c.label} className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '✕'} {c.label}</li>)}
                      </ul>
                      {p.findings.map(f => (
                        <div key={f.id} className="sec-finding">
                          <div className="sec-finding-head">
                            <span className={`sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                            <span className="text-muted">{f.category}</span>
                          </div>
                          <strong>{f.title}</strong>
                          <div className="text-muted sec-evidence">What we saw: {f.evidence}</div>
                          <div><b>Why it matters:</b> {f.risk}</div>
                          <div><b>How to fix it:</b> {f.fix}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

export default SecurityPage
