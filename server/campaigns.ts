import { ObjectId, type AnyBulkWriteOperation } from 'mongodb'
import { getDb } from './db.js'
import type { AuthInfo } from './auth.js'
import { campaignStats, deleteSearchesInCampaign, ownerOf, scope } from './history.js'
import { deleteGapAnalysesFor } from './gapAnalysis.js'

// A campaign groups the searches someone runs for one goal and keeps every lead they turned up.
// Users see their own campaigns; the admin sees everyone's.
type Location = { value: string; field?: 'city' | 'country' | 'state' }
export interface CampaignTarget { industries: string[]; locations: Location[] }

interface CampaignDoc {
  _id: ObjectId
  ownerId: string
  username: string
  name: string
  description: string
  target: CampaignTarget
  // Set on campaigns created automatically for a search made outside any campaign: the normalised target,
  // so the same search again lands in the same campaign.
  autoKey?: string
  createdAt: Date
  updatedAt: Date
}

interface CampaignLeadDoc {
  _id: ObjectId
  campaignId: ObjectId
  leadId: string
  lead: { id: string; [k: string]: unknown }
  searchId: string | null
  addedAt: Date
  updatedAt: Date
}

const MAX_CAMPAIGNS_PER_OWNER = 100
const MAX_LEADS_PER_CAMPAIGN = 1000

let indexReady = false
async function collections() {
  const db = await getDb()
  const campaigns = db.collection<CampaignDoc>('campaigns')
  const leads = db.collection<CampaignLeadDoc>('campaign_leads')
  if (!indexReady) {
    await campaigns.createIndex({ ownerId: 1, updatedAt: -1 })
    await campaigns.createIndex({ ownerId: 1, autoKey: 1 })
    await leads.createIndex({ campaignId: 1, leadId: 1 }, { unique: true })
    indexReady = true
  }
  return { campaigns, leads }
}

const cleanStrings = (v: unknown, max = 20) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 80)).slice(0, max)

export function parseCampaignInput(body: any) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 500) : ''
  const locations = (Array.isArray(body?.target?.locations) ? body.target.locations : [])
    .filter((l: any) => typeof l?.value === 'string' && l.value.trim())
    .slice(0, 20)
    .map((l: any): Location => ({
      value: l.value.trim().slice(0, 80),
      ...(['city', 'country', 'state'].includes(l.field) ? { field: l.field } : {}),
    }))
  return { name, description, target: { industries: cleanStrings(body?.target?.industries), locations } }
}

const toPublic = (c: CampaignDoc, auth: AuthInfo) => ({
  id: String(c._id),
  mine: c.ownerId === ownerOf(auth),
  username: c.username,
  name: c.name,
  description: c.description,
  target: c.target,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

async function findCampaign(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  const { campaigns } = await collections()
  return campaigns.findOne({ _id: new ObjectId(id), ...scope(auth) })
}

// Returns the campaign's id when this person may use it, so searches can be filed under it.
export async function campaignIdFor(auth: AuthInfo, id: unknown) {
  if (typeof id !== 'string' || !id) return null
  const c = await findCampaign(auth, id)
  return c?._id ?? null
}

export async function listCampaigns(auth: AuthInfo) {
  const { campaigns, leads } = await collections()
  const list = await campaigns.find(scope(auth)).sort({ updatedAt: -1 }).limit(500).toArray()
  const ids = list.map(c => c._id)
  const [searchStats, leadCounts] = await Promise.all([
    campaignStats(ids),
    leads.aggregate<{ _id: ObjectId; n: number }>([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: '$campaignId', n: { $sum: 1 } } },
    ]).toArray(),
  ])
  const leadsBy = new Map(leadCounts.map(r => [String(r._id), r.n]))
  return list.map(c => {
    const s = searchStats.get(String(c._id))
    return {
      ...toPublic(c, auth),
      searchCount: s?.searches ?? 0,
      leadCount: leadsBy.get(String(c._id)) ?? 0,
      lastSearchAt: s?.lastSearchAt ?? null,
    }
  })
}

export async function createCampaign(auth: AuthInfo, input: ReturnType<typeof parseCampaignInput>) {
  const { campaigns } = await collections()
  const ownerId = ownerOf(auth)
  if ((await campaigns.countDocuments({ ownerId })) >= MAX_CAMPAIGNS_PER_OWNER) return null
  const now = new Date()
  const doc: CampaignDoc = { _id: new ObjectId(), ownerId, username: auth.username, ...input, createdAt: now, updatedAt: now }
  await campaigns.insertOne(doc)
  return toPublic(doc, auth)
}

