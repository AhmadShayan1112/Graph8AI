import type { Enrichment, Lead, MvpData, OutreachData } from '../types/lead'

const BASE = '/api'

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// Fired on any 401 so the app can drop back to the sign-in screen.
export const UNAUTHORIZED_EVENT = 'gapwise:unauthorized'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(body?.error || `API error: ${res.status}`, res.status)
  }
  return res.json()
}

export interface Suggestion {
  value: string
  count: number
  field: 'industry' | 'city' | 'country' | 'state'
}

export async function suggest(kind: 'industry' | 'location', q: string, signal?: AbortSignal) {
  const res = await apiFetch<{ suggestions: Suggestion[] }>(
    `/search/suggest?kind=${kind}&q=${encodeURIComponent(q)}`, { signal })
  return res.suggestions
}

export interface DiscoverFilters {
  prompt?: string
  industries: string[]
  locations: Array<{ value: string; field?: 'city' | 'country' | 'state' }>
  keywords: string[]
  employees: string[]
  revenue: string[]
  foundedFrom?: number
  foundedTo?: number
  website: 'any' | 'has' | 'none'
  hasPhone: boolean
  limit: number
}

export const EMPTY_FILTERS: DiscoverFilters = {
  industries: [], locations: [], keywords: [], employees: [], revenue: [],
  website: 'any', hasPhone: false, limit: 20,
}

export interface DiscoverResult {
  leads: Lead[]
  total: number
  hasMore: boolean
  matchedOn: { industry: string; locations: DiscoverFilters['locations'] } | null
}

export async function discoverLeads(filters: DiscoverFilters): Promise<DiscoverResult> {
  return apiFetch('/leads/discover', { method: 'POST', body: JSON.stringify(filters) })
}

export type FilterOption = { id: string; label: string; count: number }

export async function getFilterOptions(): Promise<{ employee_count: FilterOption[]; revenue: FilterOption[] }> {
  return apiFetch('/search/options')
}

export async function enrichLead(lead: Lead): Promise<Enrichment> {
  return apiFetch('/leads/enrich', {
    method: 'POST',
    body: JSON.stringify({
      domain: lead.site || undefined,
      firstName: lead.contactFirstName || undefined,
      lastName: lead.contactLastName || undefined,
      linkedin: lead.contactLinkedin || undefined,
    }),
  })
}

export async function auditWebsite(domain: string) {
  return apiFetch<{ domain: string; analysis: Lead['analysis']; company: any }>(
    `/leads/audit?domain=${encodeURIComponent(domain)}`
  )
}

export async function generateMvp(lead: Lead, mvpType: string): Promise<{ mvp: MvpData; lead: Lead }> {
  return apiFetch('/mvp/generate', {
    method: 'POST',
    body: JSON.stringify({ lead, mvpType }),
  })
}

export async function generateOutreach(
  lead: Lead,
  mvpType: string,
  mvpUrl?: string
): Promise<OutreachData> {
  return apiFetch('/outreach/generate', {
    method: 'POST',
    body: JSON.stringify({ lead, mvpType, mvpUrl }),
  })
}

export interface SessionInfo { required: boolean; authenticated: boolean; passwordConfigured: boolean }

export const getSession = () => apiFetch<SessionInfo>('/auth/session')
export const login = (password: string) =>
  apiFetch<{ authenticated: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
export const logout = () => apiFetch<{ authenticated: boolean }>('/auth/logout', { method: 'POST' })

export type SecretKind = 'graph8' | 'claude'

export interface SecretsStatus {
  graph8: { configured: boolean; source: 'settings' | 'env' | null; updatedAt: string | null }
  claude: { configured: boolean; updatedAt: string | null }
}
export interface SettingsStatus extends SecretsStatus {
  database: { connected: boolean; name: string }
}

export const getSettings = () => apiFetch<SettingsStatus>('/settings')
// Write-only: the value goes up once and the server never sends it back.
export const saveSecret = (kind: SecretKind, value: string) =>
  apiFetch<SecretsStatus>(`/settings/${kind}`, { method: 'PUT', body: JSON.stringify({ value }) })
export const deleteSecret = (kind: SecretKind) =>
  apiFetch<SecretsStatus>(`/settings/${kind}`, { method: 'DELETE' })

export const deploySite = (draftId: string) =>
  apiFetch<{ slug: string; path: string }>('/sites', { method: 'POST', body: JSON.stringify({ draftId }) })

export interface DeployedSite { slug: string; leadName: string; mvpType: string; updatedAt: string }
export const listSites = () => apiFetch<{ sites: DeployedSite[] }>('/sites')
