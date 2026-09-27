import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import type { AuthInfo } from './auth.js'
import { lookupCompany } from './graph8.js'
import { askGeminiWithSearch, extractJson } from './gemini.js'

// Gap analysis of one lead: Graph8's record of the business plus Gemini researching it on the web.
// Produces real gaps with evidence, the solutions the business is likely looking for, and a prospect profile.
export const OFFERS = ['booking-page', 'contact-form', 'mobile-landing', 'speed-landing'] as const
type Offer = (typeof OFFERS)[number]
type Level = 'high' | 'medium' | 'low'

export interface GapResult {
  summary: string
  onlinePresence: { website: string; websiteStatus: string; googleBusiness: string; reviews: string; social: string }
  gaps: Array<{ title: string; severity: Level; evidence: string; impact: string }>
  needs: Array<{ solution: string; why: string; priority: Level }>
  prospect: {
    fitScore: number
    recommendedOffer: Offer
    offerReason: string
    pitch: string
    talkingPoints: string[]
    emailSubject: string
    emailOpening: string
    bestChannel: string
    decisionMaker: string
  }
}

interface GapDoc {
  _id: ObjectId
  campaignId: ObjectId
  leadId: string
  leadName: string
  username: string
  result: GapResult
  sources: Array<{ title: string; url: string }>
  queries: string[]
  usedGraph8: boolean
  createdAt: Date
}

let indexReady = false
async function gapAnalyses() {
  const col = (await getDb()).collection<GapDoc>('gap_analyses')
  if (!indexReady) {
    await col.createIndex({ campaignId: 1, leadId: 1 }, { unique: true })
    indexReady = true
  }
  return col
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const level = (v: unknown): Level => (v === 'high' || v === 'low' ? v : 'medium')
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : [])

// Never trust the model's shape: keep only known fields, clamp lengths, fall back to safe defaults.
function normalize(raw: any): GapResult {
  const p = raw?.prospect ?? {}
  const offer = OFFERS.includes(p.recommendedOffer) ? p.recommendedOffer as Offer : 'booking-page'
  const o = raw?.onlinePresence ?? {}
  return {
    summary: str(raw?.summary, 900),
    onlinePresence: {
      website: str(o.website, 200),
      websiteStatus: str(o.websiteStatus, 300),
      googleBusiness: str(o.googleBusiness, 300),
      reviews: str(o.reviews, 300),
      social: str(o.social, 300),
    },
    gaps: list(raw?.gaps, 8)
      .map((g: any) => ({ title: str(g?.title, 120), severity: level(g?.severity), evidence: str(g?.evidence, 400), impact: str(g?.impact, 300) }))
      .filter(g => g.title),
    needs: list(raw?.needs, 6)
      .map((n: any) => ({ solution: str(n?.solution, 120), why: str(n?.why, 400), priority: level(n?.priority) }))
      .filter(n => n.solution),
    prospect: {
      fitScore: Math.max(0, Math.min(100, Math.round(Number(p.fitScore) || 0))),
      recommendedOffer: offer,
      offerReason: str(p.offerReason, 400),
      pitch: str(p.pitch, 600),
      talkingPoints: list(p.talkingPoints, 6).map(t => str(t, 240)).filter(Boolean),
      emailSubject: str(p.emailSubject, 140),
      emailOpening: str(p.emailOpening, 900),
      bestChannel: str(p.bestChannel, 120),
      decisionMaker: str(p.decisionMaker, 200),
    },
  }
}

