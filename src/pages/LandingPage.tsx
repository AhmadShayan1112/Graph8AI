import { useState, useEffect, useRef, useCallback, type FC } from 'react'
import { LogoMark } from '../components/Logo'
import SolutionPreview from '../components/SolutionPreview'

interface Props {
  onEnterApp: () => void
}

const TICKER_DATA = [
  { biz: 'Olive & Ember', what: 'opened their ordering page', color: '#22A06B' },
  { biz: 'Cedar Bark HVAC', what: 'audit: no SSL', color: '#DE350B' },
  { biz: 'Mill St. Law', what: 'intake form deployed', color: 'oklch(0.5 0.16 262)' },
  { biz: 'Hawthorne Plumbing', what: 'replied: "Thursday works"', color: '#22A06B' },
  { biz: 'Fernbrook Florist', what: 'shop MVP built in 2m', color: 'oklch(0.5 0.16 262)' },
  { biz: 'Peak Physio', what: 'audit: not on Maps', color: '#B38600' },
  { biz: 'Riverbend Dental', what: 'booking page sent', color: 'oklch(0.5 0.16 262)' },
  { biz: 'Sellwood Bakery', what: 'audit: 7.2s mobile load', color: '#DE350B' },
]

const HOW_STEPS = [
  { n: '01', t: 'Identify', d: 'Define a market by region and industry. Gapwise scores each business on digital maturity and surfaces addressable gaps.' },
  { n: '02', t: 'Assess', d: 'Over 70 checks across performance, search, security, conversion and local presence, each supported by evidence.' },
  { n: '03', t: 'Build', d: 'Select a solution from the library. It adopts the prospect\'s branding and content and deploys to a private, secure URL.' },
  { n: '04', t: 'Engage', d: 'Send one personal email with the live link to the working solution, straight from Gapwise.' },
]

const AUDIT_CATEGORIES = [
  { t: 'Performance', count: 14, items: ['Core Web Vitals', 'Image weight', 'Render-blocking assets', 'Caching', 'Mobile layout shift'] },
  { t: 'SEO', count: 18, items: ['Titles & meta', 'Schema markup', 'Indexability', 'Internal links', 'Local keywords'] },
  { t: 'Security', count: 12, items: ['TLS / SSL', 'Mixed content', 'Security headers', 'Outdated CMS & plugins', 'Exposed admin paths'] },
  { t: 'Conversion', count: 15, items: ['Booking or ordering', 'Forms', 'Clear call to action', 'Click-to-call', 'Trust signals'] },
  { t: 'Local presence', count: 11, items: ['Google Business Profile', 'NAP consistency', 'Reviews', 'Maps listing', 'Hours match'] },
]

const MVP_SOLUTIONS = [
  { t: 'Booking page', d: "Online scheduling configured with the business's services, hours and insurance options, including automated SMS reminders.", fix: 'no booking' },
  { t: 'Fast landing page', d: 'A mobile-first rebuild with structured data, verified reviews and a clear primary conversion path.', fix: 'speed · SEO' },
  { t: 'Online menu & ordering', d: 'Replaces static PDF menus with a responsive menu and online ordering for pickup.', fix: 'PDF-only menu' },
  { t: 'Quote calculator', d: 'Instant, rules-based estimates that capture qualified leads for trade and service businesses.', fix: 'no lead capture' },
  { t: 'Reviews widget', d: 'Displays verified Google reviews on any page and simplifies new review requests.', fix: 'weak trust' },
  { t: 'FAQ assistant', d: 'Responds to common enquiries around the clock and routes qualified visitors to booking.', fix: 'after-hours leads' },
]

