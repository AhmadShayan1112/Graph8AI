import { getDb } from './db.js'
import { decrypt, encrypt } from './crypto.js'

export type SecretName = 'graph8ApiKey' | 'claudeToken' | 'geminiApiKey'

interface SettingsDoc {
  _id: 'app'
  graph8ApiKey?: string
  graph8ApiKeyUpdatedAt?: Date
  claudeToken?: string
  claudeTokenUpdatedAt?: Date
  geminiApiKey?: string
  geminiApiKeyUpdatedAt?: Date
  // The admin's model order: try the first, then the next when one fails. Empty means automatic.
  geminiModels?: string[]
  // true: use only the listed models, never other ones the key offers.
  geminiModelStrict?: boolean
  // Older single-model setting, read as a one-item list.
  geminiModel?: string
  // Workspace-wide access the admin grants to every user on top of their own switches.
  graph8ForEveryone?: boolean
  geminiForEveryone?: boolean
  claudeForEveryone?: boolean
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
    { projection: { graph8ApiKeyUpdatedAt: 1, claudeTokenUpdatedAt: 1, geminiApiKeyUpdatedAt: 1, graph8ApiKey: 1, claudeToken: 1, geminiApiKey: 1 } },
  )
  return {
    graph8: {
      configured: !!doc?.graph8ApiKey || !!process.env.G8_API_KEY,
      source: doc?.graph8ApiKey ? 'settings' : process.env.G8_API_KEY ? 'env' : null,
      updatedAt: doc?.graph8ApiKeyUpdatedAt ?? null,
    },
    claude: { configured: !!doc?.claudeToken, updatedAt: doc?.claudeTokenUpdatedAt ?? null },
    gemini: { configured: !!doc?.geminiApiKey, updatedAt: doc?.geminiApiKeyUpdatedAt ?? null },
  }
}

// The Claude token is read fresh on every use (no cache) so a delete takes effect immediately.
export function getClaudeToken() {
  return readSecret('claudeToken')
}

// Read fresh on every use, like the Claude token, so a delete takes effect immediately.
export function getGeminiKey() {
  return readSecret('geminiApiKey')
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
export interface WorkspaceAccess { graph8ForEveryone: boolean; geminiForEveryone: boolean; claudeForEveryone: boolean }
let accessCache: { value: WorkspaceAccess; at: number } | null = null

export async function getWorkspaceAccess() {
  if (accessCache && Date.now() - accessCache.at < 15_000) return accessCache.value
  const doc = await (await settings()).findOne({ _id: 'app' }, { projection: { graph8ForEveryone: 1, geminiForEveryone: 1, claudeForEveryone: 1 } })
  const value: WorkspaceAccess = {
    graph8ForEveryone: doc?.graph8ForEveryone === true,
    geminiForEveryone: doc?.geminiForEveryone === true,
    claudeForEveryone: doc?.claudeForEveryone === true,
  }
  accessCache = { value, at: Date.now() }
  return value
}

// Only the switches passed in change; the others keep their value.
export async function setWorkspaceAccess(access: Partial<WorkspaceAccess>) {
  const $set: Partial<WorkspaceAccess> = {}
  if (typeof access.graph8ForEveryone === 'boolean') $set.graph8ForEveryone = access.graph8ForEveryone
  if (typeof access.geminiForEveryone === 'boolean') $set.geminiForEveryone = access.geminiForEveryone
  if (typeof access.claudeForEveryone === 'boolean') $set.claudeForEveryone = access.claudeForEveryone
  await (await settings()).updateOne({ _id: 'app' }, { $set }, { upsert: true })
  accessCache = null
  return getWorkspaceAccess()
}

// Read on every model call, so a short per-instance cache avoids a DB read each time.
export interface ModelChoice { models: string[]; strict: boolean }
let modelCache: { value: ModelChoice; at: number } | null = null
export async function getGeminiModel(): Promise<ModelChoice> {
  if (modelCache && Date.now() - modelCache.at < 15_000) return modelCache.value
  const doc = await (await settings()).findOne(
    { _id: 'app' }, { projection: { geminiModels: 1, geminiModel: 1, geminiModelStrict: 1 } },
  ).catch(() => null)
  const models = doc?.geminiModels?.length ? doc.geminiModels : doc?.geminiModel ? [doc.geminiModel] : []
  const value = { models, strict: models.length > 0 && doc?.geminiModelStrict === true }
  modelCache = { value, at: Date.now() }
  return value
}

export async function setGeminiModel(choice: ModelChoice) {
  await (await settings()).updateOne(
    { _id: 'app' },
    choice.models.length
      ? { $set: { geminiModels: choice.models, geminiModelStrict: choice.strict }, $unset: { geminiModel: '' } }
      : { $unset: { geminiModels: '', geminiModel: '', geminiModelStrict: '' } },
    { upsert: true },
  )
  modelCache = null
}
