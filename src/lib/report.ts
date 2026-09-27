import type { Lead } from '../types/lead'
import type { GapAnalysis } from './api'

// Lead reports as PDF: a print-ready A4 page opened in its own tab, where the browser's print dialog offers
// "Save as PDF". No PDF library needed, text stays selectable, and it works the same on phones and desktops.

export interface ReportFinding { title: string; cat: string; detail?: string; impact?: string }

const OFFER_LABEL: Record<string, string> = {
  'booking-page': 'Online booking page',
  'contact-form': 'Lead capture form',
  'mobile-landing': 'Mobile-first landing page',
  'speed-landing': 'Fast landing page',
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : '#')

const LOGO = `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2C5DBD"/><path d="M18.07 8.79A7.5 7.5 0 1 0 23.46 15.22M23.4 16H16.4" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="19.95" y="9.35" width="3.9" height="3.9" rx="1" fill="#A8C5F9"/></svg>`

function ring(score: number, color: string) {
  const c = 2 * Math.PI * 34
  return `<svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
    <circle cx="42" cy="42" r="34" fill="none" stroke="#ECECE8" stroke-width="8"/>
    <circle cx="42" cy="42" r="34" fill="none" stroke="${esc(color)}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(score / 100) * c} ${c}" transform="rotate(-90 42 42)"/>
    <text x="42" y="48" text-anchor="middle" font-size="22" font-weight="700" fill="#17191E">${Math.round(score)}</text>
  </svg>`
}

const scoreColor = (n: number) => (n >= 70 ? '#22A06B' : n >= 40 ? '#B38600' : '#DE350B')

