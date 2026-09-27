import { getDb } from './db.js'
import { decrypt, encrypt } from './crypto.js'

export type SecretName = 'graph8ApiKey' | 'claudeToken'

interface SettingsDoc {
  _id: 'app'
  graph8ApiKey?: string
  graph8ApiKeyUpdatedAt?: Date
  claudeToken?: string
  claudeTokenUpdatedAt?: Date
  // Workspace-wide access the admin grants to every user on top of their own switches.
  graph8ForEveryone?: boolean
}

const settings = async () => (await getDb()).collection<SettingsDoc>('settings')

export async function setSecret(name: SecretName, value: string) {
  await (await settings()).updateOne(
    { _id: 'app' },
    { $set: { [name]: encrypt(value, name), [`${name}UpdatedAt`]: new Date() } },
    { upsert: true },
  )
  if (name === 'graph8ApiKey') graph8Cache = null
}

export async function deleteSecret(name: SecretName) {
  await (await settings()).updateOne({ _id: 'app' }, { $unset: { [name]: '', [`${name}UpdatedAt`]: '' } })
  if (name === 'graph8ApiKey') graph8Cache = null
}

async function readSecret(name: SecretName) {
  const doc = await (await settings()).findOne({ _id: 'app' }, { projection: { [name]: 1 } })
  return doc?.[name] ? decrypt(doc[name]!, name) : null
}

// Only presence and timestamps ever leave the server, never the values.
export async function secretStatus() {
  const doc = await (await settings()).findOne(
    { _id: 'app' },
    { projection: { graph8ApiKeyUpdatedAt: 1, claudeTokenUpdatedAt: 1, graph8ApiKey: 1, claudeToken: 1 } },
  )
  return {
    graph8: {
      configured: !!doc?.graph8ApiKey || !!process.env.G8_API_KEY,
      source: doc?.graph8ApiKey ? 'settings' : process.env.G8_API_KEY ? 'env' : null,
      updatedAt: doc?.graph8ApiKeyUpdatedAt ?? null,
    },
    claude: { configured: !!doc?.claudeToken, updatedAt: doc?.claudeTokenUpdatedAt ?? null },
  }
}

// The Claude token is read fresh on every use (no cache) so a delete takes effect immediately.
export function getClaudeToken() {
  return readSecret('claudeToken')
}

// Discover fires several Graph8 calls per request; a short per-instance cache avoids a DB read for each.
let graph8Cache: { value: string | null; at: number } | null = null
export async function getGraph8Key() {
  if (graph8Cache && Date.now() - graph8Cache.at < 15_000) return graph8Cache.value
  const value = (await readSecret('graph8ApiKey').catch(() => null)) ?? process.env.G8_API_KEY ?? null
  graph8Cache = { value, at: Date.now() }
  return value
}

// Checked on every request, so a short per-instance cache avoids a DB read each time.
// A change is immediate on this instance and reaches the others within 15 seconds.
let accessCache: { value: { graph8ForEveryone: boolean }; at: number } | null = null

export async function getWorkspaceAccess() {
  if (accessCache && Date.now() - accessCache.at < 15_000) return accessCache.value
  const doc = await (await settings()).findOne({ _id: 'app' }, { projection: { graph8ForEveryone: 1 } })
  const value = { graph8ForEveryone: doc?.graph8ForEveryone === true }
  accessCache = { value, at: Date.now() }
  return value
}

export async function setWorkspaceAccess(access: { graph8ForEveryone: boolean }) {
  await (await settings()).updateOne({ _id: 'app' }, { $set: { graph8ForEveryone: access.graph8ForEveryone } }, { upsert: true })
  accessCache = null
  return getWorkspaceAccess()
}