const LandingPage: FC<Props> = ({ onEnterApp }) => {
  const [liveCount, setLiveCount] = useState(1284)
  const [url, setUrl] = useState('')
  const [openCat, setOpenCat] = useState(-1)
  const [selectedMvp, setSelectedMvp] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctaCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveCount(c => c + 1 + Math.floor(Math.random() * 3))
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  // Reveal on scroll
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]')
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          ;(e.target as HTMLElement).style.opacity = '1'
          ;(e.target as HTMLElement).style.transform = 'none'
          io.unobserve(e.target)
        }
      }),
      { threshold: 0.12 }
    )
    els.forEach(el => {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight) return
      ;(el as HTMLElement).style.opacity = '0'
      ;(el as HTMLElement).style.transform = 'translateY(24px)'
      ;(el as HTMLElement).style.transition = 'opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1)'
      io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  // Canvas dot field
  useEffect(() => {
    const setupCanvas = (cv: HTMLCanvasElement, dark: boolean) => {
      const ctx = cv.getContext('2d')
      if (!ctx) return () => {}
      let W = 0, H = 0
      let dots: Array<{x: number; y: number; o: number}> = []
      let nodes: Array<{x: number; y: number; vx: number; vy: number; kind: string; lit: number; r: number}> = []
      let pulses: Array<{x: number; y: number; b: number; c: string}> = []
      const mouse = { x: -999, y: -999, tx: -999, ty: -999 }
      const gap = 24
      const C = dark
        ? { dot: '255,255,255', a: 0.06, blue: '120,155,255', teal: '80,200,170', warm: '255,140,110', line: '140,170,255' }
        : { dot: '23,25,30', a: 0.09, blue: '70,105,235', teal: '40,160,140', warm: '225,95,65', line: '70,105,235' }

      const sizeCanvas = () => {
        const r = cv.getBoundingClientRect()
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        W = r.width; H = r.height
        if (!W || !H) return
        cv.width = W * dpr; cv.height = H * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        dots = []
        for (let y = gap / 2; y < H; y += gap) {
          for (let x = gap / 2; x < W; x += gap) {
            dots.push({ x, y, o: Math.random() * 6.283 })
          }
        }
        const n = Math.round(Math.min(26, Math.max(12, W * H / 38000)))
        nodes = Array.from({ length: n }, (_, i) => ({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - .5) * 0.18, vy: (Math.random() - .5) * 0.18,
          kind: i % 5 === 0 ? 'warm' : i % 3 === 0 ? 'teal' : 'blue',
          lit: 0, r: 2 + Math.random() * 1.6,
        }))
      }
      sizeCanvas()
      const ro = new ResizeObserver(sizeCanvas)
      ro.observe(cv)

      const parent = cv.parentElement!
      const onMove = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); mouse.tx = e.clientX - r.left; mouse.ty = e.clientY - r.top }
      const onLeave = () => { mouse.tx = -999; mouse.ty = -999 }
      parent.addEventListener('pointermove', onMove)
      parent.addEventListener('pointerleave', onLeave)

      const orbs = [
        { c: C.blue, fx: .22, fy: .31, px: .72, py: .3, s: .55 },
        { c: C.teal, fx: .17, fy: .23, px: .85, py: .75, s: .42 },
        { c: C.warm, fx: .13, fy: .19, px: .15, py: .85, s: .32 },
      ]

      let raf = 0
      let last = 0
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop)
        if (now - last < 30 || !W) return
        last = now
        const t = now / 1000
        ctx.clearRect(0, 0, W, H)
        mouse.x += (mouse.tx - mouse.x) * 0.12
        mouse.y += (mouse.ty - mouse.y) * 0.12

        for (const o of orbs) {
          const x = W * (o.px + Math.sin(t * o.fx) * .08)
          const y = H * (o.py + Math.cos(t * o.fy) * .1)
          const rad = Math.max(W, H) * o.s
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
          g.addColorStop(0, `rgba(${o.c},${dark ? .16 : .10})`)
          g.addColorStop(1, `rgba(${o.c},0)`)
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
        }

        const sweep = ((t * 0.09) % 1.4) * (W + 300) - 150
        const cx = W * .5, cy = H * .5
        for (const d of dots) {
          const dist = Math.hypot(d.x - cx, d.y - cy)
          const wave = Math.sin(dist * 0.018 - t * 1.4) * 0.5 + 0.5
          const sw = Math.max(0, 1 - Math.abs(d.x - sweep) / 110)
          const md = Math.hypot(d.x - mouse.x, d.y - mouse.y)
          const mm = Math.max(0, 1 - md / 150)
          const lift = Math.max(sw, mm)
          const a = C.a + wave * C.a * 0.8 + lift * 0.45
          ctx.fillStyle = lift > .03 ? `rgba(${C.blue},${a})` : `rgba(${C.dot},${a})`
          const push = mm * 6
          const ang = Math.atan2(d.y - mouse.y, d.x - mouse.x)
          ctx.beginPath()
          ctx.arc(d.x + Math.cos(ang) * push, d.y + Math.sin(ang) * push, 1 + wave * .5 + lift * 1.3, 0, 6.283)
          ctx.fill()
        }

        const sg = ctx.createLinearGradient(sweep - 120, 0, sweep + 20, 0)
        sg.addColorStop(0, `rgba(${C.blue},0)`)
        sg.addColorStop(1, `rgba(${C.blue},${dark ? .10 : .06})`)
        ctx.fillStyle = sg
        ctx.fillRect(sweep - 120, 0, 140, H)
        ctx.fillStyle = `rgba(${C.blue},${dark ? .35 : .22})`
        ctx.fillRect(sweep + 19, 0, 1, H)

        for (const n of nodes) {
          n.x += n.vx; n.y += n.vy
          if (n.x < 0 || n.x > W) n.vx *= -1
          if (n.y < 0 || n.y > H) n.vy *= -1
          if (Math.abs(n.x - sweep) < 4 && n.lit < .2) {
            n.lit = 1
            pulses.push({ x: n.x, y: n.y, b: now, c: (C as any)[n.kind] })
          }
          n.lit *= 0.985
        }
        ctx.lineWidth = 1
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const p = nodes[i], q = nodes[j]
            const d = Math.hypot(p.x - q.x, p.y - q.y)
            if (d > 190) continue
            const k = (1 - d / 190) * (0.10 + Math.max(p.lit, q.lit) * 0.5)
            ctx.strokeStyle = `rgba(${C.line},${k})`
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
          }
        }
        for (const n of nodes) {
          const c = (C as any)[n.kind]
          const glow = n.lit
          if (glow > .05) {
            ctx.fillStyle = `rgba(${c},${glow * .18})`
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 10 * glow, 0, 6.283); ctx.fill()
          }
          ctx.fillStyle = `rgba(${c},${.35 + glow * .6})`
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + glow, 0, 6.283); ctx.fill()
        }
        pulses = pulses.filter(p => now - p.b < 2000)
        for (const p of pulses) {
          const k = (now - p.b) / 2000
          const e = 1 - Math.pow(1 - k, 3)
          ctx.strokeStyle = `rgba(${p.c},${(1 - k) * .6})`
          ctx.lineWidth = 1.4
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + e * 34, 0, 6.283); ctx.stroke()
          ctx.strokeStyle = `rgba(${p.c},${(1 - k) * .3})`
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + e * 20, 0, 6.283); ctx.stroke()
        }
      }
      raf = requestAnimationFrame(loop)
      return () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        parent.removeEventListener('pointermove', onMove)
        parent.removeEventListener('pointerleave', onLeave)
      }
    }

    const cleanups: Array<() => void> = []
    if (canvasRef.current) cleanups.push(setupCanvas(canvasRef.current, false))
    if (ctaCanvasRef.current) cleanups.push(setupCanvas(ctaCanvasRef.current, true))
    return () => cleanups.forEach(fn => fn())
  }, [])

  const handleAudit = (e: React.FormEvent) => {
    e.preventDefault()
    onEnterApp()
  }

  const tickerItems = [...TICKER_DATA, ...TICKER_DATA]

  return (
    <div className="landing">
      {/* ─── Nav ─── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <LogoMark size={28} />
            <div className="landing-brand-name">Gapwise</div>
          </div>
          <div className="landing-links">
            <a href="#how">Platform</a>
            <a href="#audit-section">Website audit</a>
            <a href="#solutions">Solutions</a>
          </div>
          <div className="landing-nav-actions">
            <button className="landing-link-btn" onClick={onEnterApp}>Sign in</button>
            <button className="landing-cta-btn" onClick={onEnterApp}>Request a demo</button>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <div className="landing-hero-wrapper">
        <canvas ref={canvasRef} className="landing-canvas" />
        <div className="landing-hero-gradient" />

        <section className="landing-hero">
          <div className="landing-hero-content">
            <div className="landing-hero-badge lin" style={{ animationDelay: '0s' }}>
              <span className="landing-live-dot" />
              {liveCount.toLocaleString()} business websites audited today
            </div>
            <h1 className="landing-h1 lin" style={{ animationDelay: '.08s' }}>
              Outreach that arrives as a{' '}
              <span className="accent">working solution.</span>
            </h1>
            <p className="landing-hero-sub lin" style={{ animationDelay: '.16s' }}>
              Gapwise identifies businesses with measurable digital gaps, audits their website, search visibility and security posture, and deploys a tailored MVP that resolves their most pressing issue. Every conversation begins with demonstrated value.
            </p>
            <form onSubmit={handleAudit} className="landing-hero-form lin" style={{ animationDelay: '.24s' }}>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="Enter a company website, e.g. riverbenddental.com"
                className="landing-hero-input"
              />
              <button type="submit" className="landing-hero-submit">Generate audit</button>
            </form>
            <div className="landing-hero-checks lin" style={{ animationDelay: '.32s' }}>
              <span>70+ technical checks</span>
              <span>Results in under 60 seconds</span>
              <span>No installation required</span>
            </div>
          </div>
        </section>

        {/* ─── Ticker ─── */}
        <div className="landing-ticker">
          <div className="landing-ticker-track">
            {tickerItems.map((tk, i) => (
              <div key={i} className="landing-ticker-item">
                <span className="landing-ticker-dot" style={{ background: tk.color }} />
                <span className="landing-ticker-biz">{tk.biz}</span>
                <span className="landing-ticker-what">{tk.what}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Comparison Section ─── */}
      <section data-reveal="1" className="landing-section">
        <h2 className="landing-h2">
          Decision-makers disregard outreach that describes a problem. They engage with a solution they can use.
        </h2>
        <div className="landing-comparison">
          <div className="landing-compare-col">
            <div className="landing-compare-label">Conventional outreach</div>
            <p className="landing-compare-text muted">
              "Hello, we reviewed your website and identified several areas for improvement. Would you be available for a 15-minute call this week?"
            </p>
          </div>
          <div className="landing-compare-col">
            <div className="landing-compare-label accent">Outreach with Gapwise</div>
            <p className="landing-compare-text">
              "Dr. Shah, your practice currently accepts appointments by phone only. We have prepared an online booking page using your services and hours, ready for review: <span className="mono accent">riverbend.gapwise.site</span>"
            </p>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how" data-reveal="1" className="landing-how-section">
        <div className="landing-how-inner">
          <div className="landing-how-header">
            <h2 className="landing-h2">A structured path from prospect to proposal</h2>
            <button className="landing-text-link" onClick={onEnterApp}>Explore the platform →</button>
          </div>
          <div className="landing-how-grid">
            {HOW_STEPS.map(h => (
              <div key={h.n} className="landing-how-card">
                <div className="landing-how-num mono accent">{h.n}</div>
                <div className="landing-how-title">{h.t}</div>
                <div className="landing-how-desc">{h.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Audit Categories ─── */}
      <section id="audit-section" data-reveal="1" className="landing-audit-section">
        <div className="landing-audit-grid">
          <div className="landing-audit-text">
            <div className="landing-section-label">Website audit</div>
            <h2 className="landing-h2">Every finding is supported by evidence and quantified business impact.</h2>
            <p className="landing-audit-sub">
              Instead of a lengthy technical report, Gapwise prioritizes issues by commercial impact and identifies the gap that merits a tailored solution.
            </p>
          </div>
          <div className="landing-audit-accordion">
            {AUDIT_CATEGORIES.map((cat, i) => (
              <button
                key={cat.t}
                className="landing-audit-item"
                onClick={() => setOpenCat(openCat === i ? -1 : i)}
              >
                <div className="landing-audit-item-header">
                  <span className="landing-audit-item-left">
                    <span className="landing-audit-num mono">0{i + 1}</span>
                    <span className={`landing-audit-name ${openCat === i || openCat < 0 ? '' : 'dimmed'}`}>{cat.t}</span>
                  </span>
                  <span className="landing-audit-count mono">{cat.count} checks {openCat === i ? '−' : '+'}</span>
                </div>
                {openCat === i && (
                  <div className="landing-audit-detail lin">
                    {cat.items.join(' · ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Solutions (Dark) ─── */}
      <section id="solutions" data-reveal="1" className="landing-solutions-section">
        <div className="landing-solutions-inner">
          <div className="landing-solutions-header">
            <div className="landing-section-label-dark">Solutions</div>
            <h2 className="landing-h2-dark">Tailored solutions for each gap, built from the prospect's own brand and content.</h2>
          </div>
          <div className="landing-solutions-grid">
            <div className="landing-solutions-list">
              {MVP_SOLUTIONS.map((m, i) => (
                <button
                  key={m.t}
                  className="landing-solution-item"
                  onMouseEnter={() => setSelectedMvp(i)}
                  onClick={() => setSelectedMvp(i)}
                >
                  <span className={`landing-solution-name ${selectedMvp === i ? 'active' : ''}`}>{m.t}</span>
                  <span className={`landing-solution-fix mono ${selectedMvp === i ? 'active' : ''}`}>fixes {m.fix}</span>
                </button>
              ))}
            </div>
            <div className="landing-solution-preview">
              <SolutionPreview name={MVP_SOLUTIONS[selectedMvp].t} />
              <p className="landing-solution-desc">{MVP_SOLUTIONS[selectedMvp].d}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA (Dark with Canvas) ─── */}
      <section className="landing-cta-section">
        <canvas ref={ctaCanvasRef} className="landing-canvas" />
        <div className="landing-cta-inner">
          <h2 className="landing-cta-h2">Every prospect has a gap. Lead with the solution.</h2>
          <p className="landing-cta-sub">
            Audit your market, identify the highest-impact opportunity, and deliver a working solution the same day.
          </p>
          <div className="landing-cta-buttons">
            <button className="landing-cta-primary" onClick={onEnterApp}>Request a demo</button>
            <button className="landing-cta-secondary" onClick={onEnterApp}>Explore the platform</button>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landing-footer">
        <span>© 2026 Gapwise</span>
        <div className="landing-footer-links">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Security</a>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
