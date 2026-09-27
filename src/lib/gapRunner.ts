import { useSyncExternalStore } from 'react'
import { runGapAnalysis, type GapAnalysis, type GapStage } from './api'

// Gap analysis runs live here, outside any page, so they keep going while the person uses the rest of the
// app. The queue is saved in localStorage: if the tab is closed or refreshed mid-run, the remaining leads
// come back as a paused run that can be resumed. (The lead in progress still finishes on the server.)

export type Phase = 'starting' | GapStage
export interface RunProgress { leadId: string; leadName: string; phase: Phase; phaseAt: number; startedAt: number; seen: Phase[] }
interface QueuedLead { id: string; name: string }
interface Paused { campaignId: string; campaignName: string; queue: QueuedLead[]; total: number; done: number }

export interface RunnerState {
  campaignId: string | null
  campaignName: string
  queue: QueuedLead[]
  total: number
  done: number
  current: RunProgress | null
  stopping: boolean
  durations: number[]
  lastError: string
  // Set while waiting to retry a lead that hit the usage limit.
  retry: { at: number; attempt: number; of: number; reason: string } | null
  // Finished analyses from this session, keyed `${campaignId}:${leadId}`, so pages can show them.
  results: Record<string, GapAnalysis>
  paused: Paused | null
}

const KEY = 'gapwise:gap-run'
let owner = ''
let state: RunnerState = {
  campaignId: null, campaignName: '', queue: [], total: 0, done: 0, current: null,
  stopping: false, durations: [], lastError: '', retry: null, results: {}, paused: null,
}
const listeners = new Set<() => void>()

function set(patch: Partial<RunnerState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

function save(remaining: QueuedLead[] | null) {
  try {
    if (!remaining?.length || !state.campaignId) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify({
      owner, campaignId: state.campaignId, campaignName: state.campaignName, queue: remaining, total: state.total, done: state.done,
    }))
  } catch { /* storage blocked: the run just can't be resumed after a refresh */ }
}

// Warn before leaving the site while a run is going.
function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

export const isRunning = () => !!state.current || state.queue.length > 0 || !!state.retry

// Called once the signed-in person is known, to pick up a run their previous visit left unfinished.
export function initRunner(username: string) {
  if (owner === username) return
  owner = username
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved?.owner === username && saved.queue?.length && !isRunning()) {
      set({ paused: { campaignId: saved.campaignId, campaignName: saved.campaignName, queue: saved.queue, total: saved.total, done: saved.done } })
    } else if (saved && saved.owner !== username) {
      set({ paused: null })
    }
  } catch { /* ignore */ }
}

export function startRun(campaign: { id: string; name: string }, leads: QueuedLead[], resumeFrom?: { total: number; done: number }) {
  if (isRunning() || !leads.length) return
  set({
    campaignId: campaign.id, campaignName: campaign.name,
    queue: leads.map(l => ({ id: l.id, name: l.name })),
    total: resumeFrom?.total ?? leads.length, done: resumeFrom?.done ?? 0,
    stopping: false, lastError: '', paused: null,
  })
  save(state.queue)
  window.addEventListener('beforeunload', onBeforeUnload)
  void loop()
}

export function stopRun() {
  if (isRunning()) set({ stopping: true })
}

export function resumeRun() {
  const p = state.paused
  if (!p) return
  startRun({ id: p.campaignId, name: p.campaignName }, p.queue, { total: p.total, done: p.done })
}

export function dismissPaused() {
  set({ paused: null })
  save(null)
}

// When the research service is at its usage limit, wait and try the same lead again: 30 s, 60 s, 90 s…
const LIMIT_RETRIES = 5
const retryWaitMs = (attempt: number) => 30_000 * attempt

async function waitUnlessStopped(ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until && !state.stopping) await new Promise(r => setTimeout(r, 500))
}

async function loop() {
  const campaignId = state.campaignId!
  let limitRetries = 0
  while (state.queue.length && !state.stopping) {
    const [lead, ...rest] = state.queue
    const startedAt = Date.now()
    set({ queue: rest, retry: null, current: { leadId: lead.id, leadName: lead.name, phase: 'starting', phaseAt: startedAt, startedAt, seen: ['starting'] } })
    save([lead, ...rest])
    try {
      const analysis = await runGapAnalysis(campaignId, lead.id, stage => {
        const c = state.current
        if (c) set({ current: { ...c, phase: stage, phaseAt: Date.now(), seen: [...c.seen, stage] } })
      })
      set({
        results: { ...state.results, [`${campaignId}:${lead.id}`]: analysis },
        durations: [...state.durations, Date.now() - startedAt].slice(-10),
        done: state.done + 1,
        current: null,
      })
      limitRetries = 0
      save(state.queue)
    } catch (err: any) {
      if (err?.status === 429 && limitRetries < LIMIT_RETRIES && !state.stopping) {
        limitRetries++
        const wait = retryWaitMs(limitRetries)
        // Put the lead back at the front and try it again after the wait.
        set({ queue: [lead, ...state.queue], current: null, retry: { at: Date.now() + wait, attempt: limitRetries, of: LIMIT_RETRIES, reason: err.message } })
        await waitUnlessStopped(wait)
        set({ retry: null })
        continue
      }
      // A key or quota problem fails every lead the same way, so pause and let the person resume later.
      const remaining = [lead, ...state.queue]
      set({
        lastError: `${lead.name}: ${err.message}`,
        current: null,
        queue: [],
        paused: remaining.length ? { campaignId, campaignName: state.campaignName, queue: remaining, total: state.total, done: state.done } : null,
      })
      save(remaining)
      break
    }
  }
  if (state.stopping && state.queue.length) {
    set({ paused: { campaignId, campaignName: state.campaignName, queue: state.queue, total: state.total, done: state.done }, queue: [] })
  } else if (!state.lastError) {
    save(null)
  }
  set({ current: null, stopping: false, retry: null })
  window.removeEventListener('beforeunload', onBeforeUnload)
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
