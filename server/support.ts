import type { Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import { getAuth, type AuthInfo } from './auth.js'

// Human support: a user hands a question (and the assistant chat that led to it) to the admin, and the
// two reply back and forth on the request until it is closed.
type Status = 'open' | 'answered' | 'closed'
interface Message { from: 'user' | 'admin'; name: string; text: string; at: Date }

interface TicketDoc {
  _id: ObjectId
  ownerId: string
  username: string
  subject: string
  page: string
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>
  messages: Message[]
  status: Status
  unreadForUser: boolean
  unreadForAdmin: boolean
  createdAt: Date
  updatedAt: Date
}

let indexReady = false
async function tickets() {
  const col = (await getDb()).collection<TicketDoc>('support_tickets')
  if (!indexReady) {
    await col.createIndex({ ownerId: 1, updatedAt: -1 })
    await col.createIndex({ status: 1, updatedAt: -1 })
    indexReady = true
  }
  return col
}

const ownerOf = (auth: AuthInfo) => auth.userId ?? 'admin'
const isAdmin = (auth: AuthInfo) => auth.role === 'admin'
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Enough for real requests, not enough to flood the admin.
const MAX_NEW_PER_HOUR = 10

function toPublic(t: TicketDoc, auth: AuthInfo, full: boolean) {
  const last = t.messages[t.messages.length - 1]
  return {
    id: String(t._id),
    username: t.username,
    mine: t.ownerId === ownerOf(auth),
    subject: t.subject,
    page: t.page,
    status: t.status,
    unread: isAdmin(auth) ? t.unreadForAdmin : t.unreadForUser,
    lastMessage: last ? { from: last.from, text: last.text.slice(0, 160), at: last.at } : null,
    messageCount: t.messages.length,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(full ? { messages: t.messages, transcript: t.transcript } : {}),
  }
}

async function findVisible(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  return (await tickets()).findOne({ _id: new ObjectId(id), ...(isAdmin(auth) ? {} : { ownerId: ownerOf(auth) }) })
}

export async function createTicket(req: Request, res: Response) {
  const auth = getAuth(res)
  const message = text(req.body?.message, 4000)
  if (!message) { res.status(400).json({ error: 'Write what you need help with.' }); return }
  const transcript = (Array.isArray(req.body?.transcript) ? req.body.transcript : [])
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
  try {
    const col = await tickets()
    const since = new Date(Date.now() - 3600_000)
    if ((await col.countDocuments({ ownerId: ownerOf(auth), createdAt: { $gt: since } })) >= MAX_NEW_PER_HOUR) {
      res.status(429).json({ error: 'You have opened several requests in the last hour. Add to an existing one instead.' })
      return
    }
    const now = new Date()
    const doc: TicketDoc = {
      _id: new ObjectId(),
      ownerId: ownerOf(auth),
      username: auth.username,
      subject: message.split('\n')[0].slice(0, 120),
      page: text(req.body?.page, 40),
      transcript,
      messages: [{ from: 'user', name: auth.username, text: message, at: now }],
      status: 'open',
      unreadForUser: false,
      unreadForAdmin: true,
      createdAt: now,
      updatedAt: now,
    }
    await col.insertOne(doc)
    res.json({ ticket: toPublic(doc, auth, true) })
  } catch (err: any) {
    console.error('[support] create failed:', err.message)
    res.status(503).json({ error: 'Could not send your request. Try again shortly.' })
  }
}

export async function listTickets(req: Request, res: Response) {
  const auth = getAuth(res)
  const status = ['open', 'answered', 'closed'].includes(String(req.query.status)) ? String(req.query.status) : null
  try {
    const filter = { ...(isAdmin(auth) ? {} : { ownerId: ownerOf(auth) }), ...(status ? { status: status as Status } : {}) }
    const list = await (await tickets()).find(filter, { projection: { transcript: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray()
    res.json({ tickets: list.map(t => toPublic(t as TicketDoc, auth, false)) })
  } catch (err: any) {
    console.error('[support] list failed:', err.message)
    res.status(503).json({ error: 'Could not load support requests.' })
  }
}

// Opening a request marks it read for whoever opened it.
export async function getTicket(req: Request, res: Response) {
  const auth = getAuth(res)
  try {
    const t = await findVisible(auth, req.params.id)
    if (!t) { res.status(404).json({ error: 'Request not found' }); return }
    const admin = isAdmin(auth)
    const wasUnread = admin ? t.unreadForAdmin : t.unreadForUser
    if (wasUnread) await (await tickets()).updateOne({ _id: t._id }, { $set: admin ? { unreadForAdmin: false } : { unreadForUser: false } })
    const seen = { ...t, unreadForAdmin: admin ? false : t.unreadForAdmin, unreadForUser: admin ? t.unreadForUser : false }
    res.json({ ticket: toPublic(seen, auth, true) })
  } catch (err: any) {
    console.error('[support] read failed:', err.message)
    res.status(503).json({ error: 'Could not load that request.' })
  }
}

export async function replyToTicket(req: Request, res: Response) {
  const auth = getAuth(res)
  const body = text(req.body?.text, 4000)
  if (!body) { res.status(400).json({ error: 'Write a reply first.' }); return }
  try {
    const t = await findVisible(auth, req.params.id)
    if (!t) { res.status(404).json({ error: 'Request not found' }); return }
    const fromAdmin = isAdmin(auth) && t.ownerId !== ownerOf(auth)
    const now = new Date()
    const msg: Message = { from: fromAdmin ? 'admin' : 'user', name: fromAdmin ? 'Gapwise support' : auth.username, text: body, at: now }
    const updated = await (await tickets()).findOneAndUpdate(
      { _id: t._id },
      {
        $push: { messages: msg },
        $set: {
          status: fromAdmin ? 'answered' : 'open',
          unreadForUser: fromAdmin,
          unreadForAdmin: !fromAdmin,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    )
    res.json({ ticket: updated ? toPublic(updated, auth, true) : null })
  } catch (err: any) {
    console.error('[support] reply failed:', err.message)
    res.status(503).json({ error: 'Could not send your reply. Try again shortly.' })
  }
}

export async function setTicketStatus(req: Request, res: Response) {
  const auth = getAuth(res)
  const status = req.body?.status
  if (status !== 'closed' && status !== 'open') { res.status(400).json({ error: 'status must be open or closed' }); return }
  try {
    const t = await findVisible(auth, req.params.id)
    if (!t) { res.status(404).json({ error: 'Request not found' }); return }
    const updated = await (await tickets()).findOneAndUpdate(
      { _id: t._id }, { $set: { status, updatedAt: new Date() } }, { returnDocument: 'after' })
    res.json({ ticket: updated ? toPublic(updated, auth, true) : null })
  } catch (err: any) {
    console.error('[support] status failed:', err.message)
    res.status(503).json({ error: 'Could not update the request.' })
  }
}

// Badge counts: requests waiting for the admin, or replies the user has not read.
export async function supportSummary(_req: Request, res: Response) {
  const auth = getAuth(res)
  try {
    const col = await tickets()
    const waiting = isAdmin(auth)
      ? await col.countDocuments({ status: 'open' })
      : await col.countDocuments({ ownerId: ownerOf(auth), unreadForUser: true })
    res.json({ waiting })
  } catch (err: any) {
    console.error('[support] summary failed:', err.message)
    res.json({ waiting: 0 })
  }
}

export async function deleteTicketsFor(ownerId: string) {
  await (await tickets()).deleteMany({ ownerId })
}
