import { useEffect, useState, type FC } from 'react'
import type { Lead } from '../types/lead'
import { draftOutreach, getOutreach, saveOutreach, sendOutreach, type OutreachEmail } from '../lib/api'
import { confirmDialog } from '../components/Dialog'

interface Props {
  lead: Lead
  // The campaign the lead came from, so the draft can use its gap analysis.
  campaignId?: string
  onBack: () => void
  onOpenBuild: () => void
}

// One email to the lead that links to its deployed MVP: drafted by Gapwise, edited here, sent from the workspace.
const OutreachPage: FC<Props> = ({ lead, campaignId, onBack, onOpenBuild }) => {
  const [loading, setLoading] = useState(true)
  const [siteUrl, setSiteUrl] = useState<string | null>(null)
  const [sending, setSending] = useState<{ ready: boolean; from: string }>({ ready: false, from: '' })
  const [emails, setEmails] = useState<OutreachEmail[]>([])
  const [draft, setDraft] = useState<OutreachEmail | null>(null)
  const [form, setForm] = useState({ to: '', subject: '', body: '' })
  const [busy, setBusy] = useState<'' | 'draft' | 'save' | 'send'>('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = () => getOutreach(String(lead.id)).then(r => {
    setSiteUrl(r.siteUrl)
    setSending(r.sending)
    setEmails(r.emails)
    const d = r.emails.find(e => e.status !== 'sent') ?? null
    setDraft(d)
    if (d) setForm({ to: d.to, subject: d.subject, body: d.body })
  })

  useEffect(() => {
    setLoading(true)
    load().catch(err => setMessage({ text: err.message, ok: false })).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  const dirty = !!draft && (form.to !== draft.to || form.subject !== draft.subject || form.body !== draft.body)
  const sent = emails.filter(e => e.status === 'sent')
  const linkMissing = !!siteUrl && !!form.body && !form.body.includes(siteUrl)

  const write = async () => {
    if (draft && (dirty || draft.body) && !(await confirmDialog({
      title: 'Write a new draft?', message: 'The current draft will be replaced.', confirmLabel: 'Write new draft',
    }))) return
    setBusy('draft')
    setMessage(null)
    try {
      const { email } = await draftOutreach(lead, campaignId)
      setDraft(email)
      setForm({ to: email.to, subject: email.subject, body: email.body })
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    if (!draft) return null
    setBusy('save')
    setMessage(null)
    try {
      const { email } = await saveOutreach(draft.id, form)
      setDraft(email)
      setMessage({ text: 'Draft saved.', ok: true })
      return email
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
      return null
    } finally {
      setBusy('')
    }
  }

  const send = async () => {
    if (!draft) return
    if (!(await confirmDialog({
      title: `Send this email to ${form.to || 'the lead'}?`,
      message: <>It goes out from <b>{sending.from}</b> with the link to {lead.name}’s MVP. You can’t unsend it.</>,
      confirmLabel: 'Send email', tone: 'info',
    }))) return
    if (dirty && !(await save())) return
    setBusy('send')
    setMessage(null)
    try {
      await sendOutreach(draft.id)
      setMessage({ text: `Sent to ${form.to}.`, ok: true })
      setDraft(null)
      setForm({ to: '', subject: '', body: '' })
      await load()
    } catch (err: any) {
      setMessage({ text: err.message, ok: false })
    } finally {
      setBusy('')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${form.subject}\n\n${form.body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }

  const verified = lead.enrichment?.email.verified ? lead.enrichment.email.address : ''

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <button className="back-link" onClick={onBack}>← Back to build</button>
          <h1 className="page-title">Email {lead.name}</h1>
          <div className="page-subtitle">One email with the link to the MVP you built for them. Edit it, then send it from Gapwise.</div>
        </div>
      </header>

      {loading && <p className="text-muted"><span className="pulse">Loading…</span></p>}

      {!loading && !siteUrl && (
        <div className="an-callout">
          <div className="an-callout-title">Deploy the MVP first</div>
          <div className="text-muted">The email is built around the live link to the solution you made for {lead.name}. Build and deploy it, then come back.</div>
          <button className="btn-primary" onClick={onOpenBuild}>Go to Build & deploy</button>
        </div>
      )}

      {!loading && siteUrl && (
        <div className="outreach-layout">
          <section className="dash-panel outreach-compose" aria-label="Email draft">
            <div className="outreach-link">
              <span className="text-muted">MVP link</span>
              <a href={siteUrl} target="_blank" rel="noopener noreferrer">{siteUrl}</a>
            </div>

            {!draft ? (
              <div className="dash-empty">
                <p>Gapwise writes a short, personal email from {lead.name}’s gap analysis, with the MVP link in it. You can edit everything before sending.</p>
                <button className="btn-primary" onClick={write} disabled={busy === 'draft'}>{busy === 'draft' ? 'Writing…' : 'Write the email'}</button>
              </div>
            ) : (
              <>
                <label className="outreach-field">
                  <span>To</span>
                  <input className="input" type="email" value={form.to} placeholder="owner@business.com" onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
                </label>
                {!form.to && (
                  <div className="settings-message bad">
                    {verified ? <>Suggested: <button className="dash-link" onClick={() => setForm(f => ({ ...f, to: verified }))}>{verified}</button></> : 'No verified email for this lead yet. Enrich it on Audit, or type the address.'}
                  </div>
                )}
                <label className="outreach-field">
                  <span>Subject</span>
                  <input className="input" value={form.subject} maxLength={200} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                </label>
                <label className="outreach-field">
                  <span>Message</span>
                  <textarea className="input outreach-body" rows={14} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
                </label>
                {linkMissing && <div className="settings-message bad">The MVP link is missing from the message. Add it back: {siteUrl}</div>}
                {!sending.ready && (
                  <div className="settings-alert">Sending isn’t set up yet: the admin adds the email service key and a From address in Settings. You can still copy the email.</div>
                )}
                <div className="outreach-actions">
                  <button className="btn-secondary" onClick={write} disabled={!!busy}>{busy === 'draft' ? 'Writing…' : 'Rewrite'}</button>
                  <button className="btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                  <span className="outreach-spacer" />
                  <button className="btn-secondary" onClick={save} disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
                  <button className="btn-primary" onClick={send} disabled={!!busy || !sending.ready || !form.to.trim() || linkMissing}>
                    {busy === 'send' ? 'Sending…' : 'Send email'}
                  </button>
                </div>
                {sending.ready && <div className="outreach-from text-muted">Sends from {sending.from}</div>}
              </>
            )}
            {message && <div className={`settings-message ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
          </section>

          <aside className="dash-panel outreach-history" aria-label="Sent emails">
            <div className="dash-panel-head"><h2>Sent to {lead.name}</h2></div>
            {sent.length ? (
              <ul className="outreach-sent">
                {sent.map(e => (
                  <li key={e.id}>
                    <strong>{e.subject}</strong>
                    <span>To {e.to} · {e.sentAt ? new Date(e.sentAt).toLocaleString() : ''}{e.username ? ` · by ${e.username}` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="dash-empty"><p>Nothing sent yet.</p></div>}
          </aside>
        </div>
      )}
    </div>
  )
}

export default OutreachPage