export async function getCampaign(auth: AuthInfo, id: string) {
  const c = await findCampaign(auth, id)
  if (!c) return null
  const { leads } = await collections()
  const saved = await leads.find({ campaignId: c._id }).sort({ addedAt: -1 }).limit(MAX_LEADS_PER_CAMPAIGN).toArray()
  return {
    campaign: toPublic(c, auth),
    leads: saved.map(l => ({ ...l.lead, addedAt: l.addedAt, searchId: l.searchId })),
  }
}

export async function updateCampaign(auth: AuthInfo, id: string, input: ReturnType<typeof parseCampaignInput>) {
  const c = await findCampaign(auth, id)
  if (!c) return null
  const { campaigns } = await collections()
  const res = await campaigns.findOneAndUpdate(
    { _id: c._id },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return res ? toPublic(res, auth) : null
}

export async function deleteCampaign(auth: AuthInfo, id: string) {
  const c = await findCampaign(auth, id)
  if (!c) return false
  const { campaigns, leads } = await collections()
  await Promise.all([
    leads.deleteMany({ campaignId: c._id }),
    deleteSearchesInCampaign(c._id),
    analyses().then(col => col.deleteOne({ _id: c._id })),
    deleteGapAnalysesFor([c._id]),
  ])
  await campaigns.deleteOne({ _id: c._id })
  return true
}

// Adds leads to a campaign, one entry per business. A lead found again keeps its original
// "added" date but gets the fresher data, unless the saved copy was already enriched.
export async function saveCampaignLeads(campaignId: ObjectId, list: Array<{ id: string }>, searchId: string | null) {
  if (!list.length) return
  const { campaigns, leads } = await collections()
  const room = MAX_LEADS_PER_CAMPAIGN - (await leads.countDocuments({ campaignId }))
  const existing = new Set(
    (await leads.find({ campaignId, leadId: { $in: list.map(l => l.id) } }, { projection: { leadId: 1 } }).toArray()).map(l => l.leadId),
  )
  const fresh = list.filter(l => !existing.has(l.id)).slice(0, Math.max(room, 0))
  const now = new Date()
  const ops: AnyBulkWriteOperation<CampaignLeadDoc>[] = [
    ...fresh.map(lead => ({
      insertOne: { document: { _id: new ObjectId(), campaignId, leadId: lead.id, lead, searchId, addedAt: now, updatedAt: now } },
    })),
    ...list.filter(l => existing.has(l.id)).map(lead => ({
      updateOne: {
        filter: { campaignId, leadId: lead.id, 'lead.enrichment': { $exists: false } },
        update: { $set: { lead, updatedAt: now } },
      },
    })),
  ]
  if (ops.length) await leads.bulkWrite(ops, { ordered: false })
  await campaigns.updateOne({ _id: campaignId }, { $set: { updatedAt: now } })
}

// Stores a lead's latest state (e.g. after enrichment) so the credits spent on it aren't lost.
export async function updateCampaignLead(auth: AuthInfo, id: string, lead: { id: string }) {
  const c = await findCampaign(auth, id)
  if (!c) return false
  const { leads } = await collections()
  const res = await leads.updateOne({ campaignId: c._id, leadId: lead.id }, { $set: { lead, updatedAt: new Date() } })
  return res.matchedCount === 1
}

export async function removeCampaignLead(auth: AuthInfo, id: string, leadId: string) {
  const c = await findCampaign(auth, id)
  if (!c) return false
  const { leads } = await collections()
  const res = await leads.deleteOne({ campaignId: c._id, leadId })
  return res.deletedCount === 1
}

// Deleting a user takes their campaigns and saved leads with them.
export async function deleteCampaignsFor(ownerId: string) {
  const { campaigns, leads } = await collections()
  const ids = (await campaigns.find({ ownerId }, { projection: { _id: 1 } }).toArray()).map(c => c._id)
  if (!ids.length) return
  await leads.deleteMany({ campaignId: { $in: ids } })
  await (await analyses()).deleteMany({ _id: { $in: ids } })
  await deleteGapAnalysesFor(ids)
  await campaigns.deleteMany({ _id: { $in: ids } })
}

// The Graph8 market analysis of a campaign's target, kept so it is only paid for when refreshed.
export interface MarketAnalysis {
  filtersUsed: { industryField: string; locations: Location[]; industries: string[] }
  total: number
  noWebsite: number
  withPhone: number
  breakdowns: Record<string, Array<{ id: string; label: string; count: number }>>
  // Extra market signals; each is null when Graph8 could not answer it.
  insights?: MarketInsights
  computedAt: Date
  computedBy: string
}

export interface MarketInsights {
  // Businesses with a phone number but no website: the easiest first-site sale.
  reachableNoWebsite: number | null
  // Founded in the last three years.
  newBusinesses: number | null
  // Measured on a sample of the market's businesses and their contacts.
  sample: {
    size: number
    withLinkedin: number
    withFacebook: number
    withPhone: number
    noWebsite: number
    withDecisionMaker: number
    withEmail: number
  } | null
}

async function analyses() {
  return (await getDb()).collection<MarketAnalysis & { _id: ObjectId }>('campaign_analysis')
}

export async function getMarketAnalysis(campaignId: string) {
  const doc = await (await analyses()).findOne({ _id: new ObjectId(campaignId) })
  if (!doc) return null
  const { _id, ...rest } = doc
  return rest
}

export async function saveMarketAnalysis(campaignId: string, a: MarketAnalysis) {
  await (await analyses()).replaceOne({ _id: new ObjectId(campaignId) }, a, { upsert: true })
}

// One saved lead, if this person may see the campaign.
export async function getCampaignLead(auth: AuthInfo, campaignId: string, leadId: string) {
  const c = await findCampaign(auth, campaignId)
  if (!c) return null
  const { leads } = await collections()
  const doc = await leads.findOne({ campaignId: c._id, leadId })
  return doc ? { campaignId: c._id, lead: doc.lead as Record<string, any> } : null
}

const OTHER_KEY = '__other__'

function autoKeyFor(target: CampaignTarget) {
  const norm = (xs: string[]) => [...new Set(xs.map(x => x.trim().toLowerCase()).filter(Boolean))].sort()
  const industries = norm(target.industries)
  const locations = norm(target.locations.map(l => l.value))
  return industries.length || locations.length ? JSON.stringify({ i: industries, l: locations }) : OTHER_KEY
}

const titleCase = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/(^|\s)\S/g, c => c.toUpperCase())

