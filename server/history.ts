import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import type { AuthInfo } from './auth.js'

// Every lead search a person runs is saved with its results, so they can reopen it later
// without spending Graph8 calls again. Users see their own searches; the admin sees everyone's.
interface SearchDoc {
  _id: ObjectId
  ownerId: string
  username: string
  prompt: string
  filters: Record<string, unknown>
  matchedOn: unknown
  total: number
  leads: unknown[]
  // Set when the search was run inside a campaign.
  campaignId?: ObjectId | null
  createdAt: Date
}

// Keep history bounded so a busy account can't grow the database forever:
// 200 loose searches per person, and 200 per campaign.
const MAX_PER_BUCKET = 200

let indexReady = false
async function searches() {
  const col = (await getDb()).collection<SearchDoc>('searches')
  if (!indexReady) {
    await col.createIndex({ ownerId: 1, createdAt: -1 })
    await col.createIndex({ campaignId: 1, createdAt: -1 })
    indexReady = true
  }
  return col
}

export const ownerOf = (auth: AuthInfo) => auth.userId ?? 'admin'
// The admin can open anything; a user only their own.
export const scope = (auth: AuthInfo) => (auth.role === 'admin' ? {} : { ownerId: ownerOf(auth) })

export async function saveSearch(
  auth: AuthInfo,
  s: { prompt: string; filters: Record<string, unknown>; matchedOn: unknown; total: number; leads: unknown[]; campaignId: ObjectId | null },
) {
  const col = await searches()
  const ownerId = ownerOf(auth)
  const { insertedId } = await col.insertOne({ _id: new ObjectId(), ownerId, username: auth.username, ...s, createdAt: new Date() })
  const bucket = s.campaignId ? { campaignId: s.campaignId } : { ownerId, campaignId: null }
  const stale = await col.find(bucket, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(MAX_PER_BUCKET).toArray()
  if (stale.length) await col.deleteMany({ _id: { $in: stale.map(d => d._id) } })
  return String(insertedId)
}

export async function listSearches(auth: AuthInfo, campaignId?: ObjectId) {
  const list = await (await searches())
    .aggregate<SearchDoc & { leadCount: number }>([
      { $match: { ...scope(auth), ...(campaignId ? { campaignId } : {}) } },
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      { $addFields: { leadCount: { $size: '$leads' } } },
      { $project: { leads: 0 } },
    ])
    .toArray()
  return list.map(({ _id, ownerId, campaignId, ...rest }) => ({
    id: String(_id), mine: ownerId === ownerOf(auth), campaignId: campaignId ? String(campaignId) : null, ...rest,
  }))
}

export async function getSearch(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  const doc = await (await searches()).findOne({ _id: new ObjectId(id), ...scope(auth) })
  if (!doc) return null
  const { _id, ownerId, campaignId, ...rest } = doc
  return { id: String(_id), mine: ownerId === ownerOf(auth), campaignId: campaignId ? String(campaignId) : null, ...rest }
}

export async function deleteSearch(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return false
  const { deletedCount } = await (await searches()).deleteOne({ _id: new ObjectId(id), ...scope(auth) })
  return deletedCount === 1
}

// Search and lead counts for each campaign, in one query.
export async function campaignStats(ids: ObjectId[]) {
  const rows = await (await searches())
    .aggregate<{ _id: ObjectId; searches: number; leads: number; lastSearchAt: Date }>([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: '$campaignId', searches: { $sum: 1 }, leads: { $sum: { $size: '$leads' } }, lastSearchAt: { $max: '$createdAt' } } },
    ])
    .toArray()
  return new Map(rows.map(r => [String(r._id), r]))
}

export async function deleteSearchesInCampaign(campaignId: ObjectId) {
  await (await searches()).deleteMany({ campaignId })
}

// Deleting a user takes their history with them.
export async function deleteSearchesFor(ownerId: string) {
  await (await searches()).deleteMany({ ownerId })
}

export async function countSearches(auth: AuthInfo) {
  return (await searches()).countDocuments(scope(auth))
}
