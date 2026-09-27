import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import { authForOwner, type AuthInfo } from './auth.js'
import { sign, safeEqual } from './crypto.js'
import { GeminiError } from './gemini.js'
import { publicClaudeError } from './claude.js'
import { campaignIdFor, getCampaignLead } from './campaigns.js'
import { listGapAnalyses, runGapAnalysis } from './gapAnalysis.js'
import { SOLUTION_TYPES, buildMvp, imagesFor, loadPlanById, planMvp, researchLead, savePlan } from './mvpAgents.js'

// Background jobs: long work (MVP builds, gap analysis runs) belongs to the server, not to a browser tab.
// A job is a MongoDB document that moves through steps. Each step runs in its own server call, kept alive
// after the reply by Vercel's waitUntil, and hands the job to a fresh call for the next step, so no single call
// hits Vercel's 5-minute limit. A lock stops two calls running the same step; a job whose lock expired without
// finishing is picked up again the next time anyone has Gapwise open. Pages only watch the document.

export type JobKind = 'mvp' | 'gaps'
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

interface JobDoc {
  _id: ObjectId
  ownerId: string
  username: string
  kind: JobKind
  status: JobStatus
  step: string
  attempts: number
  lockUntil: Date
  origin: string
  title: string
  leadId: string | null
  campaignId: string | null
  input: Record<string, any>
  state: Record<string, any>
  output: Record<string, any> | null
  error: string
  errorDetail: string
  cancelRequested: boolean
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

const STEP_LOCK_MS = 290_000 // a little over the longest step, so a live step is never taken over
const MAX_STEP_ATTEMPTS = 3
const LIMIT_RETRIES = 5

let indexReady = false
async function jobs() {
  const col = (await getDb()).collection<JobDoc>('jobs')
  if (!indexReady) {
    await col.createIndex({ ownerId: 1, updatedAt: -1 })
    await col.createIndex({ status: 1, lockUntil: 1 })
    await col.createIndex({ finishedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })
    indexReady = true
  }
  return col
}

const ACTIVE: JobStatus[] = ['queued', 'running']
const ownerOf = (auth: AuthInfo) => auth.userId ?? 'admin'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Keeps work going after the reply is sent. On Vercel this is the platform's waitUntil (the same hook the
// @vercel/functions package uses); on a normal Node server the process simply stays up.
export function keepAlive(work: Promise<unknown>) {
  const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.()
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(work)
  work.catch(err => console.error('[jobs] background work failed:', err?.message ?? err))
}

// Hand the job to a fresh server call (its own 5-minute budget). Signed so only this server can trigger it.
async function handOff(job: Pick<JobDoc, '_id' | 'origin'>) {
  const id = String(job._id)
  try {
    await fetch(`${job.origin}/api/internal/jobs/${id}/run`, {
      method: 'POST',
      headers: { 'x-gapwise-job': sign(id, 'job-run') },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: any) {
    // If the hand-off fails, the job's lock expires and the next watcher picks it up.
    console.error('[jobs] hand-off failed:', err?.message ?? err)
  }
}

export const validRunSignature = (id: string, sig: string) => !!sig && safeEqual(sig, sign(id, 'job-run'))

function publicJob(j: JobDoc, auth?: AuthInfo) {
  const admin = auth?.role === 'admin'
  return {
    id: String(j._id),
    kind: j.kind,
    status: j.status,
    step: j.step,
    title: j.title,
    username: j.username,
    leadId: j.leadId,
    campaignId: j.campaignId,
    // The lead an MVP build is for, so any page can reopen it.
    lead: j.kind === 'mvp' ? j.input.lead ?? null : null,
    state: j.state,
    output: j.output,
    error: j.error + (admin && j.errorDetail ? ` Details: ${j.errorDetail}` : ''),
    cancelRequested: j.cancelRequested,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    finishedAt: j.finishedAt,
  }
}
export type PublicJob = ReturnType<typeof publicJob>

function describeError(err: unknown) {
  if (err instanceof GeminiError) return { message: err.message, detail: err.detail, status: err.status }
  const pub = publicClaudeError(err)
  return { message: pub.error, detail: err instanceof Error ? err.message.slice(0, 300) : '', status: pub.status }
}

// ── Creating and watching jobs ──

export async function createJob(auth: AuthInfo, origin: string, spec: {
  kind: JobKind; title: string; leadId?: string | null; campaignId?: string | null; input: Record<string, any>; state?: Record<string, any>; step: string
}) {
  const now = new Date()
  const doc: JobDoc = {
    _id: new ObjectId(),
    ownerId: ownerOf(auth),
    username: auth.username,
    kind: spec.kind,
    status: 'queued',
    step: spec.step,
    attempts: 0,
    lockUntil: new Date(0),
    origin,
    title: spec.title,
    leadId: spec.leadId ?? null,
    campaignId: spec.campaignId ?? null,
    input: spec.input,
    state: spec.state ?? {},
    output: null,
    error: '',
    errorDetail: '',
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  }
  await (await jobs()).insertOne(doc)
  keepAlive(runStep(String(doc._id)))
  return publicJob(doc, auth)
}

export async function activeJobOf(auth: AuthInfo, kind: JobKind, match: Record<string, unknown> = {}) {
  return (await jobs()).findOne({ ownerId: ownerOf(auth), kind, status: { $in: ACTIVE }, ...match })
}

// Jobs this person can see; any whose step went quiet are started again on the way.
export async function listJobs(auth: AuthInfo, filter: { kind?: JobKind; leadId?: string; campaignId?: string; activeOnly?: boolean; limit?: number }) {
  const q: Record<string, unknown> = { ownerId: ownerOf(auth) }
  if (filter.kind) q.kind = filter.kind
  if (filter.leadId) q.leadId = filter.leadId
  if (filter.campaignId) q.campaignId = filter.campaignId
  if (filter.activeOnly) q.status = { $in: [...ACTIVE, 'paused'] }
  const list = await (await jobs()).find(q).sort({ updatedAt: -1 }).limit(filter.limit ?? 20).toArray()
  for (const j of list) if (isStalled(j)) keepAlive(runStep(String(j._id)))
  return list.map(j => publicJob(j, auth))
}

export async function getJob(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  const j = await (await jobs()).findOne({ _id: new ObjectId(id), ...(auth.role === 'admin' ? {} : { ownerId: ownerOf(auth) }) })
  if (!j) return null
  if (isStalled(j)) keepAlive(runStep(id))
  return publicJob(j, auth)
}

const isStalled = (j: JobDoc) => ACTIVE.includes(j.status) && j.lockUntil.getTime() < Date.now() - 5000

export async function cancelJob(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  const col = await jobs()
  const filter = { _id: new ObjectId(id), ownerId: ownerOf(auth) }
  const j = await col.findOne(filter)
  if (!j) return null
  if (j.status === 'paused' || j.status === 'queued') {
    await col.updateOne(filter, { $set: { status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() } })
  } else if (j.status === 'running') {
    // The running step finishes; the job stops before the next one.
    await col.updateOne(filter, { $set: { cancelRequested: true, updatedAt: new Date() } })
  }
  return getJob(auth, id)
}

export async function resumeJob(auth: AuthInfo, id: string, origin: string) {
  if (!ObjectId.isValid(id)) return null
  const col = await jobs()
  const res = await col.updateOne(
    { _id: new ObjectId(id), ownerId: ownerOf(auth), status: { $in: ['paused', 'failed'] } },
    { $set: { status: 'queued', attempts: 0, error: '', errorDetail: '', cancelRequested: false, lockUntil: new Date(0), origin, updatedAt: new Date(), finishedAt: null } },
  )
  if (res.matchedCount) keepAlive(runStep(id))
  return getJob(auth, id)
}

// ── Running a step ──

async function patch(id: ObjectId, set: Record<string, unknown>) {
  await (await jobs()).updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() } })
}

