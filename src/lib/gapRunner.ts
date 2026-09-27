import { useSyncExternalStore } from 'react'
import {
  cancelJob, listJobs, resumeJob, startGapsJob, isActiveJob,
  type GapAnalysis, type GapStage, type GapsJob, type Job, type MvpJob,
} from './api'

// Watches the person's background jobs. The work itself runs on the server (see server/jobs.ts), so it keeps
// going when they switch pages, refresh or close the tab; this store just reflects the latest state for the
// Gap analysis page and the sidebar chip, polling quickly while something runs and slowly otherwise.

export type Phase = 'starting' | GapStage
export interface RunProgress { leadId: string; leadName: string; phase: Phase; phaseAt: number; startedAt: number; seen: Phase[] }
interface QueuedLead { id: string; name: string }
interface Paused { jobId: string; campaignId: string; campaignName: string; queue: QueuedLead[]; total: number; done: number }
export interface MvpJobSummary { id: string; title: string; leadId: string | null; campaignId: string | null; step: string; chars: number; action: string }

export interface RunnerState {
  jobId: string | null
  campaignId: string | null
  campaignName: string
  queue: QueuedLead[]
  total: number
  done: number
  current: RunProgress | null
  stopping: boolean
  durations: number[]
  lastError: string
  retry: { at: number; attempt: number; of: number; reason: string } | null
  // Kept for the page's merge logic; results now come from the server (the page reloads them as leads finish).
  results: Record<string, GapAnalysis>
  paused: Paused | null
  // MVP builds running on the server.
  mvpJobs: MvpJobSummary[]
}

const EMPTY: RunnerState = {
  jobId: null, campaignId: null, campaignName: '', queue: [], total: 0, done: 0, current: null,
  stopping: false, durations: [], lastError: '', retry: null, results: {}, paused: null, mvpJobs: [],
}
let state: RunnerState = EMPTY
let owner = ''
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<RunnerState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

const campaignNameOf = (j: Job) => String(j.title).replace(/^Gap analysis:\s*/, '')

function applyGaps(j: GapsJob | null) {
  if (!j) {
    set({ jobId: null, campaignId: null, campaignName: '', queue: [], total: 0, done: 0, current: null, stopping: false, retry: null, paused: null })
    return
  }
  const s = j.state
  if (isActiveJob(j)) {
    const current = s.current ? { ...s.current, phase: s.current.phase as Phase, seen: s.current.seen as Phase[] } : null
    // The lead being researched stays in the server's queue until it finishes; show it as current, not queued.
    const queue = current ? s.queue.filter(q => q.id !== current.leadId) : s.queue
    set({
      jobId: j.id, campaignId: j.campaignId, campaignName: campaignNameOf(j), queue, total: s.total, done: s.done,
      current, stopping: j.cancelRequested, durations: s.durations ?? [], retry: s.retry ?? null,
      lastError: s.lastError ?? '', paused: null,
    })
  } else if (j.status === 'paused' || j.status === 'failed') {
    set({
      jobId: null, current: null, queue: [], retry: null, stopping: false,
      campaignId: j.campaignId, campaignName: campaignNameOf(j), total: s.total, done: s.done,
      lastError: j.error || s.lastError || '',
      paused: s.queue?.length ? { jobId: j.id, campaignId: String(j.campaignId), campaignName: campaignNameOf(j), queue: s.queue, total: s.total, done: s.done } : null,
    })
  } else {
    set({ jobId: null, current: null, queue: [], retry: null, stopping: false, paused: null, done: s.done, total: s.total, lastError: '' })
  }
}

async function poll() {
  if (timer) { clearTimeout(timer); timer = null }
  if (!owner) return
  try {
    const { jobs } = await listJobs({ active: true, limit: 20 })
    const gaps = (jobs.find(j => j.kind === 'gaps' && isActiveJob(j)) ?? jobs.find(j => j.kind === 'gaps')) as GapsJob | undefined
    applyGaps(gaps ?? null)
    const mvps = (jobs.filter(j => j.kind === 'mvp' && isActiveJob(j)) as MvpJob[]).map(j => ({
      id: j.id, title: j.title, leadId: j.leadId, campaignId: j.campaignId, step: j.step,
      chars: j.state.build?.chars ?? 0, action: j.state.build?.action ?? '',
    }))
    set({ mvpJobs: mvps })
  } catch { /* offline or signed out: try again later */ }
  const busy = isRunning() || state.mvpJobs.length > 0
  timer = setTimeout(poll, busy ? 2500 : 20_000)
}

export const isRunning = () => !!state.jobId

// Called once the signed-in person is known: start watching their jobs.
export function initRunner(username: string) {
  if (owner === username) return
  owner = username
  state = EMPTY
  void poll()
}

// Check right away (e.g. after starting an MVP build elsewhere).
export const refreshRunner = () => { void poll() }

export async function startRun(campaign: { id: string; name: string }, leads: QueuedLead[]) {
  if (isRunning() || !leads.length) return
  try {
    const { job } = await startGapsJob(campaign.id, campaign.name, leads.map(l => ({ id: l.id, name: l.name })))
    applyGaps(job)
  } catch (err: any) {
    set({ lastError: err.message, campaignId: campaign.id })
  }
  void poll()
}

export async function stopRun() {
  if (!state.jobId) return
  set({ stopping: true })
  await cancelJob(state.jobId).catch(() => {})
  void poll()
}

export async function resumeRun() {
  const p = state.paused
  if (!p) return
  await resumeJob(p.jobId).catch(err => set({ lastError: err.message }))
  void poll()
}

export async function dismissPaused() {
  const p = state.paused
  set({ paused: null, lastError: '' })
  if (p) await cancelJob(p.jobId).catch(() => {})
}

export function useGapRunner() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => state)
}

// Share of one lead done. Stage changes are real server events; within a stage the bar eases toward that
// stage's ceiling, so it keeps moving but never claims a step that hasn't finished.
export function leadPercent(p: RunProgress, now: number, expectedMs: number): number {
  const t = Math.max(0, now - p.phaseAt)
  const ease = (from: number, to: number, tau: number) => from + (to - from) * (1 - Math.exp(-t / tau))
  switch (p.phase) {
    case 'starting': return ease(0, 5, 800)
    case 'graph8': return ease(5, 15, 1500)
    case 'research': return ease(15, 92, expectedMs / 2.2)
    case 'saving': return ease(93, 98, 600)
    default: return 0
  }
}

export const averageMs = (s: RunnerState) => (s.durations.length ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length : 0)

export function overallPercent(s: RunnerState, now: number) {
  if (!s.total) return 0
  const lead = s.current ? leadPercent(s.current, now, averageMs(s) || 30_000) : 0
  return ((s.done + lead / 100) / s.total) * 100
}

export const formatDuration = (ms: number) => {
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`
}
