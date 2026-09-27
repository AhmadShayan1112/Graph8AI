import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { Finding, Severity } from './security.js'

// The security report sent to a lead: a cover with the overall score and summary, then one section per product
// with its checks and findings (what we saw, why it matters, how to fix it). Built with the PDF standard fonts,
// so no font files are needed.

interface ReportProduct {
  name: string
  url: string
  kind: string
  score: number | null
  summary: string
  positives: string[]
  findings: Finding[]
  checks: Array<{ label: string; ok: boolean }>
}

export interface ReportInput {
  leadName: string
  preparedBy: string
  createdAt: Date
  score: number
  summary: { headline: string; summary: string; topRisks: string[]; nextSteps: string[] }
  products: ReportProduct[]
  failed: Array<{ name: string; url: string; error: string }>
}

const A4 = { w: 595.28, h: 841.89 }
const M = 50
const INK = rgb(0.11, 0.13, 0.17)
const MUTED = rgb(0.4, 0.43, 0.49)
const LINE = rgb(0.87, 0.89, 0.92)
const BRAND = rgb(0.16, 0.33, 0.85)
const SEV: Record<Severity, RGB> = {
  critical: rgb(0.72, 0.11, 0.11), high: rgb(0.87, 0.32, 0.1), medium: rgb(0.8, 0.55, 0.0), low: rgb(0.2, 0.45, 0.8), info: rgb(0.45, 0.48, 0.53),
}
const scoreColor = (s: number) => (s >= 80 ? rgb(0.13, 0.63, 0.42) : s >= 60 ? rgb(0.7, 0.53, 0) : s >= 40 ? rgb(0.9, 0.41, 0.06) : rgb(0.87, 0.21, 0.04))

// The standard fonts only cover Windows-1252; anything else is swapped for a close ASCII character.
function clean(s: string) {
  return String(s ?? '')
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[•·]/g, '-')
    .replace(/ /g, ' ').replace(/[\t\r]/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '')
}

class Writer {
  doc: PDFDocument
  page!: PDFPage
  y = 0
  constructor(doc: PDFDocument, public font: PDFFont, public bold: PDFFont, private footer: string) {
    this.doc = doc
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h])
    this.y = A4.h - M
    const n = this.doc.getPageCount()
    this.page.drawText(clean(this.footer), { x: M, y: 28, size: 8, font: this.font, color: MUTED })
    this.page.drawText(`Page ${n}`, { x: A4.w - M - 30, y: 28, size: 8, font: this.font, color: MUTED })
  }

  ensure(space: number) {
    if (this.y - space < 60) this.newPage()
  }

  wrap(text: string, size: number, font: PDFFont, width: number) {
    const lines: string[] = []
    for (const para of clean(text).split('\n')) {
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(test, size) <= width) { line = test; continue }
        if (line) lines.push(line)
        // A single word longer than the line (e.g. a long address) is broken by characters.
        let w = word
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--
          lines.push(w.slice(0, i))
          w = w.slice(i)
        }
        line = w
      }
      lines.push(line)
    }
    return lines
  }

  text(text: string, o: { size?: number; font?: PDFFont; color?: RGB; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10
    const font = o.font ?? this.font
    const x = o.x ?? M
    const lineH = size * 1.4
    for (const line of this.wrap(text, size, font, o.width ?? A4.w - x - M)) {
      this.ensure(lineH)
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK })
      this.y -= lineH
    }
    this.y -= o.gap ?? 4
  }

  rule() {
    this.ensure(12)
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4.w - M, y: this.y }, thickness: 0.7, color: LINE })
    this.y -= 12
  }

  pill(label: string, color: RGB, x: number, y: number) {
    const size = 7.5
    const w = this.bold.widthOfTextAtSize(label, size) + 10
    this.page.drawRectangle({ x, y: y - 3, width: w, height: 13, color })
    this.page.drawText(label, { x: x + 5, y: y + 0.5, size, font: this.bold, color: rgb(1, 1, 1) })
    return w
  }

  scoreBadge(score: number, x: number, y: number, r = 34) {
    this.page.drawCircle({ x, y, size: r, color: scoreColor(score) })
    const s = String(score)
    const size = r * 0.8
    this.page.drawText(s, { x: x - this.bold.widthOfTextAtSize(s, size) / 2, y: y - size * 0.35, size, font: this.bold, color: rgb(1, 1, 1) })
    this.page.drawText('/100', { x: x - this.font.widthOfTextAtSize('/100', 8) / 2, y: y - r * 0.62, size: 8, font: this.font, color: rgb(1, 1, 1) })
  }
}