// Claims the job's current step, runs it, then hands the job on. Safe to call many times: only one call wins.
export async function runStep(id: string) {
  if (!ObjectId.isValid(id)) return
  const col = await jobs()
  const now = new Date()
  const job = await col.findOneAndUpdate(
    { _id: new ObjectId(id), status: { $in: ACTIVE }, lockUntil: { $lt: now } },
    { $set: { status: 'running', lockUntil: new Date(now.getTime() + STEP_LOCK_MS), updatedAt: now } },
    { returnDocument: 'after' },
  )
  if (!job) return

  if (job.cancelRequested) {
    await patch(job._id, { status: 'cancelled', finishedAt: new Date(), lockUntil: new Date(0) })
    return
  }
  const auth = await authForOwner(job.ownerId)
  if (!auth) {
    await patch(job._id, { status: 'failed', error: 'The account that started this job is disabled or deleted.', finishedAt: new Date(), lockUntil: new Date(0) })
    return
  }

  try {
    const next = job.kind === 'mvp' ? await mvpStep(job, auth) : await gapsStep(job, auth)
    if (next === 'done') {
      await patch(job._id, { status: 'done', step: 'done', finishedAt: new Date(), lockUntil: new Date(0), attempts: 0 })
      return
    }
    if (next === 'paused') {
      await patch(job._id, { status: 'paused', lockUntil: new Date(0) })
      return
    }
    // Stop requested while this step ran: finish here instead of starting the next one.
    const fresh = await col.findOne({ _id: job._id }, { projection: { cancelRequested: 1 } })
    if (fresh?.cancelRequested) {
      await patch(job._id, { status: 'cancelled', step: next, finishedAt: new Date(), lockUntil: new Date(0) })
      return
    }
    // Hand on to a fresh call for the next step (release the lock first so it can claim it).
    await patch(job._id, { step: next, attempts: 0, lockUntil: new Date(0), status: 'queued' })
    await handOff(job)
  } catch (err) {
    const e = describeError(err)
    console.error(`[jobs] ${job.kind} ${job.step} failed (attempt ${job.attempts + 1}):`, e.detail || e.message)
    const attempts = job.attempts + 1
    // Setup problems (no key, bad key, tool turned off) won't fix themselves by retrying.
    const permanent = e.status === 400 || e.status === 403
    if (!permanent && attempts < MAX_STEP_ATTEMPTS) {
      await patch(job._id, { attempts, lockUntil: new Date(0), status: 'queued', error: `Retrying: ${e.message}` })
      await sleep(5000 * attempts)
      await handOff(job)
    } else {
      await patch(job._id, { status: 'failed', error: e.message, errorDetail: e.detail ?? '', attempts, lockUntil: new Date(0), finishedAt: new Date() })
    }
  }
}

