import { useEffect, useState, type FC } from 'react'
import type { Lead } from '../types/lead'
import { enrichLead } from '../lib/api'

interface Props {
  lead: Lead
  onBuild: (mvpType: string) => void
  onBack: () => void
  onEnriched: (lead: Lead) => void
}

const TABS = ['All findings', 'Online Presence', 'Mobile', 'Speed', 'SEO', 'Lead Capture']

const AuditPage: FC<Props> = ({ lead, onBuild, onBack, onEnriched }) => {
  const [activeTab, setActiveTab] = useState('All findings')
  const [enriching, setEnriching] = useState(!lead.enrichment)
  const [enrichError, setEnrichError] = useState('')
  const analysis = lead.analysis
  const e = lead.enrichment

  useEffect(() => {
    if (lead.enrichment) { setEnriching(false); return }
    let cancelled = false
    setEnriching(true)
    setEnrichError('')
    enrichLead(lead)
      .then(en => {
        if (cancelled) return
        onEnriched({
          ...lead,
          enrichment: en,
          email: en.email.address || lead.email,
          contact: en.person?.name || lead.contact,
          role: en.person?.title || lead.role,
        })
      })
      .catch(err => { if (!cancelled) setEnrichError(err.status === 403 ? err.message : 'Could not enrich this lead right now.') })
      .finally(() => { if (!cancelled) setEnriching(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  if (!analysis) return <div className="page-content">No analysis data</div>

  const findings = analysis.categories.flatMap(cat =>
    cat.findings.map((f, i) => ({
      title: f,
      detail: getDetail(f),
      impact: getImpact(f),
      cat: cat.label,
      color: cat.color,
      evidence: `Score: ${cat.score}/100`,
    }))
  )

  const filteredFindings = activeTab === 'All findings'
    ? findings
    : findings.filter(f => f.cat === activeTab)

  const context = [
    { k: 'Industry', v: lead.type },
    { k: 'Location', v: e?.company?.address || lead.city },
    { k: 'Website', v: lead.site || 'None' },
    { k: 'Phone', v: e?.company?.phone },
    { k: 'Revenue', v: e?.company?.revenue },
    { k: 'Employees', v: e?.company?.employees },
  ].filter(x => x.v)

  const emailChecked = e?.email.checked ?? []
  const emailState = !e ? null
    : e.email.verified ? { label: 'Verified', cls: 'ok' }
    : emailChecked.length ? { label: `${emailChecked.length} tried, none deliverable`, cls: 'bad' }
    : { label: 'Not found', cls: 'muted' }

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back to list</button>
          <div className="page-step">Audit</div>
          <h1 className="page-title">{lead.name}</h1>
          <div className="page-subtitle">
            {lead.type} · {lead.city} · <span className="mono">{lead.site}</span> · {lead.contact}, {lead.role}
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn-secondary">Export PDF</button>
          <button className="btn-accent" onClick={() => onBuild(analysis.biggestGap.mvpType)}>
            Build MVP for this gap →
          </button>
        </div>
      </header>

      <div className="category-grid">
        {analysis.categories.map((cat, i) => (
          <div key={cat.label} className="category-card fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
            <div className="category-ring">
              <svg width="52" height="52" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="22" fill="none" stroke="#EEEEEA" strokeWidth="4" />
                <circle
                  cx="26" cy="26" r="22"
                  fill="none" stroke={cat.color} strokeWidth="4"
                  strokeDasharray={`${(cat.score / 100) * 138.2} 138.2`}
                  strokeLinecap="round"
                  transform="rotate(-90 26 26)"
                  className="ring-animate"
                />
              </svg>
              <span className="category-ring-score mono">{cat.score}</span>
            </div>
            <div className="category-info">
              <div className="category-label">{cat.label}</div>
              <div className="category-issues">{cat.issues} issues</div>
            </div>
          </div>
        ))}
      </div>

      <div className="audit-grid">
        <section className="findings-panel">
          <div className="findings-tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`tab-btn ${activeTab === t ? 'active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {filteredFindings.map((f, i) => (
            <div key={i} className="finding-row fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="finding-dot" style={{ background: f.color }} />
              <div className="finding-content">
                <div className="finding-title">{f.title}</div>
                <div className="finding-detail">{f.detail}</div>
                <div className="finding-impact">
                  <span className="finding-impact-label">Business impact · </span>
                  {f.impact}
                </div>
              </div>
              <div className="finding-meta">
                <span className="finding-cat">{f.cat}</span>
                <span className="finding-evidence mono">{f.evidence}</span>
              </div>
            </div>
          ))}
        </section>

        <aside className="audit-sidebar">
          <div className="biggest-gap-card">
            <div className="biggest-gap-label">Biggest gap</div>
            <div className="biggest-gap-title">{analysis.biggestGap.title}</div>
            <div className="biggest-gap-desc">{analysis.biggestGap.description}</div>
            <div className="biggest-gap-rec">{analysis.biggestGap.recommendation}</div>
            <button className="btn-light" onClick={() => onBuild(analysis.biggestGap.mvpType)}>
              Build {analysis.biggestGap.mvpType.replace(/-/g, ' ')} MVP
            </button>
          </div>
          <div className="context-card">
            <div className="context-title-row">
              <div className="context-title">Decision maker</div>
              {enriching && <span className="enrich-status pulse">Enriching…</span>}
            </div>
            <div className="dm-name">{lead.contact}</div>
            <div className="dm-role">{lead.role}{e?.person?.seniority ? ` · ${e.person.seniority}` : ''}</div>
            {!enriching && e && (
              <>
                <div className="context-row">
                  <span className="context-key">Email</span>
                  <span className={`email-badge ${emailState!.cls}`}>{emailState!.label}</span>
                </div>
                {e.email.verified && <div className="dm-email mono">{e.email.address}</div>}
                {!e.email.verified && emailChecked.length > 0 && (
                  <div className="dm-note">
                    Tried {emailChecked.map(c => c.email).join(', ')}. Reach out by phone or LinkedIn instead.
                  </div>
                )}
                {e.person?.phone && (
                  <div className="context-row"><span className="context-key">Direct phone</span><span className="context-val mono">{e.person.phone}</span></div>
                )}
                {(e.person?.linkedin || lead.contactLinkedin) && (
                  <a className="dm-link" href={`https://${(e.person?.linkedin || lead.contactLinkedin).replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer">LinkedIn profile →</a>
                )}
                {!e.found.person && !e.found.company && (
                  <div className="dm-note">No enrichment data is available for this business yet.</div>
                )}
              </>
            )}
            {enrichError && <div className="dm-note">{enrichError}</div>}
          </div>

          <div className="context-card">
            <div className="context-title">Business context</div>
            {e?.company?.description && <div className="dm-note">{e.company.description}</div>}
            {context.map(x => (
              <div key={x.k} className="context-row">
                <span className="context-key">{x.k}</span>
                <span className="context-val mono">{x.v}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function getDetail(gap: string): string {
  const details: Record<string, string> = {
    'No online booking': 'Customers must call during business hours to schedule appointments. No self-service booking available.',
    'Slow website (3s+)': 'Page load time exceeds 3 seconds. 53% of mobile users abandon sites that take over 3 seconds to load.',
    'Not mobile-friendly': 'Website layout breaks on mobile devices. Text is too small, buttons are not tap-friendly.',
    'No SSL certificate': 'Browser displays "Not Secure" warning. Visitors see a red warning before entering the site.',
    'Missing Google Business': 'No Google Business Profile found. Business is invisible in local "near me" searches.',
    'No contact form': 'No web form for inquiries. Every lead requires picking up the phone.',
    'Poor SEO metadata': 'Missing or generic title tags and meta descriptions. Search engines cannot properly index content.',
    'No social media links': 'No social media presence linked from the website. Missing trust signals.',
    'Broken links found': 'Multiple pages return 404 errors. Poor user experience and SEO penalty.',
    'No reviews integration': 'No customer reviews displayed on the website. Missing social proof.',
    'Missing accessibility': 'Website does not meet basic accessibility standards. Missing alt text, poor contrast.',
    'No analytics tracking': 'No analytics code detected. Business has no visibility into website performance.',
    'Outdated content': 'Content appears to be several months old. May signal an inactive business to visitors.',
    'No email capture': 'No newsletter signup or email capture mechanism. Losing potential long-term leads.',
    'Missing sitemap': 'No XML sitemap found. Search engines may not discover all pages.',
  }
  return details[gap] || 'This issue is reducing the effectiveness of the business\'s digital presence.'
}

function getImpact(gap: string): string {
  const impacts: Record<string, string> = {
    'No online booking': 'Losing 40% of potential appointments — customers expect 24/7 booking.',
    'Slow website (3s+)': 'Each second of delay reduces conversions by 7%. Currently losing significant traffic.',
    'Not mobile-friendly': '60% of searches are mobile. Non-responsive sites lose the majority of visitors.',
    'No SSL certificate': 'Chrome warns users the site is unsafe. Trust is broken before they even see content.',
    'Missing Google Business': 'Missing from 46% of all Google searches that are local queries.',
    'No contact form': 'Phone-only contact loses after-hours leads and introverted customers who prefer text.',
    'Poor SEO metadata': 'Ranking below competitors for key search terms. Invisible to organic traffic.',
  }
  return impacts[gap] || 'Directly reducing customer acquisition and online competitiveness.'
}

export default AuditPage