// Every Discover search belongs to a campaign. For a search made outside one, reuse this person's campaign
// with the same target, or create it (named after the search). At the campaign limit, searches go to a
// single "Other searches" campaign instead of being lost.
export async function campaignForSearch(auth: AuthInfo, target: CampaignTarget, prompt: string) {
  const { campaigns } = await collections()
  const ownerId = ownerOf(auth)
  let key = autoKeyFor(target)

  const reuse = async (k: string) => {
    const found = await campaigns.findOneAndUpdate(
      { ownerId, autoKey: k }, { $set: { updatedAt: new Date() } }, { returnDocument: 'after' })
    return found ? { campaign: toPublic(found, auth), id: found._id, created: false } : null
  }

  const existing = await reuse(key)
  if (existing) return existing

  const atLimit = (await campaigns.countDocuments({ ownerId })) >= MAX_CAMPAIGNS_PER_OWNER
  if (atLimit && key !== OTHER_KEY) {
    key = OTHER_KEY
    const other = await reuse(key)
    if (other) return other
  }

  const where = target.locations.map(l => l.value).join(', ')
  const what = target.industries.join(', ')
  const name = key === OTHER_KEY
    ? 'Other searches'
    : titleCase(prompt) || (what && where ? `${what} in ${where}` : what || `Businesses in ${where}`)
  const now = new Date()
  const doc: CampaignDoc = {
    _id: new ObjectId(),
    ownerId,
    username: auth.username,
    name: name.slice(0, 80),
    description: key === OTHER_KEY
      ? 'Searches made outside a campaign after the campaign limit was reached.'
      : 'Created automatically from a Discover search.',
    target: key === OTHER_KEY ? { industries: [], locations: [] } : target,
    autoKey: key,
    createdAt: now,
    updatedAt: now,
  }
  await campaigns.insertOne(doc)
  return { campaign: toPublic(doc, auth), id: doc._id, created: true }
}

// Saved leads across campaigns, for the dashboard's lead temperature (newest first, bounded).
export async function leadsForCampaigns(ids: ObjectId[], limit = 3000) {
  const { leads } = await collections()
  const docs = await leads.find({ campaignId: { $in: ids } }).sort({ addedAt: -1 }).limit(limit).toArray()
  return docs.map(d => ({ campaignId: String(d.campaignId), lead: d.lead as Record<string, any> }))
}

// Leads saved per week (weeks starting Monday) across campaigns, for the dashboard chart.
export async function leadsPerWeek(ids: ObjectId[], weeks = 8) {
  const { leads } = await collections()
  const since = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000)
  const rows = await leads.aggregate<{ _id: Date; n: number }>([
    { $match: { campaignId: { $in: ids }, addedAt: { $gte: since } } },
    { $group: { _id: { $dateTrunc: { date: '$addedAt', unit: 'week', startOfWeek: 'monday' } }, n: { $sum: 1 } } },
  ]).toArray()
  return rows.map(r => ({ week: r._id, count: r.n }))
}