function rows(pairs: Array<[string, string | undefined | null]>) {
  const kept = pairs.filter(([, v]) => v)
  if (!kept.length) return ''
  return `<dl class="kv">${kept.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
}

export function buildLeadReport(lead: Lead, findings: ReportFinding[], gap?: GapAnalysis | null) {
  const a = lead.analysis
  const e = lead.enrichment
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const r = gap?.result
  const p = r?.prospect

  const byCat = new Map<string, ReportFinding[]>()
  for (const f of findings) byCat.set(f.cat, [...(byCat.get(f.cat) ?? []), f])

  const sections: string[] = []

  if (a) {
    sections.push(`
      <section class="summary avoid">
        <div class="summary-score">${ring(a.score, a.color || scoreColor(a.score))}<span>Digital health</span></div>
        <div class="summary-text">
          <h2>${esc(a.biggestGap.title)}</h2>
          <p>${esc(a.biggestGap.description)}</p>
          <p class="rec"><strong>Recommendation:</strong> ${esc(a.biggestGap.recommendation)}</p>
          <p class="muted">Estimated opportunity: <strong>${esc(a.estimatedValue)}</strong>${a.gaps.length ? ` · Top gaps: ${a.gaps.slice(0, 4).map(esc).join(', ')}` : ''}</p>
        </div>
      </section>`)

    sections.push(`
      <section class="avoid">
        <h3>Scores by category</h3>
        <table class="scores">
          ${a.categories.map(c => `<tr>
            <td class="cat">${esc(c.label)}</td>
            <td class="bar"><span style="width:${Math.max(2, c.score)}%;background:${esc(c.color || scoreColor(c.score))}"></span></td>
            <td class="num">${c.score}/100</td>
            <td class="num muted">${c.issues} issue${c.issues === 1 ? '' : 's'}</td>
          </tr>`).join('')}
        </table>
      </section>`)
  }

  if (findings.length) {
    sections.push(`
      <section>
        <h3>Findings</h3>
        ${[...byCat].map(([cat, list]) => `
          <div class="group avoid">
            <h4>${esc(cat)}</h4>
            ${list.map(f => `<div class="finding">
              <div class="finding-title">${esc(f.title)}</div>
              ${f.detail ? `<div>${esc(f.detail)}</div>` : ''}
              ${f.impact ? `<div class="muted">Impact: ${esc(f.impact)}</div>` : ''}
            </div>`).join('')}
          </div>`).join('')}
      </section>`)
  }

  if (r && p) {
    sections.push(`
      <section class="avoid page-break">
        <h3>Gap analysis</h3>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
        <div class="prospect avoid">
          <div class="fit" style="border-color:${scoreColor(p.fitScore)}"><strong>${p.fitScore}</strong><span>fit</span></div>
          <div>
            <div class="offer">${esc(OFFER_LABEL[p.recommendedOffer] ?? p.recommendedOffer)}</div>
            ${p.offerReason ? `<div class="muted">${esc(p.offerReason)}</div>` : ''}
            ${p.pitch ? `<blockquote>${esc(p.pitch)}</blockquote>` : ''}
          </div>
        </div>
        ${p.talkingPoints.length ? `<h4>Talking points</h4><ul>${p.talkingPoints.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${rows([['Talk to', p.decisionMaker], ['Best channel', p.bestChannel]])}
        ${p.emailSubject || p.emailOpening ? `<div class="email avoid"><div class="muted">Email opener</div><strong>${esc(p.emailSubject)}</strong><p>${esc(p.emailOpening)}</p></div>` : ''}
      </section>`)

    if (r.gaps.length) {
      sections.push(`
        <section>
          <h3>Gaps found</h3>
          ${r.gaps.map(g => `<div class="finding avoid sev-${esc(g.severity)}">
            <div class="finding-title">${esc(g.title)} <span class="sev">${esc(g.severity)}</span></div>
            ${g.evidence ? `<div><strong>Evidence:</strong> ${esc(g.evidence)}</div>` : ''}
            ${g.impact ? `<div class="muted"><strong>Impact:</strong> ${esc(g.impact)}</div>` : ''}
          </div>`).join('')}
        </section>`)
    }
    if (r.needs.length) {
      sections.push(`
        <section class="avoid">
          <h3>What they are looking for</h3>
          <ul>${r.needs.map(n => `<li><strong>${esc(n.solution)}</strong> (${esc(n.priority)} priority) — ${esc(n.why)}</li>`).join('')}</ul>
        </section>`)
    }
    const op = r.onlinePresence
    const presence = rows([['Website', [op.website, op.websiteStatus].filter(Boolean).join(' — ')], ['Google listing', op.googleBusiness], ['Reviews', op.reviews], ['Social', op.social]])
    if (presence) sections.push(`<section class="avoid"><h3>Online presence</h3>${presence}</section>`)
    const sources = (gap?.sources ?? []).filter(s => !/vertexaisearch\.cloud\.google\.com/.test(s.url))
    if (sources.length) {
      sections.push(`<section class="avoid"><h3>Sources</h3><ol class="sources">${sources.map(s =>
        `<li>${esc(s.title || s.url)}<br><a href="${safeUrl(s.url)}">${esc(s.url)}</a></li>`).join('')}</ol></section>`)
    }
  }

  const company = rows([
    ['Industry', e?.company?.industry || lead.type],
    ['Address', e?.company?.address || lead.city],
    ['Website', lead.site || 'None'],
    ['Phone', e?.company?.phone],
    ['Employees', e?.company?.employees],
    ['Revenue', e?.company?.revenue],
    ['LinkedIn', e?.company?.linkedin],
  ])
  const person = rows([
    ['Decision maker', e?.person?.name || (lead.contact !== 'Owner' ? lead.contact : '')],
    ['Title', e?.person?.title || lead.role],
    ['Email', e?.email.address ? `${e.email.address} (verified)` : e?.email.bestGuess ? `${e.email.bestGuess} (unverified)` : ''],
    ['Phone', e?.person?.phone],
    ['LinkedIn', e?.person?.linkedin || lead.contactLinkedin],
  ])
  sections.push(`
    <section class="avoid">
      <h3>Company and contact</h3>
      <div class="two">${company}${person}</div>
      ${e?.company?.description ? `<p class="muted">${esc(e.company.description)}</p>` : ''}
    </section>`)

  const title = `Gapwise report - ${lead.name} - ${date}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #17191E; background: #F4F4F1; }
  .page { max-width: 820px; margin: 0 auto; padding: 28px 32px 40px; background: #fff; }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px;
    max-width: 820px; margin: 0 auto; padding: 10px 16px; background: #17191E; color: #fff; font-size: 13px; }
  .toolbar button { font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; background: #2C5DBD; color: #fff; }
  .toolbar .ghost { background: transparent; color: #ccc; }
  header.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #17191E; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
  .doc { text-align: right; font-size: 12px; color: #5E636E; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 14px 0 2px; }
  .meta { color: #5E636E; margin-bottom: 18px; }
  h2 { font-size: 17px; margin: 0 0 4px; }
  h3 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E4E4E0; }
  h4 { font-size: 13px; margin: 12px 0 4px; color: #3C4049; }
  p { margin: 6px 0; }
  .muted { color: #5E636E; }
  .summary { display: flex; gap: 18px; align-items: center; padding: 16px; border: 1px solid #E4E4E0; border-radius: 10px; background: #FAFAF8; }
  .summary-score { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; color: #5E636E; flex: none; }
  .rec { background: #EEF2FC; border-radius: 6px; padding: 6px 10px; }
  table.scores { width: 100%; border-collapse: collapse; }
  table.scores td { padding: 6px 4px; border-bottom: 1px solid #F0F0EC; }
  td.cat { width: 26%; font-weight: 600; }
  td.bar span { display: block; height: 8px; border-radius: 4px; }
  td.num { width: 11%; text-align: right; white-space: nowrap; }
  .finding { padding: 7px 0 7px 10px; border-left: 3px solid #D6D6D1; margin: 6px 0; }
  .finding.sev-high { border-left-color: #DE350B; } .finding.sev-medium { border-left-color: #B38600; }
  .finding-title { font-weight: 600; }
  .sev { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #5E636E; border: 1px solid #D6D6D1; border-radius: 99px; padding: 0 6px; margin-left: 6px; }
  .prospect { display: flex; gap: 14px; align-items: flex-start; padding: 12px; background: #F5F7FE; border-radius: 10px; margin: 8px 0; }
  .fit { flex: none; width: 58px; height: 58px; border-radius: 50%; border: 4px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
  .fit strong { font-size: 19px; } .fit span { font-size: 9px; text-transform: uppercase; color: #5E636E; }
  .offer { font-weight: 700; font-size: 15px; }
  blockquote { margin: 8px 0 0; padding: 6px 12px; border-left: 3px solid #2C5DBD; background: #fff; }
  .email { border: 1px solid #E4E4E0; border-radius: 8px; padding: 10px 12px; margin-top: 10px; white-space: pre-wrap; }
  ul, ol { margin: 6px 0; padding-left: 20px; } li { margin: 3px 0; }
  .sources { font-size: 11.5px; word-break: break-all; } .sources a { color: #2C5DBD; }
  dl.kv { margin: 0; display: grid; gap: 4px; }
  dl.kv div { display: grid; grid-template-columns: 120px 1fr; gap: 8px; }
  dt { color: #5E636E; } dd { margin: 0; word-break: break-word; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #E4E4E0; font-size: 11px; color: #8A8E97; display: flex; justify-content: space-between; }
  .avoid { break-inside: avoid; page-break-inside: avoid; }
  @media (max-width: 640px) { .page { padding: 18px 16px 28px; } .two { grid-template-columns: 1fr; } .summary { flex-direction: column; align-items: flex-start; } dl.kv div { grid-template-columns: 100px 1fr; } }
  @media print {
    body { background: #fff; } .toolbar { display: none; } .page { max-width: none; padding: 0; }
    .page-break { break-before: page; page-break-before: always; }
    a { color: #17191E; text-decoration: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
<div class="toolbar"><span>Use <strong>Save as PDF</strong> in the print dialog.</span>
  <span><button class="ghost" onclick="window.close()">Close</button> <button onclick="window.print()">Save as PDF</button></span></div>
<div class="page">
  <header class="top">
    <div class="brand">${LOGO} Gapwise</div>
    <div class="doc">${r ? 'Audit and gap analysis' : 'Website and growth audit'}<br>${esc(date)}</div>
  </header>
  <h1>${esc(lead.name)}</h1>
  <div class="meta">${[lead.type, lead.city, lead.site].filter(Boolean).map(esc).join(' · ')}</div>
  ${sections.join('\n')}
  <footer><span>Prepared with Gapwise</span><span>${esc(date)}</span></footer>
</div>
</body></html>`
}

// Opens the report in a new tab and starts the print dialog. The tab must be opened straight from the click
// (before any await), or popup blockers stop it; `html` can be filled in afterwards.
export function openReportWindow() {
  const w = window.open('', '_blank')
  if (w) {
    w.document.write('<!doctype html><title>Preparing report…</title><p style="font:15px sans-serif;padding:24px">Preparing the report…</p>')
    w.document.close()
  }
  return w
}

export function showReport(w: Window | null, html: string) {
  if (w && !w.closed) {
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { try { w.print() } catch { /* the Save as PDF button is still there */ } }, 400)
    return
  }
  // Popups blocked: print from a hidden frame in this page instead.
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print() } finally { setTimeout(() => frame.remove(), 60_000) }
  }
  document.body.appendChild(frame)
}
