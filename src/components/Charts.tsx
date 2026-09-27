import { useState, type FC } from 'react'

// Small SVG charts for the dashboard. Palette from the data-viz reference: one hue for a single series,
// an ordered blue ramp for stages, fixed categorical slots for parts of a whole. Every chart shows its
// numbers as text too, and each mark has a hover tooltip.

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const RAMP = ['#86b6ef', '#6da7ec', '#3987e5', '#256abf', '#184f95'] // ordinal: light to dark, all ≥2:1 on white
const INK = { muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', text: '#52514e' }

const niceMax = (v: number) => {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  const n = v / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

// Vertical bars, one series. Tooltip on hover or keyboard focus; the tallest bar is labelled.
export const BarChart: FC<{ data: Array<{ label: string; value: number; title?: string }>; color?: string; unit: string }> = ({ data, color = SERIES[0], unit }) => {
  const [hover, setHover] = useState<number | null>(null)
  const W = 520, H = 200, L = 30, B = 26, T = 18
  const max = niceMax(Math.max(1, ...data.map(d => d.value)))
  const slot = (W - L) / data.length
  const bw = Math.min(40, slot * 0.6)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const top = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0)
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={data.map(d => `${d.title ?? d.label}: ${d.value} ${unit}`).join('; ')}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? INK.axis : INK.grid} strokeWidth={1} />
            <text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10} fill={INK.muted}>{Math.round(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + slot * i + (slot - bw) / 2
          const h = Math.max(0, y(0) - y(d.value))
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} className="chart-hit">
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 && <path d={`M${x},${y(0)} V${y(d.value) + 4} Q${x},${y(d.value)} ${x + 4},${y(d.value)} H${x + bw - 4} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + 4} V${y(0)} Z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={INK.muted}>{d.label}</text>
              {i === top && d.value > 0 && hover === null && <text x={x + bw / 2} y={y(d.value) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK.text}>{d.value}</text>}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{data[hover].value.toLocaleString()}</strong> {unit}<span>{data[hover].title ?? data[hover].label}</span>
        </div>
      )}
    </div>
  )
}

// Donut for a few parts of a whole (keep it to ≤5 slices; fold the rest into "Other"). Legend carries the numbers.
export const Donut: FC<{ slices: Array<{ label: string; value: number; color: string }>; centerLabel: string }> = ({ slices, centerLabel }) => {
  const [hover, setHover] = useState<number | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  const R = 62, r = 40, C = 80
  let angle = -Math.PI / 2
  const arcs = slices.map(s => {
    const a0 = angle
    const sweep = total ? (s.value / total) * Math.PI * 2 : 0
    angle += sweep
    return { ...s, a0, a1: angle, sweep }
  })
  const pt = (rad: number, a: number) => [C + rad * Math.cos(a), C + rad * Math.sin(a)]
  const path = (a0: number, a1: number) => {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4
    const large = a1 - a0 > Math.PI ? 1 : 0
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0)
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`
  }
  const shown = hover !== null ? arcs[hover] : null
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" className="donut-svg" role="img" aria-label={slices.map(s => `${s.label}: ${s.value}`).join('; ')}>
        {total === 0 && <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={INK.grid} strokeWidth={R - r} />}
        {arcs.map((a, i) => a.value > 0 && (
          <path key={a.label} d={path(a.a0, a.a1)} fill={a.color} stroke="#fff" strokeWidth={2}
            opacity={hover === null || hover === i ? 1 : 0.45}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="chart-hit" />
        ))}
        <text x={C} y={C - 2} textAnchor="middle" fontSize={22} fontWeight={700} fill="#17191E">{shown ? shown.value : total}</text>
        <text x={C} y={C + 16} textAnchor="middle" fontSize={10} fill={INK.muted}>{shown ? `${pct(shown.value)}% ${shown.label.toLowerCase()}` : centerLabel}</text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'on' : ''}>
            <i style={{ background: s.color }} />
            <span className="donut-label">{s.label}</span>
            <strong>{s.value.toLocaleString()}</strong>
            <span className="donut-pct">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Horizontal bars, one series, values as text.
export const HBars: FC<{ data: Array<{ label: string; value: number }>; color?: string; onClick?: (i: number) => void }> = ({ data, color = SERIES[0], onClick }) => {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <ul className="hbars">
      {data.map((d, i) => (
        <li key={i}>
          <button className="hbar" onClick={() => onClick?.(i)} disabled={!onClick} title={`${d.label}: ${d.value.toLocaleString()}`}>
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-track"><span style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: color }} /></span>
            <span className="hbar-value">{d.value.toLocaleString()}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// Stages from first to last on an ordered ramp; each shows its count and how many made it from the stage before.
export const Funnel: FC<{ stages: Array<{ stage: string; count: number }> }> = ({ stages }) => {
  const first = Math.max(1, stages[0]?.count ?? 1)
  return (
    <ol className="funnel">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null
        const conv = prev ? Math.round((s.count / prev) * 100) : null
        return (
          <li key={s.stage} title={`${s.stage}: ${s.count.toLocaleString()}`}>
            <span className="funnel-label">{s.stage}</span>
            <span className="funnel-track">
              <span style={{ width: `${Math.max(2, (s.count / first) * 100)}%`, background: RAMP[Math.min(i, RAMP.length - 1)] }} />
            </span>
            <span className="funnel-value"><strong>{s.count.toLocaleString()}</strong>{conv !== null && <em>{conv}%</em>}</span>
          </li>
        )
      })}
    </ol>
  )
}
