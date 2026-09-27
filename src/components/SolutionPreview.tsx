import { useEffect, useState, type FC } from 'react'

// Live previews for the landing page's Solutions list: each one plays a short loop of that solution
// working for a real-looking business, inside a browser frame. Reduced motion shows the finished state.

function useSteps(count: number, ms: number) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStep(count - 1); return }
    setStep(0)
    // Hold on the last step a little longer before starting over.
    let n = 0
    const t = setInterval(() => { n = (n + 1) % (count + 2); setStep(Math.min(n, count - 1)) }, ms)
    return () => clearInterval(t)
  }, [count, ms])
  return step
}

const Booking: FC = () => {
  const s = useSteps(6, 850)
  const days = [['Mon', 14], ['Tue', 15], ['Wed', 16], ['Thu', 17], ['Fri', 18]] as const
  const slots = ['9:00', '10:30', '11:15', '1:00', '2:30', '4:00']
  return (
    <div className="sp-page">
      <div className="sp-head"><strong>Riverbend Dental</strong><span>Book a visit</span></div>
      <div className="sp-chips">
        {['Cleaning', 'Check-up', 'Whitening'].map((c, i) => <span key={c} className={`sp-chip ${i === 0 && s >= 1 ? 'on' : ''}`}>{c}</span>)}
      </div>
      <div className="sp-days">
        {days.map(([d, n], i) => (
          <span key={d} className={`sp-day ${i === 3 && s >= 2 ? 'on' : ''}`}><small>{d}</small>{n}</span>
        ))}
      </div>
      <div className="sp-slots">
        {slots.map((t, i) => <span key={t} className={`sp-slot ${i === 1 && s >= 3 ? 'on' : ''} ${i === 4 ? 'taken' : ''}`}>{t}</span>)}
      </div>
      <div className={`sp-cta ${s >= 4 ? 'pressed' : ''}`}>Confirm booking</div>
      <div className={`sp-toast ${s >= 5 ? 'show' : ''}`}>✓ Booked Thu 17, 10:30 · SMS reminder set</div>
    </div>
  )
}

const Landing: FC = () => {
  const s = useSteps(5, 900)
  const score = [34, 52, 78, 94, 98][s]
  const c = 2 * Math.PI * 22
  return (
    <div className="sp-page sp-landing">
      <div className="sp-hero">
        <div className="sp-kicker">Emergency plumbing · Houston</div>
        <div className="sp-title">Burst pipe? We’re there in 45 minutes.</div>
        <div className="sp-row">
          <span className="sp-cta small">Call now</span>
          <span className="sp-ghost">★ 4.9 from 312 reviews</span>
        </div>
      </div>
      <div className="sp-metrics">
        <div className="sp-gauge">
          <svg viewBox="0 0 52 52" width="64" height="64" aria-hidden>
            <circle cx="26" cy="26" r="22" fill="none" stroke="#E7E7E3" strokeWidth="5" />
            <circle cx="26" cy="26" r="22" fill="none" stroke={score >= 90 ? '#22A06B' : score >= 50 ? '#B38600' : '#DE350B'} strokeWidth="5"
              strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 26 26)" className="sp-gauge-arc" />
          </svg>
          <span>{score}</span>
        </div>
        <div className="sp-stats">
          <div><small>Load time</small><strong>{['4.2s', '2.6s', '1.4s', '0.9s', '0.8s'][s]}</strong></div>
          <div><small>Mobile</small><strong>{s >= 3 ? 'Pass' : 'Fail'}</strong></div>
          <div><small>Schema</small><strong>{s >= 2 ? 'Added' : 'Missing'}</strong></div>
        </div>
      </div>
    </div>
  )
}

const Menu: FC = () => {
  const s = useSteps(6, 800)
  const items = [
    { n: 'Wood-fired margherita', p: '$14' },
    { n: 'Lamb kofta plate', p: '$18' },
    { n: 'Charred halloumi salad', p: '$12' },
  ]
  const count = s >= 4 ? 2 : s >= 2 ? 1 : 0
  return (
    <div className="sp-page">
      <div className="sp-head"><strong>Olive &amp; Ember</strong><span className={`sp-cart ${count ? 'bump' : ''}`} key={count}>Cart · {count}</span></div>
      <div className="sp-tabs"><span className="on">Mains</span><span>Sides</span><span>Drinks</span></div>
      <ul className="sp-menu">
        {items.map((it, i) => (
          <li key={it.n} className={(i === 0 && s >= 1 && s < 3) || (i === 1 && s >= 3 && s < 5) ? 'hover' : ''}>
            <span className="sp-dish" aria-hidden />
            <span className="sp-menu-name">{it.n}<small>{it.p}</small></span>
            <span className={`sp-add ${(i === 0 && s >= 2) || (i === 1 && s >= 4) ? 'added' : ''}`}>{(i === 0 && s >= 2) || (i === 1 && s >= 4) ? '✓' : '+'}</span>
          </li>
        ))}
      </ul>
      <div className={`sp-cta ${s >= 5 ? 'pressed' : ''}`}>{count ? `Order for pickup · $${count === 2 ? 32 : 14}` : 'Order for pickup'}</div>
    </div>
  )
}

