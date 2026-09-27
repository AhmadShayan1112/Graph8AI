import { useEffect, useState, type CSSProperties, type FC } from 'react'

// The sign-in page's one moving thing: what Gapwise does to a single business, from gaps found to fix sent.
// Each business plays once (about 6 s), then the next one takes its place.
const STORIES = [
  {
    name: 'Riverbend Dental',
    place: 'Dental clinic, Lahore',
    score: 38,
    gaps: ['No online booking', 'Not mobile-friendly', 'No SSL certificate'],
    fix: 'Booking page',
    sent: 'Sent to Dr. Amina Qureshi',
    result: 'Opened twice',
  },
  {
    name: 'Olive & Ember',
    place: 'Restaurant, Karachi',
    score: 44,
    gaps: ['Menu is a PDF', 'No online ordering', '6.8 s to load on mobile'],
    fix: 'Ordering page',
    sent: 'Sent to Bilal, owner',
    result: 'Replied: “Thursday works”',
  },
  {
    name: 'Cedar Bark HVAC',
    place: 'Heating & cooling, Dubai',
    score: 51,
    gaps: ['No contact form', 'Phone number hidden', 'Hours missing on Google'],
    fix: 'Quote request form',
    sent: 'Sent to the service manager',
    result: 'Booked a call',
  },
]

const CYCLE_MS = 6800
const RING = 2 * Math.PI * 20

const AuditDemo: FC = () => {
  const [i, setI] = useState(0)
  const [still, setStill] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    setStill(reduce.matches)
    if (reduce.matches) return
    const t = setInterval(() => setI(n => (n + 1) % STORIES.length), CYCLE_MS)
    return () => clearInterval(t)
  }, [])

  const s = STORIES[i]

  return (
    <div className={`demo ${still ? 'is-still' : ''}`} aria-hidden>
      <div className="demo-stack" />
      <div className="demo-card" key={i}>
        <div className="demo-head">
          <div>
            <div className="demo-name">{s.name}</div>
            <div className="demo-place">{s.place}</div>
          </div>
          <div className="demo-score">
            <svg viewBox="0 0 48 48" width="48" height="48">
              <circle cx="24" cy="24" r="20" className="demo-ring-bg" />
              <circle
                cx="24" cy="24" r="20" className="demo-ring"
                style={{ strokeDasharray: RING, '--ring-end': RING * (1 - s.score / 100) } as unknown as CSSProperties}
              />
            </svg>
            <span>{s.score}</span>
          </div>
        </div>

        <ul className="demo-gaps">
          {s.gaps.map((g, n) => (
            <li key={g} style={{ animationDelay: `${0.5 + n * 0.45}s` }}>
              <span className="demo-x" />{g}
            </li>
          ))}
        </ul>

        <div className="demo-build">
          <div className="demo-build-row">
            <span>Building {s.fix.toLowerCase()}</span>
            <span className="demo-build-done">Live</span>
          </div>
          <div className="demo-bar"><span /></div>
        </div>

        <div className="demo-sent">
          <span className="demo-check" />
          <div>
            <div>{s.sent}</div>
            <div className="demo-result">{s.result}</div>
          </div>
        </div>
      </div>

      <div className="demo-dots">
        {STORIES.map((_, n) => <span key={n} className={n === i ? 'on' : ''} />)}
      </div>
    </div>
  )
}

export default AuditDemo