// ── MVP: research → plan → build ──

async function mvpStep(job: JobDoc, auth: AuthInfo): Promise<string> {
  const { lead, preference } = job.input
  const s = job.state

  if (job.step === 'research') {
    let gap: Record<string, any> | null = null
    if (job.campaignId) {
      const cid = await campaignIdFor(auth, job.campaignId).catch(() => null)
      if (cid) gap = (await listGapAnalyses(cid).catch(() => [])).find(g => g.leadId === String(lead.id))?.result ?? null
    }
    let research: Record<string, any> | null = null
    let researchNote = ''
    await patch(job._id, { 'state.agents.research': 'active', 'state.researchStartedAt': new Date() })
    if (!auth.permissions.gemini) {
      researchNote = 'Web research skipped: gap analysis is turned off for this account, so the plan uses Graph8 data only.'
    } else {
      try {
        const r = await researchLead(lead, gap)
        research = { ...r.research, sources: r.sources }
      } catch (err) {
        researchNote = `Web research was not available (${err instanceof GeminiError ? err.message : 'error'}), so the plan uses Graph8 data only.`
      }
    }
    await patch(job._id, {
      'state.gap': gap, 'state.research': research, 'state.researchNote': researchNote, 'state.usedGapAnalysis': !!gap,
      'state.agents.research': research ? 'done' : 'skipped', 'state.researchDoneAt': new Date(),
    })
    return 'plan'
  }

  if (job.step === 'plan') {
    if (!auth.permissions.claude) throw Object.assign(new Error('MVP generation with Claude is turned off for this account.'), { status: 403 })
    await patch(job._id, { 'state.agents.strategy': 'active', 'state.agents.design': 'active', 'state.planStartedAt': new Date() })
    const { industry, images } = imagesFor(String(lead.type ?? ''), `${lead.name} ${lead.enrichment?.company?.description ?? ''}`)
    const plan = await planMvp(lead, s.gap ?? null, s.research ?? null, images, preference)
    const saved = await savePlan(auth, {
      leadId: String(lead.id ?? lead.name), leadName: String(lead.name), lead, research: s.research ?? null,
      researchNote: s.researchNote ?? '', plan, images, industry,
    })
    await patch(job._id, {
      'state.planId': String(saved._id), 'state.plan': plan, 'state.images': images, 'state.industry': industry,
      'state.agents.strategy': 'done', 'state.agents.design': 'done', 'state.planDoneAt': new Date(),
    })
    return 'build'
  }

  if (job.step === 'build') {
    if (!auth.permissions.claude) throw Object.assign(new Error('MVP generation with Claude is turned off for this account.'), { status: 403 })
    const doc = await loadPlanById(String(s.planId ?? job.input.planId ?? ''))
    if (!doc) throw Object.assign(new Error('The plan for this build has expired. Plan the MVP again.'), { status: 400 })
    await patch(job._id, { 'state.agents.build': 'active', 'state.buildStartedAt': new Date(), 'state.build': { chars: 0, action: 'Starting' } })
    let lastSave = 0
    const html = await buildMvp(doc, ({ action, chars }) => {
      // Progress is saved at most every 2 seconds.
      if (Date.now() - lastSave > 2000) { lastSave = Date.now(); void patch(job._id, { 'state.build': { chars, action } }) }
    })
    const type = String(doc.plan?.solution?.type ?? 'booking-page')
    const { insertedId } = await (await getDb()).collection('mvp_drafts').insertOne({
      html, leadId: doc.leadId, leadName: doc.leadName, mvpType: type, createdAt: new Date(),
    })
    const meta = SOLUTION_TYPES[type] ?? SOLUTION_TYPES['booking-page']
    await (await jobs()).updateOne({ _id: job._id }, {
      $set: {
        'state.agents.build': 'done',
        'state.buildDoneAt': new Date(),
        'state.build': { chars: html.length, action: 'Done' },
        'state.plan': s.plan ?? doc.plan,
        'state.images': s.images ?? doc.images,
        output: {
          title: String(doc.plan?.solution?.title || meta.title),
          tag: meta.title,
          description: String(doc.plan?.solution?.promise || meta.description),
          fixes: (doc.plan?.solution?.fixesGaps ?? []).join(', '),
          steps: (doc.plan?.flow ?? []).map((f: any) => String(f.screen ?? '')).filter(Boolean),
          html,
          draftId: String(insertedId),
          solutionType: type,
        },
      },
    })
    return 'done'
  }
  return 'done'
}

