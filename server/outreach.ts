import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import type { AuthInfo } from './auth.js'
import { askGemini, extractJson, GeminiError } from './gemini.js'
import { getEmailSettings, getResendKey } from './secrets.js'

// Outreach: one email per lead that links to its deployed MVP. Gapwise drafts it (from the lead's gap analysis),
// the person edits it, and it is sent through Resend from the workspace's address. No sequences.

export type EmailStatus = 'draft' | 'sent' | 'failed'
interface EmailDoc {
  _id: ObjectId
  ownerId: string
  username: string
  leadId: string
  leadName: string
  campaignId: string | null
  to: string
  subject: string
  body: string
  siteUrl: string
  status: EmailStatus
  providerId: string
  error: string
  createdAt: Date
  updatedAt: Date
  sentAt: Date | null
}

const MAX_SENDS_PER_DAY = 100
// Always in the email, so recipients can opt out (good practice and required in many places for cold email).
const OPT_OUT = 'If you would rather not hear from me again, just reply "no thanks" and I will not follow up.'

let indexReady = false
async function emails() {
  const col = (await getDb()).collection<EmailDoc>('outreach_emails')
  if (!indexReady) {
    await col.createIndex({ ownerId: 1, leadId: 1, updatedAt: -1 })
    await col.createIndex({ ownerId: 1, sentAt: -1 })
    indexReady = true
  }
  return col
}

const ownerOf = (auth: AuthInfo) => auth.userId ?? 'admin'
const scope = (auth: AuthInfo) => (auth.role === 'admin' ? {} : { ownerId: ownerOf(auth) })
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '')
export const validEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(e)

const publicEmail = (d: EmailDoc) => ({
  id: String(d._id), leadId: d.leadId, leadName: d.leadName, to: d.to, subject: d.subject, body: d.body, siteUrl: d.siteUrl,
  status: d.status, error: d.error, createdAt: d.createdAt, updatedAt: d.updatedAt, sentAt: d.sentAt, username: d.username,
})
export type PublicEmail = ReturnType<typeof publicEmail>

// ── Writing the draft ──

function templateDraft(lead: Record<string, any>, gap: Record<string, any> | null, siteUrl: string, sender: string) {
  const first = String(lead.enrichment?.person?.name || lead.contact || '').split(' ')[0]
  const greeting = first && first !== 'Owner' ? `Hi ${first},` : 'Hi there,'
  const p = gap?.prospect
  const gapLine = gap?.gaps?.[0]?.title
    ? `I noticed ${lead.name} ${String(gap.gaps[0].title).toLowerCase().startsWith('no ') ? 'has' : 'could use help with'} ${String(gap.gaps[0].title).toLowerCase()}.`
    : `I took a look at how customers find and contact ${lead.name} online.`
  return {
    subject: p?.emailSubject || `I built something for ${lead.name}`,
    body: [
      greeting,
      '',
      p?.emailOpening || gapLine,
      '',
      `So I built a working version of what I would suggest, using your own business details. You can try it here:`,
      siteUrl,
      '',
      `It is yours to look at, no strings attached. If it is useful, I would be glad to talk about making it live for you.`,
      '',
      'Best regards,',
      sender,
      '',
      OPT_OUT,
    ].join('\n'),
  }
}

async function writeDraft(auth: AuthInfo, lead: Record<string, any>, gap: Record<string, any> | null, siteUrl: string, sender: string) {
  const fallback = templateDraft(lead, gap, siteUrl, sender)
  if (!auth.permissions.gemini) return fallback
  try {
    const answer = await askGemini(`Write a short, personal cold email from a web agency to a local business owner. The agency has
already built a working web solution for them and the email's job is to get them to open it.

Rules:
- Under 120 words in the body. Plain, warm, specific; no hype, no buzzwords, no exclamation marks, no emojis.
- Open with one concrete observation about their business from the gap analysis (not flattery).
- Say what was built and why it helps them, in one or two sentences.
- Put this exact link on its own line: ${siteUrl}
- End with a low-pressure question, then "Best regards," and the sender "${sender}".
- Do not invent facts, results, prices, reviews or awards. Do not mention AI.
- Subject: specific to them, under 60 characters, not salesy.

Business: ${JSON.stringify({ name: lead.name, industry: lead.type, location: lead.city, contact: lead.enrichment?.person?.name || lead.contact })}
Gap analysis: ${JSON.stringify(gap ? { summary: gap.summary, gaps: (gap.gaps ?? []).slice(0, 3), pitch: gap.prospect?.pitch, offer: gap.prospect?.recommendedOffer } : 'not available')}

Reply with ONLY JSON: { "subject": "", "body": "the email body with line breaks as \\n" }`)
    const j = extractJson(answer)
    const subject = text(j?.subject, 140)
    let body = text(j?.body, 4000)
    if (!subject || !body) return fallback
    if (!body.includes(siteUrl)) body = `${body}\n\n${siteUrl}`
    return { subject, body: `${body}\n\n${OPT_OUT}` }
  } catch (err) {
    if (!(err instanceof GeminiError)) console.error('[outreach] draft writer failed:', (err as Error).message)
    return fallback
  }
}