export async function buildSecurityPdf(r: ReportInput) {
  const doc = await PDFDocument.create()
  doc.setTitle(clean(`Website security review - ${r.leadName}`))
  doc.setAuthor(clean(r.preparedBy))
  doc.setCreationDate(r.createdAt)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const date = r.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const w = new Writer(doc, font, bold, `Security review for ${r.leadName} - ${date} - Confidential`)

  // ── Cover and summary ──
  w.newPage()
  w.page.drawRectangle({ x: 0, y: A4.h - 150, width: A4.w, height: 150, color: rgb(0.07, 0.09, 0.15) })
  w.page.drawText('WEBSITE SECURITY REVIEW', { x: M, y: A4.h - 60, size: 10, font: bold, color: rgb(0.6, 0.7, 1) })
  const titleLines = w.wrap(r.leadName, 24, bold, A4.w - 2 * M - 100)
  titleLines.slice(0, 2).forEach((l, i) => w.page.drawText(l, { x: M, y: A4.h - 92 - i * 28, size: 24, font: bold, color: rgb(1, 1, 1) }))
  w.page.drawText(clean(`${date}  -  prepared by ${r.preparedBy}`), { x: M, y: A4.h - 135, size: 9, font, color: rgb(0.75, 0.78, 0.85) })
  w.scoreBadge(r.score, A4.w - M - 36, A4.h - 80)
  w.y = A4.h - 180

  w.text(r.summary.headline, { size: 16, font: bold, gap: 6 })
  w.text(r.summary.summary, { size: 10.5, gap: 12 })

  const all = r.products.flatMap(p => p.findings)
  const counts = (['critical', 'high', 'medium', 'low'] as Severity[]).map(s => ({ s, n: all.filter(f => f.severity === s).length }))
  w.ensure(40)
  let x = M
  for (const c of counts) {
    w.page.drawRectangle({ x, y: w.y - 34, width: 118, height: 34, borderColor: LINE, borderWidth: 0.8 })
    w.page.drawText(String(c.n), { x: x + 10, y: w.y - 25, size: 16, font: bold, color: SEV[c.s] })
    w.page.drawText(c.s[0].toUpperCase() + c.s.slice(1), { x: x + 36, y: w.y - 21, size: 9, font, color: MUTED })
    x += 124
  }
  w.y -= 50

  if (r.summary.topRisks.length) {
    w.text('Most important risks', { size: 12, font: bold, gap: 4 })
    r.summary.topRisks.forEach((t, i) => w.text(`${i + 1}.  ${t}`, { x: M + 6, gap: 2 }))
    w.y -= 8
  }
  if (r.summary.nextSteps.length) {
    w.text('Recommended next steps', { size: 12, font: bold, gap: 4 })
    r.summary.nextSteps.forEach(t => w.text(`-  ${t}`, { x: M + 6, gap: 2 }))
    w.y -= 8
  }

  w.text('Products reviewed', { size: 12, font: bold, gap: 4 })
  for (const p of r.products) {
    w.ensure(18)
    w.page.drawText(clean(p.name).slice(0, 60), { x: M + 6, y: w.y - 10, size: 10, font: bold, color: INK })
    w.page.drawText(clean(p.url).slice(0, 70), { x: M + 200, y: w.y - 10, size: 9, font, color: MUTED })
    if (p.score !== null) w.page.drawText(`${p.score}/100`, { x: A4.w - M - 40, y: w.y - 10, size: 10, font: bold, color: scoreColor(p.score) })
    w.y -= 16
  }
  for (const p of r.failed) w.text(`${p.name} (${p.url}): not reviewed - ${p.error}`, { x: M + 6, size: 9, color: MUTED, gap: 2 })
  w.y -= 10
  w.text('How this review was done', { size: 10, font: bold, gap: 2 })
  w.text('This is a passive, non-intrusive review. We looked only at what any visitor\'s browser receives: the encryption certificate, '
    + 'response headers, cookies, the public page code and public DNS records. Nothing was attacked, guessed or submitted, and no '
    + 'login was attempted. A passive review cannot see problems behind a login or on the server itself, so passing these checks '
    + 'does not prove a site is secure. The score starts at 100 and drops for each issue by its severity.', { size: 8.5, color: MUTED })

  // ── One section per product ──
  for (const p of r.products) {
    w.newPage()
    w.text(p.kind.toUpperCase(), { size: 8.5, font: bold, color: BRAND, gap: 2 })
    w.text(p.name, { size: 18, font: bold, width: A4.w - 2 * M - 90, gap: 2 })
    w.text(p.url, { size: 9, color: MUTED, width: A4.w - 2 * M - 90, gap: 10 })
    if (p.score !== null) w.scoreBadge(p.score, A4.w - M - 30, A4.h - M - 30, 28)
    if (p.summary) w.text(p.summary, { size: 10, gap: 10 })

    // Checks as a two-column grid of passes and fails.
    const colW = (A4.w - 2 * M) / 2
    for (let i = 0; i < p.checks.length; i += 2) {
      w.ensure(16)
      for (const [j, c] of p.checks.slice(i, i + 2).entries()) {
        const cx = M + j * colW
        w.page.drawCircle({ x: cx + 5, y: w.y - 6, size: 4, color: c.ok ? rgb(0.13, 0.63, 0.42) : rgb(0.87, 0.21, 0.04) })
        w.page.drawText(clean(`${c.label}: ${c.ok ? 'pass' : 'missing'}`), { x: cx + 14, y: w.y - 9, size: 9, font, color: INK })
      }
      w.y -= 15
    }
    w.y -= 6
    if (p.positives.length) w.text(`Already good: ${p.positives.join('; ')}.`, { size: 9, color: MUTED, gap: 10 })
    w.rule()

    const shown = p.findings.filter(f => f.severity !== 'info')
    const notes = p.findings.filter(f => f.severity === 'info')
    if (!shown.length) w.text('No issues found in the external checks.', { size: 10, gap: 8 })
    shown.forEach((f, i) => {
      w.ensure(70)
      const pw = w.pill(f.severity.toUpperCase(), SEV[f.severity], M, w.y - 10)
      w.page.drawText(clean(f.category), { x: M + pw + 8, y: w.y - 9.5, size: 8.5, font, color: MUTED })
      w.y -= 18
      w.text(`${i + 1}. ${f.title}`, { size: 11.5, font: bold, gap: 3 })
      w.text(`What we saw: ${f.evidence}`, { size: 9, color: MUTED, gap: 3 })
      w.text(`Why it matters: ${f.risk}`, { size: 9.5, gap: 3 })
      w.text(`How to fix it: ${f.fix}`, { size: 9.5, gap: 10 })
    })
    if (notes.length) {
      w.text('Good practice (optional)', { size: 10, font: bold, gap: 3 })
      notes.forEach(f => w.text(`-  ${f.title}: ${f.fix}`, { size: 9, color: MUTED, gap: 2 }))
    }
  }

  return Buffer.from(await doc.save())
}
