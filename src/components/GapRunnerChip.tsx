import { useEffect, useState, type FC, type ReactNode } from 'react'
import { overallPercent, useGapRunner, type MvpJobSummary } from '../lib/gapRunner'

// Shows a gap-analysis run from anywhere in the app, so people can leave the page and keep an eye on it.
const GapRunnerChip: FC<{ onOpen: (campaignId: string) => void; onOpenBuild?: (job: MvpJobSummary) => void; compact?: boolean }> = ({ onOpen, onOpenBuild, compact }) => {
  const run = useGapRunner()
  const [now, setNow] = useState(Date.now())
  const active = !!run.jobId

  useEffect(() => {
    if (!run.current && !run.retry) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [run.current, run.retry])

  const builds = run.mvpJobs.map(j => {
    const label = j.step === 'research' ? 'Researching' : j.step === 'plan' ? 'Planning & designing' : j.step === 'build' ? (j.action || 'Building') : 'Starting'
    return (
      <button key={j.id} className={`runner-chip ${compact ? 'compact' : ''}`} onClick={() => onOpenBuild?.(j)} title="Open this MVP build">
        <span className="runner-chip-row">
          <span className="runner-chip-title"><span className="runner-dot" aria-hidden />{compact ? 'Building MVP' : j.title}</span>
          {j.step === 'build' && <span className="runner-chip-pct">{Math.min(95, Math.round((j.chars / 30_000) * 100))}%</span>}
        </span>
        {!compact && <span className="runner-chip-sub">{label}</span>}
      </button>
    )
  })

  let gaps: ReactNode = null
  if (!active && run.paused) {
    const p = run.paused
    gaps = (
      <button className={`runner-chip paused ${compact ? 'compact' : ''}`} onClick={() => onOpen(p.campaignId)} title="Open gap analysis to resume">
        <span className="runner-chip-title">Gap analysis paused</span>
        {!compact && <span className="runner-chip-sub">{p.queue.length} lead{p.queue.length === 1 ? '' : 's'} left in {p.campaignName}</span>}
      </button>
    )
  } else if (active) {
    const pct = Math.floor(overallPercent(run, now))
    gaps = (
      <button className={`runner-chip ${compact ? 'compact' : ''}`} onClick={() => run.campaignId && onOpen(run.campaignId)} title="Open gap analysis">
        <span className="runner-chip-row">
          <span className="runner-chip-title"><span className="runner-dot" aria-hidden />Analysing {Math.min(run.done + 1, run.total)} of {run.total}</span>
          <span className="runner-chip-pct">{pct}%</span>
        </span>
        {!compact && (
          <span className="runner-chip-sub">
            {run.retry ? `Limit reached, retrying in ${Math.max(0, Math.ceil((run.retry.at - now) / 1000))}s`
              : run.stopping ? 'Stopping after this lead' : run.current?.leadName ?? run.campaignName}
          </span>
        )}
        <span className="runner-chip-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
      </button>
    )
  }

  if (!gaps && !builds.length) return null
  return <>{gaps}{compact ? builds.slice(0, 1) : builds}</>
}

export default GapRunnerChip
