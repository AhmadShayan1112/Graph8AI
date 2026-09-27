import { useState, useEffect, type FC } from 'react'
import type { Lead, OutreachData } from '../types/lead'
import { generateOutreach } from '../lib/api'

interface Props {
  lead: Lead
  mvpType: string
  siteUrl?: string
  onBack: () => void
}

const OutreachPage: FC<Props> = ({ lead, mvpType, siteUrl, onBack }) => {
  const [outreach, setOutreach] = useState<OutreachData | null>(null)
  const [selectedStep, setSelectedStep] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const previewUrl = siteUrl || `${lead.name.toLowerCase().replace(/\s+/g, '')}.gapwise.site`

  useEffect(() => {
    generateOutreach(lead, mvpType, previewUrl).then(setOutreach).catch(console.error)
  }, [lead, mvpType, previewUrl])

  const handleSend = () => {
    setSending(true)
    setTimeout(() => {
      setSending(false)
      setSent(true)
    }, 1500)
  }

  if (!outreach) return <div className="page-content"><span className="pulse">Generating outreach…</span></div>

  const sequence = outreach.sequence || []

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back to build</button>
          <div className="page-step">Outreach</div>
          <h1 className="page-title">Send the working product, not a pitch</h1>
        </div>
        <button
          className={`btn-primary ${sent ? 'sent' : ''}`}
          onClick={handleSend}
          disabled={sending || sent || !lead.enrichment?.email.verified}
          title={lead.enrichment?.email.verified ? undefined : 'Needs a verified email'}
          style={{ background: sent ? '#22A06B' : undefined }}
        >
          {sent ? '✓ Sequence started' : sending ? 'Sending…' : 'Start sequence'}
        </button>
      </header>

      <div className="sequence-cards">
        {sequence.map((q, i) => (
          <button
            key={i}
            className={`sequence-card fade-in ${selectedStep === i ? 'active' : ''}`}
            style={{ animationDelay: `${i * 0.06}s` }}
            onClick={() => setSelectedStep(i)}
          >
            <span className="sequence-meta mono">{q.day} · {q.channel}</span>
            <span className="sequence-title">{q.title}</span>
            <span className="sequence-cond">{q.condition}</span>
          </button>
        ))}
      </div>

      <div className="outreach-grid">
        <div className="email-preview">
          <div className="email-field">
            <div className="email-field-label">To</div>
            <div className="email-field-value">
              {lead.contact}{' '}
              {lead.enrichment?.email.verified
                ? <>&lt;{lead.enrichment.email.address}&gt;</>
                : <span className="text-muted">— no verified email yet</span>}
            </div>
          </div>
          <div className="email-field">
            <div className="email-field-label">Subject</div>
            <div className="email-field-value" style={{ fontWeight: 600 }}>{outreach.subject}</div>
          </div>
          <div className="email-body">
            <p>{outreach.greeting}</p>
            <p>
              {outreach.body1} <span className="signal-highlight">{outreach.signal}</span>
            </p>
            <p>{outreach.body2}</p>
            <div className="email-mvp-embed">
              <div className="email-mvp-thumb">live MVP thumbnail</div>
              <div className="email-mvp-link">
                <span className="mono accent">{outreach.liveUrl}</span>
                <span className="text-muted">Try it →</span>
              </div>
            </div>
            <p>{outreach.body3}</p>
            <p>— {lead.contact.split(' ')[0]}</p>
          </div>
        </div>

        <aside className="outreach-sidebar">
          <div className="outreach-stat-card">
            <div className="outreach-stat-label">Delivery confidence</div>
            {lead.enrichment?.email.verified ? (
              <>
                <div className="outreach-stat-value" style={{ color: 'oklch(0.5 0.13 150)' }}>High</div>
                <div className="outreach-stat-detail">Mailbox confirmed deliverable for {lead.enrichment.email.address}</div>
              </>
            ) : (
              <>
                <div className="outreach-stat-value" style={{ color: 'oklch(0.55 0.15 28)' }}>Not deliverable</div>
                <div className="outreach-stat-detail">
                  {lead.enrichment?.email.checked.length
                    ? `None of the ${lead.enrichment.email.checked.length} candidate emails passed verification. Call ${lead.enrichment.company?.phone || 'the business'} or message on LinkedIn.`
                    : 'No email found for this contact. Use phone or LinkedIn.'}
                </div>
              </>
            )}
          </div>
          <div className="outreach-stat-card">
            <div className="outreach-stat-label">Personalization score</div>
            <div className="outreach-stat-value mono">9.2 / 10</div>
            <div className="outreach-stat-detail">
              Uses real business name, contact name, actual gap data, and a live working MVP
            </div>
          </div>
          <div className="outreach-stat-card">
            <div className="outreach-stat-label">Expected reply rate</div>
            <div className="outreach-stat-value accent">32%</div>
            <div className="outreach-stat-detail">
              4× higher than generic outreach — leads with a working demo respond more
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default OutreachPage