// ── Gap analysis: one lead per step ──

async function gapsStep(job: JobDoc, auth: AuthInfo): Promise<string> {
  const s = job.state as { queue: Array<{ id: string; name: string }>; done: number; total: number; durations: number[]; limitRetries?: number }
  if (!s.queue?.length) return 'done'
  if (!auth.permissions.gemini) throw Object.assign(new Error('Gap analysis is turned off for this account.'), { status: 403 })
  const [lead, ...rest] = s.queue
  const found = await getCampaignLead(auth, String(job.campaignId), lead.id)
  if (!found) {
    // The lead was removed from the campaign: skip it.
    await patch(job._id, { 'state.queue': rest, 'state.total': Math.max(0, s.total - 1) })
    return rest.length ? 'lead' : 'done'
  }
  const startedAt = Date.now()
  await patch(job._id, { 'state.current': { leadId: lead.id, leadName: lead.name, phase: 'starting', phaseAt: startedAt, startedAt, seen: ['starting'] }, 'state.retry': null })
  const seen: string[] = ['starting']
  try {
    await runGapAnalysis(auth, found.campaignId, found.lead, stage => {
      seen.push(stage)
      void patch(job._id, { 'state.current': { leadId: lead.id, leadName: lead.name, phase: stage, phaseAt: Date.now(), startedAt, seen: [...seen] } })
    })
  } catch (err) {
    if (err instanceof GeminiError && err.status === 429 && (s.limitRetries ?? 0) < LIMIT_RETRIES) {
      // Usage limit: wait (30 s, 60 s, …, capped so the call stays within its budget) and try this lead again.
      const attempt = (s.limitRetries ?? 0) + 1
      const wait = Math.min(30_000 * attempt, 120_000)
      await patch(job._id, { 'state.current': null, 'state.limitRetries': attempt, 'state.retry': { at: Date.now() + wait, attempt, of: LIMIT_RETRIES, reason: err.message } })
      await sleep(wait)
      return 'lead'
    }
    const e = describeError(err)
    await patch(job._id, { 'state.current': null, 'state.retry': null, 'state.lastError': `${lead.name}: ${e.message}`, error: `${lead.name}: ${e.message}`, errorDetail: e.detail ?? '' })
    return 'paused'
  }
  await patch(job._id, {
    'state.queue': rest,
    'state.done': s.done + 1,
    'state.durations': [...(s.durations ?? []), Date.now() - startedAt].slice(-10),
    'state.current': null,
    'state.retry': null,
    'state.limitRetries': 0,
    'state.lastError': '',
    error: '',
  })
  return rest.length ? 'lead' : 'done'
}

export async function deleteJobsFor(ownerId: string) {
  await (await jobs()).deleteMany({ ownerId })
}
