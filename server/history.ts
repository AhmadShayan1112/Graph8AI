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
  createdAt: Date
}

// Keep each person's history bounded so a busy account can't grow the database forever.
const MAX_PER_OWNER = 200

let indexReady = false
async function searches() {
  const col = (await getDb()).collection<SearchDoc>('searches')
  if (!indexReady) {
    await col.createIndex({ ownerId: 1, createdAt: -1 })
    indexReady = true
  }
  return col
}

const ownerOf = (auth: AuthInfo) => auth.userId ?? 'admin'
// The admin can open any search; a user only their own.
const scope = (auth: AuthInfo) => (auth.role === 'admin' ? {} : { ownerId: ownerOf(auth) })

export async function saveSearch(
  auth: AuthInfo,
  s: { prompt: string; filters: Record<string, unknown>; matchedOn: unknown; total: number; leads: unknown[] },
) {
  const col = await searches()
  const ownerId = ownerOf(auth)
  const { insertedId } = await col.insertOne({ _id: new ObjectId(), ownerId, username: auth.username, ...s, createdAt: new Date() })
  const stale = await col.find({ ownerId }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).skip(MAX_PER_OWNER).toArray()
  if (stale.length) await col.deleteMany({ _id: { $in: stale.map(d => d._id) } })
  return String(insertedId)
}

export async function listSearches(auth: AuthInfo) {
  const list = await (await searches())
    .aggregate<SearchDoc & { leadCount: number }>([
      { $match: scope(auth) },
      { $sort: { createdAt: -1 } },
      { $limit: MAX_PER_OWNER },
      { $addFields: { leadCount: { $size: '$leads' } } },
      { $project: { leads: 0 } },
    ])
    .toArray()
  return list.map(({ _id, ownerId, ...rest }) => ({ id: String(_id), mine: ownerId === ownerOf(auth), ...rest }))
}

export async function getSearch(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return null
  const doc = await (await searches()).findOne({ _id: new ObjectId(id), ...scope(auth) })
  if (!doc) return null
  const { _id, ownerId, ...rest } = doc
  return { id: String(_id), mine: ownerId === ownerOf(auth), ...rest }
}

export async function deleteSearch(auth: AuthInfo, id: string) {
  if (!ObjectId.isValid(id)) return false
  const { deletedCount } = await (await searches()).deleteOne({ _id: new ObjectId(id), ...scope(auth) })
  return deletedCount === 1
}

// Deleting a user takes their history with them.
export async function deleteSearchesFor(ownerId: string) {
  await (await searches()).deleteMany({ ownerId })
}
