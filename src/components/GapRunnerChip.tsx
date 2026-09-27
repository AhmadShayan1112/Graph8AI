import { useEffect, useState, type FC } from 'react'
import { overallPercent, useGapRunner } from '../lib/gapRunner'

// Shows a gap-analysis run from anywhere in the app, so people can leave the page and keep an eye on it.
const GapRunnerChip: FC<{ onOpen: (campaignId: string) => void; compact?: boolean }> = ({ onOpen, compact }) => {
  const run = useGapRunner()
  const [now, setNow] = useState(Date.now())
  const active = !!run.current || run.queue.length > 0 || !!run.retry

  useEffect(() => {
    if (!run.current && !run.retry) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [run.current, run.retry])

  if (!active && !run.paused) return null

  if (!active && run.paused) {
    const p = run.paused
    return (
      <button className={`runner-chip paused ${compact ? 'compact' : ''}`} onClick={() => onOpen(p.campaignId)} title="Open gap analysis to resume">
        <span className="runner-chip-title">Gap analysis paused</span>
        {!compact && <span className="runner-chip-sub">{p.queue.length} lead{p.queue.length === 1 ? '' : 's'} left in {p.campaignName}</span>}
      </button>
    )
  }

  const pct = Math.floor(overallPercent(run, now))
  return (
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

export default GapRunnerChip