function buildPrompt(lead: Record<string, any>, company: Record<string, any> | null) {
  const facts = {
    name: lead.name,
    industry: lead.type,
    location: lead.city,
    website: lead.site || 'none on record',
    contact: lead.contact && lead.contact !== 'Owner' ? `${lead.contact} (${lead.role})` : undefined,
    phone: company?.phone || lead.enrichment?.company?.phone || undefined,
    address: company?.address || lead.enrichment?.company?.address || undefined,
    description: company?.description || lead.enrichment?.company?.description || undefined,
    employees: company?.employees || lead.enrichment?.company?.employees || undefined,
    revenue: company?.revenue || lead.enrichment?.company?.revenue || undefined,
    linkedin: company?.linkedin || undefined,
    facebook: company?.facebook || undefined,
  }
  return `You are a sales researcher for an agency that builds websites, online booking pages, lead-capture forms and fast mobile landing pages for local businesses.

Research this business on the web now. Use Google Search: look for its website (if any), Google Business Profile / Maps listing, reviews, social pages and directory listings. Base every claim on what you actually find; if you cannot find something, say so rather than guessing.

Business record from our lead database (Graph8):
${JSON.stringify(facts, null, 2)}

Work out:
1. Its real digital gaps: missing or broken website, no online booking/ordering, no contact form, slow or not mobile-friendly site, missing Google Business Profile, few or poor reviews, outdated info, no social presence, and so on. Give concrete evidence for each.
2. What solutions this business is most likely looking for right now, and why (from reviews, their industry, competitors, what customers ask for).
3. A prospect profile for our outreach.

Reply with ONLY a JSON object, no prose before or after, in exactly this shape:
{
  "summary": "2-3 sentences on who they are and their online situation",
  "onlinePresence": {
    "website": "the URL you found, or 'none found'",
    "websiteStatus": "what the site is like (or why there is none)",
    "googleBusiness": "listing found? rating and review count if visible",
    "reviews": "what customers praise or complain about, especially anything about booking, contact, hours or the website",
    "social": "which social profiles exist and how active"
  },
  "gaps": [{ "title": "short gap name", "severity": "high|medium|low", "evidence": "what you found", "impact": "what it costs the business" }],
  "needs": [{ "solution": "what they need", "why": "reason, tied to evidence", "priority": "high|medium|low" }],
  "prospect": {
    "fitScore": 0-100 (how likely they are to buy one of our offers),
    "recommendedOffer": one of "booking-page" | "contact-form" | "mobile-landing" | "speed-landing",
    "offerReason": "why this offer first",
    "pitch": "one or two sentences we can say to them",
    "talkingPoints": ["3-5 specific points drawn from the evidence"],
    "emailSubject": "a specific, non-spammy subject line",
    "emailOpening": "the first 2-3 sentences of a personal cold email that references something real about them",
    "bestChannel": "email, phone, WhatsApp, Instagram DM... and why",
    "decisionMaker": "who to address (name/title if found, else the likely role)"
  }
}
Return 2-6 gaps and 1-4 needs, most important first.`
}

// The stages a run goes through, reported as each one starts so the page can show real progress.
export type GapStage = 'graph8' | 'research' | 'saving'

export async function runGapAnalysis(
  auth: AuthInfo,
  campaignId: ObjectId,
  lead: Record<string, any>,
  onStage: (stage: GapStage) => void = () => {},
) {
  // Graph8's fuller company record, when this person may use Graph8 and the lead has a domain.
  let company: Record<string, any> | null = null
  if (auth.permissions.graph8 && lead.site) {
    onStage('graph8')
    const found = await lookupCompany(lead.site).catch(() => null)
    const c = found?.found ? found.data ?? {} : null
    if (c) {
      company = {
        phone: c.phone || '',
        address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
        description: c.description || '',
        employees: c.employee_count || '',
        revenue: c.revenue || '',
        linkedin: c.linkedin_url || '',
        facebook: c.facebook_url || '',
      }
    }
  }

  onStage('research')
  const answer = await askGeminiWithSearch(buildPrompt(lead, company))
  onStage('saving')
  const result = normalize(extractJson(answer.text))
  const doc: Omit<GapDoc, '_id'> = {
    campaignId,
    leadId: String(lead.id),
    leadName: String(lead.name ?? ''),
    username: auth.username,
    result,
    sources: answer.sources,
    queries: answer.queries,
    usedGraph8: !!company,
    createdAt: new Date(),
  }
  await (await gapAnalyses()).updateOne(
    { campaignId, leadId: doc.leadId },
    { $set: doc },
    { upsert: true },
  )
  return toPublic(doc)
}

const toPublic = (d: Omit<GapDoc, '_id'>) => ({
  leadId: d.leadId,
  leadName: d.leadName,
  username: d.username,
  result: d.result,
  sources: d.sources,
  queries: d.queries,
  usedGraph8: d.usedGraph8,
  createdAt: d.createdAt,
})

// Everything saved for a campaign, keyed by lead.
export async function listGapAnalyses(campaignId: ObjectId) {
  const docs = await (await gapAnalyses()).find({ campaignId }).sort({ createdAt: -1 }).limit(1000).toArray()
  return docs.map(toPublic)
}

export async function deleteGapAnalysesFor(campaignIds: ObjectId[]) {
  if (campaignIds.length) await (await gapAnalyses()).deleteMany({ campaignId: { $in: campaignIds } })
}
