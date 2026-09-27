import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FC, type ReactNode } from 'react'

// A guided walkthrough: dims the page, spotlights one element at a time (found by its data-tour attribute),
// and points at it with a card and an arrow. Used for the first-visit tour and for one-step page hints.

export interface TourStep {
  target?: string // data-tour value; no target = a centred card
  title: string
  body: ReactNode
  // Called before the step shows, e.g. to open the phone menu or switch page.
  prepare?: () => void
}

interface Props {
  steps: TourStep[]
  onClose: (completed: boolean) => void
  finishLabel?: string
  onFinish?: () => void
}

type Placement = 'right' | 'left' | 'bottom' | 'top' | 'center'
const CARD_W = 320
const GAP = 16
const PAD = 8

function findTarget(target?: string) {
  if (!target) return null
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
  // The first one that is actually visible (a target can exist both in the sidebar and the phone menu).
  return els.find(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }) ?? null
}

function place(rect: DOMRect | null, cardH: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!rect) return { placement: 'center' as Placement, top: vh / 2 - cardH / 2, left: vw / 2 - CARD_W / 2, arrow: 0 }
  const fits = {
    right: rect.right + GAP + CARD_W < vw - 8,
    left: rect.left - GAP - CARD_W > 8,
    bottom: rect.bottom + GAP + cardH < vh - 8,
    top: rect.top - GAP - cardH > 8,
  }
  const clampX = (x: number) => Math.max(8, Math.min(vw - CARD_W - 8, x))
  const clampY = (y: number) => Math.max(8, Math.min(vh - cardH - 8, y))
  if (fits.right || fits.left) {
    const side: Placement = fits.right ? 'right' : 'left'
    const top = clampY(rect.top + rect.height / 2 - cardH / 2)
    return { placement: side, top, left: side === 'right' ? rect.right + GAP : rect.left - GAP - CARD_W, arrow: rect.top + rect.height / 2 - top }
  }
  const side: Placement = fits.bottom || !fits.top ? 'bottom' : 'top'
  const left = clampX(rect.left + rect.width / 2 - CARD_W / 2)
  return { placement: side, top: side === 'bottom' ? rect.bottom + GAP : rect.top - GAP - cardH, left, arrow: rect.left + rect.width / 2 - left }
}

const Tour: FC<Props> = ({ steps, onClose, finishLabel, onFinish }) => {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [cardH, setCardH] = useState(180)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  // Steps may be rebuilt on every render of the parent; only moving to another step restarts one.
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const step = steps[i]
  const last = i === steps.length - 1

  // Prepare the step, bring its target into view, then keep the spotlight on it (it may move or animate in).
  useEffect(() => {
    const step = stepsRef.current[i]
    step.prepare?.()
    let frame = 0
    let scrolled = false
    const update = () => {
      const el = findTarget(step.target)
      if (el && !scrolled) {
        scrolled = true
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      const r = el?.getBoundingClientRect() ?? null
      setRect(prev => (prev && r && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r))
      frame = requestAnimationFrame(update)
    }
    // Give the page a moment to render what `prepare` opened.
    const t = setTimeout(() => { frame = requestAnimationFrame(update) }, step.prepare ? 260 : 0)
    return () => { clearTimeout(t); cancelAnimationFrame(frame) }
  }, [i])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  }, [i, rect])

  useEffect(() => { nextRef.current?.focus() }, [i])

  const next = useCallback(() => {
    if (last) { onFinish?.(); onClose(true) } else setI(n => n + 1)
  }, [last, onClose, onFinish])
  const back = useCallback(() => setI(n => Math.max(0, n - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false)
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onClose])

  const pos = place(rect, cardH)
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="tour-spot"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={cardRef}
        className={`tour-card tour-${pos.placement}`}
        style={{ top: pos.top, left: pos.left, width: CARD_W }}
        key={i}
      >
        {pos.placement !== 'center' && (
          <span
            className="tour-arrow"
            aria-hidden
            style={pos.placement === 'left' || pos.placement === 'right' ? { top: Math.max(18, Math.min(cardH - 18, pos.arrow)) } : { left: Math.max(18, Math.min(CARD_W - 18, pos.arrow)) }}
          >
            <svg viewBox="0 0 40 24" width="40" height="24"><path d="M2 12h30M24 4l10 8-10 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        )}
        {steps.length > 1 && <div className="tour-count">Step {i + 1} of {steps.length}</div>}
        <h2 id="tour-title">{step.title}</h2>
        <div className="tour-body">{step.body}</div>
        {steps.length > 1 && (
          <div className="tour-dots" aria-hidden>{steps.map((_, n) => <span key={n} className={n === i ? 'on' : n < i ? 'seen' : ''} />)}</div>
        )}
        <div className="tour-actions">
          {steps.length > 1 && !last && <button className="tour-skip" onClick={() => onClose(false)}>Skip tour</button>}
          <span className="tour-spacer" />
          {i > 0 && <button className="btn-secondary" onClick={back}>Back</button>}
          <button ref={nextRef} className="btn-primary" onClick={next}>
            {last ? finishLabel ?? (steps.length > 1 ? 'Finish' : 'Got it') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Tour