const Quote: FC = () => {
  const s = useSteps(5, 900)
  const sizes = [800, 1200, 1600, 2000, 2000]
  const prices = ['$—', '$860', '$1,120', '$1,340', '$1,340']
  const pos = [15, 38, 60, 80, 80][s]
  return (
    <div className="sp-page">
      <div className="sp-head"><strong>Cedar Bark HVAC</strong><span>Instant quote</span></div>
      <label className="sp-field"><small>Service</small><span className="sp-select">AC replacement ▾</span></label>
      <label className="sp-field">
        <small>Home size · {sizes[s].toLocaleString()} sq ft</small>
        <span className="sp-range"><span className="sp-range-fill" style={{ width: `${pos}%` }} /><span className="sp-range-thumb" style={{ left: `${pos}%` }} /></span>
      </label>
      <div className="sp-price">
        <small>Estimated price</small>
        <strong key={prices[s]}>{prices[s]}</strong>
        <span>Includes install and 5-year warranty</span>
      </div>
      <div className={`sp-cta ${s >= 4 ? 'pressed' : ''}`}>{s >= 4 ? '✓ Quote sent to your email' : 'Email me this quote'}</div>
    </div>
  )
}

const Reviews: FC = () => {
  const s = useSteps(6, 1100)
  const reviews = [
    { who: 'Priya S.', text: 'Booked online in a minute and the reminder text was a lifesaver.' },
    { who: 'Marcus T.', text: 'Friendly team, spotless clinic, no waiting around.' },
    { who: 'Aisha K.', text: 'Finally a dentist that answers the phone. Highly recommend.' },
  ]
  const r = reviews[Math.floor(s / 2) % reviews.length]
  return (
    <div className="sp-page">
      <div className="sp-rating">
        <strong>4.9</strong>
        <div><span className="sp-stars">★★★★★</span><small>312 Google reviews</small></div>
      </div>
      <div className="sp-bars">
        {[92, 6, 1, 1, 0].map((w, i) => (
          <div key={i}><small>{5 - i}★</small><span><span style={{ width: `${w}%` }} /></span></div>
        ))}
      </div>
      <div className="sp-review" key={r.who}>
        <span className="sp-stars small">★★★★★</span>
        <p>“{r.text}”</p>
        <small>{r.who} · Google</small>
      </div>
      <div className="sp-ghost-btn">Leave a review</div>
    </div>
  )
}

const Assistant: FC = () => {
  const s = useSteps(6, 950)
  return (
    <div className="sp-page sp-chat">
      <div className="sp-head"><strong>Peak Physio</strong><span className="sp-online">● Online now</span></div>
      <div className="sp-thread">
        {s >= 0 && <div className="sp-bubble me">Are you open on Saturday?</div>}
        {s === 1 && <div className="sp-bubble bot typing"><i /><i /><i /></div>}
        {s >= 2 && <div className="sp-bubble bot">Yes, Saturday 9:00–14:00. Want me to book you in?</div>}
        {s >= 3 && <div className="sp-quick"><span className={s >= 4 ? 'on' : ''}>Book Saturday</span><span>Prices</span></div>}
        {s >= 5 && <div className="sp-bubble bot">Done. Saturday 10:00 with Dr. Lee ✓</div>}
      </div>
      <div className="sp-input">Type a question…</div>
    </div>
  )
}

const PREVIEWS: Record<string, { url: string; C: FC }> = {
  'Booking page': { url: 'riverbenddental.com/book', C: Booking },
  'Fast landing page': { url: 'rapidplumbing.co', C: Landing },
  'Online menu & ordering': { url: 'oliveandember.com/order', C: Menu },
  'Quote calculator': { url: 'cedarbarkhvac.com/quote', C: Quote },
  'Reviews widget': { url: 'riverbenddental.com', C: Reviews },
  'FAQ assistant': { url: 'peakphysio.com', C: Assistant },
}

const SolutionPreview: FC<{ name: string }> = ({ name }) => {
  const p = PREVIEWS[name] ?? PREVIEWS['Booking page']
  return (
    <div className="sp-frame" aria-hidden>
      <div className="sp-bar">
        <span className="sp-dots"><i /><i /><i /></span>
        <span className="sp-url">🔒 {p.url}</span>
        <span className="sp-live">Live</span>
      </div>
      <div className="sp-body" key={name}><p.C /></div>
    </div>
  )
}

export default SolutionPreview