// A fresh draft for the lead (replacing any earlier unsent draft).
export async function createDraft(auth: AuthInfo, p: {
  lead: Record<string, any>; gap: Record<string, any> | null; siteUrl: string; campaignId: string | null
}) {
  const { from } = await getEmailSettings()
  const sender = from.replace(/<.*>/, '').trim() || auth.username
  const { subject, body } = await writeDraft(auth, p.lead, p.gap, p.siteUrl, sender)
  const e = p.lead.enrichment?.email
  const to = e?.verified && e.address ? e.address : ''
  const col = await emails()
  const now = new Date()
  const leadId = String(p.lead.id ?? p.lead.name)
  await col.deleteMany({ ownerId: ownerOf(auth), leadId, status: 'draft' })
  const doc: EmailDoc = {
    _id: new ObjectId(), ownerId: ownerOf(auth), username: auth.username, leadId, leadName: String(p.lead.name),
    campaignId: p.campaignId, to, subject, body, siteUrl: p.siteUrl, status: 'draft', providerId: '', error: '',
    createdAt: now, updatedAt: now, sentAt: null,
  }
  await col.insertOne(doc)
  return publicEmail(doc)
}

export async function updateDraft(auth: AuthInfo, id: string, patch: { to?: unknown; subject?: unknown; body?: unknown }) {
  if (!ObjectId.isValid(id)) return null
  const set: Partial<EmailDoc> = { updatedAt: new Date() }
  if (patch.to !== undefined) set.to = text(patch.to, 200)
  if (patch.subject !== undefined) set.subject = text(patch.subject, 200)
  if (patch.body !== undefined) set.body = text(patch.body, 8000)
  const res = await (await emails()).findOneAndUpdate(
    { _id: new ObjectId(id), ...scope(auth), status: { $in: ['draft', 'failed'] } }, { $set: set }, { returnDocument: 'after' })
  return res ? publicEmail(res) : null
}

export async function emailsForLead(auth: AuthInfo, leadId: string) {
  const list = await (await emails()).find({ ...scope(auth), leadId }).sort({ updatedAt: -1 }).limit(20).toArray()
  return list.map(publicEmail)
}

// ── Sending ──

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Plain text as simple HTML: paragraphs, line breaks, and web links made clickable.
function toHtml(body: string) {
  const linked = (line: string) => escapeHtml(line).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`)
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">${
    body.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.split('\n').map(linked).join('<br>')}</p>`).join('')
  }</div>`
}

export class SendError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function sendEmail(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) throw new SendError('Email not found', 404)
  const col = await emails()
  const doc = await col.findOne({ _id: new ObjectId(id), ...scope(auth) })
  if (!doc) throw new SendError('Email not found', 404)
  if (doc.status === 'sent') throw new SendError('This email was already sent.', 409)
  if (!validEmail(doc.to)) throw new SendError('Add a valid recipient email address first.', 400)
  if (!doc.subject.trim() || !doc.body.trim()) throw new SendError('Add a subject and a message first.', 400)
  if (!doc.body.includes(doc.siteUrl)) throw new SendError('Keep the link to the MVP in the message; it is the point of the email.', 400)

  const [key, settings] = await Promise.all([getResendKey(), getEmailSettings()])
  if (!key || !settings.from) throw new SendError('Email sending is not set up yet. Ask the admin to add the Resend key and a From address in Settings.', 400)
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  if ((await col.countDocuments({ ownerId: ownerOf(auth), status: 'sent', sentAt: { $gt: since } })) >= MAX_SENDS_PER_DAY) {
    throw new SendError(`You have reached today's limit of ${MAX_SENDS_PER_DAY} emails. Try again tomorrow.`, 429)
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: settings.from,
      to: [doc.to],
      subject: doc.subject,
      text: doc.body,
      html: toHtml(doc.body),
      ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  const data = res ? await res.json().catch(() => null) : null
  if (!res || !res.ok) {
    const reason = String(data?.message ?? data?.error ?? (res ? res.statusText : 'network error')).slice(0, 300)
    console.error('[outreach] send failed:', res?.status, reason)
    await col.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: reason, updatedAt: new Date() } })
    const friendly = res?.status === 401 || res?.status === 403
      ? 'The email service rejected the key or the From address. Ask the admin to check Settings.'
      : `The email could not be sent: ${reason}`
    throw new SendError(friendly, 502)
  }
  const now = new Date()
  const updated = await col.findOneAndUpdate(
    { _id: doc._id },
    { $set: { status: 'sent', providerId: String(data?.id ?? ''), error: '', sentAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  )
  return updated ? publicEmail(updated) : null
}

export async function deleteEmailsFor(ownerId: string) {
  await (await emails()).deleteMany({ ownerId })
}
