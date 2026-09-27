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
  searchId: string | null
  total: number
  hasMore: boolean
  matchedOn: { industry: string; locations: DiscoverFilters['locations'] } | null
}

// `save: false` keeps searches the app runs by itself out of the user's history.
export async function discoverLeads(filters: DiscoverFilters, save = true, campaignId?: string): Promise<DiscoverResult> {
  return apiFetch('/leads/discover', { method: 'POST', body: JSON.stringify({ ...filters, save, campaignId }) })
}

export interface SavedSearchSummary {
  id: string
  mine: boolean
  campaignId: string | null
  username: string
  prompt: string
  filters: DiscoverFilters
  matchedOn: DiscoverResult['matchedOn']
  total: number
  leadCount: number
  createdAt: string
}
export interface SavedSearch extends Omit<SavedSearchSummary, 'leadCount'> { leads: Lead[] }

export const listSearches = () => apiFetch<{ searches: SavedSearchSummary[] }>('/searches')
export const getSearch = (id: string) => apiFetch<{ search: SavedSearch }>(`/searches/${id}`)
export const deleteSearch = (id: string) => apiFetch<{ deleted: boolean }>(`/searches/${id}`, { method: 'DELETE' })

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

export type Permission = 'claude' | 'graph8' | 'gemini'
export type Permissions = Record<Permission, boolean>

export interface SessionUser { username: string; role: 'admin' | 'user'; permissions: Permissions }
export interface SessionInfo {
  required: boolean
  authenticated: boolean
  passwordConfigured: boolean
  user: SessionUser | null
}

export const getSession = () => apiFetch<SessionInfo>('/auth/session')
export const login = (username: string, password: string) =>
  apiFetch<{ authenticated: boolean; user: SessionUser | null }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  })
export const signUp = (username: string, password: string) =>
  apiFetch<{ authenticated: boolean; user: SessionUser | null }>('/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) })
export const logout = () => apiFetch<{ authenticated: boolean }>('/auth/logout', { method: 'POST' })

export type SecretKind = 'graph8' | 'claude' | 'gemini'

export interface SecretsStatus {
  graph8: { configured: boolean; source: 'settings' | 'env' | null; updatedAt: string | null }
  claude: { configured: boolean; updatedAt: string | null }
  gemini: { configured: boolean; updatedAt: string | null }
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

export interface AppUser {
  id: string
  username: string
  permissions: Permissions
  disabled: boolean
  selfSignup: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkspaceAccess { graph8ForEveryone: boolean; geminiForEveryone: boolean }
export const getWorkspaceAccess = () => apiFetch<WorkspaceAccess>('/users/access')
export const setWorkspaceAccess = (access: Partial<WorkspaceAccess>) =>
  apiFetch<WorkspaceAccess>('/users/access', { method: 'PUT', body: JSON.stringify(access) })
export const listUsers = () => apiFetch<{ users: AppUser[] }>('/users')
export const createUser = (username: string, password: string, permissions: Permissions) =>
  apiFetch<{ user: AppUser }>('/users', { method: 'POST', body: JSON.stringify({ username, password, permissions }) })
export const updateUser = (id: string, patch: { permissions?: Partial<Permissions>; disabled?: boolean; password?: string }) =>
  apiFetch<{ user: AppUser }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteUser = (id: string) => apiFetch<{ deleted: boolean }>(`/users/${id}`, { method: 'DELETE' })

export interface CampaignTarget { industries: string[]; locations: DiscoverFilters['locations'] }
export interface CampaignInput { name: string; description: string; target: CampaignTarget }
export interface Campaign extends CampaignInput {
  id: string
  mine: boolean
  username: string
  createdAt: string
  updatedAt: string
}
export interface CampaignSummary extends Campaign { searchCount: number; leadCount: number; lastSearchAt: string | null }
export type CampaignLead = Lead & { addedAt: string; searchId: string | null }
export interface CampaignDetail { campaign: Campaign; leads: CampaignLead[]; searches: SavedSearchSummary[] }

export const listCampaigns = () => apiFetch<{ campaigns: CampaignSummary[] }>('/campaigns')
export const createCampaign = (input: CampaignInput) =>
  apiFetch<{ campaign: Campaign }>('/campaigns', { method: 'POST', body: JSON.stringify(input) })
export const getCampaign = (id: string) => apiFetch<CampaignDetail>(`/campaigns/${id}`)
export const updateCampaign = (id: string, input: CampaignInput) =>
  apiFetch<{ campaign: Campaign }>(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteCampaign = (id: string) => apiFetch<{ deleted: boolean }>(`/campaigns/${id}`, { method: 'DELETE' })
export const saveCampaignLead = (id: string, lead: Lead) =>
  apiFetch<{ saved: boolean }>(`/campaigns/${id}/leads`, { method: 'PUT', body: JSON.stringify({ lead }) })
export const removeCampaignLead = (id: string, leadId: string) =>
  apiFetch<{ deleted: boolean }>(`/campaigns/${id}/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' })

export interface BreakdownOption { id: string; label: string; count: number }
export interface MarketAnalysis {
  filtersUsed: { industryField: string; industries: string[]; locations: CampaignTarget['locations'] }
  total: number
  noWebsite: number
  withPhone: number
  breakdowns: Record<string, BreakdownOption[]>
  computedAt: string
  computedBy: string
}
export interface CampaignAnalysis {
  campaign: Campaign
  market: MarketAnalysis | null
  searchCount: number
  leads: {
    saved: number
    noWebsite: number
    enriched: number
    verifiedEmail: number
    scores: { poor: number; fair: number; good: number }
    topGaps: Array<{ label: string; count: number }>
  }
}

export const getCampaignAnalysis = (id: string) => apiFetch<CampaignAnalysis>(`/campaigns/${id}/analysis`)
// Calls Graph8 for fresh market numbers.
export const refreshCampaignAnalysis = (id: string) =>
  apiFetch<CampaignAnalysis>(`/campaigns/${id}/analysis`, { method: 'POST' })

export type GapLevel = 'high' | 'medium' | 'low'
export interface GapAnalysis {
  leadId: string
  leadName: string
  username: string
  usedGraph8: boolean
  createdAt: string
  sources: Array<{ title: string; url: string }>
  queries: string[]
  result: {
    summary: string
    onlinePresence: { website: string; websiteStatus: string; googleBusiness: string; reviews: string; social: string }
    gaps: Array<{ title: string; severity: GapLevel; evidence: string; impact: string }>
    needs: Array<{ solution: string; why: string; priority: GapLevel }>
    prospect: {
      fitScore: number
      recommendedOffer: string
      offerReason: string
      pitch: string
      talkingPoints: string[]
      emailSubject: string
      emailOpening: string
      bestChannel: string
      decisionMaker: string
    }
  }
}

export const listGapAnalyses = (campaignId: string) =>
  apiFetch<{ analyses: GapAnalysis[] }>(`/campaigns/${campaignId}/gaps`)
// Runs Graph8 + Gemini web research for one lead; takes 10-60 seconds.
export const runGapAnalysis = (campaignId: string, leadId: string) =>
  apiFetch<{ analysis: GapAnalysis }>(`/campaigns/${campaignId}/gaps/${encodeURIComponent(leadId)}`, { method: 'POST' })
