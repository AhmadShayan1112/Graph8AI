import type { Enrichment, Lead, MvpData } from '../types/lead'

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
  // Set when a search made outside a campaign was filed under one automatically.
  campaign: Campaign | null
  createdCampaign: boolean
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

export type MvpAgent = 'research' | 'strategy' | 'design' | 'build'

// What the researcher, strategist and designer agents produced; the builder turns it into the site.
export interface MvpPlanResult {
  planId: string
  industry: string
  usedGapAnalysis: boolean
  researchNote: string
  research: Record<string, any> | null
  images: Array<{ id: string; src: string; alt: string; kind: string }>
  plan: {
    solution: { type: string; title: string; promise: string; whyItWillClick: string; fixesGaps: string[] }
    flow: Array<{ step: number; screen: string; userAction: string; systemResponse: string }>
    modules?: Array<{ id: string; name: string; purpose: string; features: string[]; data: string }>
    sections: Array<{ id: string; name: string; purpose: string; content: string }>
    interactions: Array<{ name: string; behaviour: string }>
    cta: { primary: string; secondary: string }
    copy: { headline: string; subheadline: string; tone: string }
    design: {
      mood: string
      palette: Record<string, string>
      fonts: { heading: string; body: string }
      motifs: string[]
      animations: Array<{ name: string; where: string; how: string }>
      imagery: Array<{ imageId: string; where: string }>
    }
  }
}

// ── Background jobs: the server does the work; pages start jobs and watch them ──

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
export interface Job<S = Record<string, any>, O = Record<string, any>> {
  id: string
  kind: 'mvp' | 'gaps'
  status: JobStatus
  step: string
  title: string
  username: string
  leadId: string | null
  campaignId: string | null
  lead: Lead | null
  state: S
  output: O | null
  error: string
  cancelRequested: boolean
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}
export const isActiveJob = (j: Pick<Job, 'status'> | null | undefined) => !!j && (j.status === 'queued' || j.status === 'running')

export interface MvpJobState {
  agents?: Partial<Record<MvpAgent, 'active' | 'done' | 'skipped'>>
  research?: Record<string, any> | null
  researchNote?: string
  usedGapAnalysis?: boolean
  planId?: string
  plan?: MvpPlanResult['plan']
  images?: MvpPlanResult['images']
  build?: { chars: number; action: string; module?: string }
  modules?: Array<{ id: string; name: string; status: 'waiting' | 'active' | 'done' }>
  researchStartedAt?: string; researchDoneAt?: string
  planStartedAt?: string; planDoneAt?: string
  buildStartedAt?: string; buildDoneAt?: string
}
export type MvpJob = Job<MvpJobState, MvpData & { solutionType: string }>

export interface GapsJobState {
  queue: Array<{ id: string; name: string }>
  total: number
  done: number
  durations: number[]
  current: { leadId: string; leadName: string; phase: string; phaseAt: number; startedAt: number; seen: string[] } | null
  retry: { at: number; attempt: number; of: number; reason: string } | null
  lastError: string
}
export type GapsJob = Job<GapsJobState>

// `planId` rebuilds from a saved plan (skips research and planning).
export const startMvpJob = (lead: Lead, campaignId: string | undefined, preference: string, planId?: string) =>
  apiFetch<{ job: MvpJob }>('/jobs', { method: 'POST', body: JSON.stringify({ kind: 'mvp', lead, campaignId, preference: preference || undefined, planId }) })
export const startGapsJob = (campaignId: string, campaignName: string, leads: Array<{ id: string; name: string }>) =>
  apiFetch<{ job: GapsJob }>('/jobs', { method: 'POST', body: JSON.stringify({ kind: 'gaps', campaignId, campaignName, leads }) })
export const fetchJob = <J extends Job = Job>(id: string) => apiFetch<{ job: J }>(`/jobs/${id}`)
export const listJobs = <J extends Job = Job>(q: { kind?: 'mvp' | 'gaps'; leadId?: string; campaignId?: string; active?: boolean; limit?: number }) => {
  const p = new URLSearchParams()
  if (q.kind) p.set('kind', q.kind)
  if (q.leadId) p.set('leadId', q.leadId)
  if (q.campaignId) p.set('campaignId', q.campaignId)
  if (q.active) p.set('active', '1')
  if (q.limit) p.set('limit', String(q.limit))
  return apiFetch<{ jobs: J[] }>(`/jobs?${p}`)
}
export const cancelJob = (id: string) => apiFetch<{ job: Job }>(`/jobs/${id}/cancel`, { method: 'POST' })
export const resumeJob = (id: string) => apiFetch<{ job: Job }>(`/jobs/${id}/resume`, { method: 'POST' })


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

export type SecretKind = 'graph8' | 'claude' | 'gemini' | 'resend'

export interface SecretsStatus {
  graph8: { configured: boolean; source: 'settings' | 'env' | null; updatedAt: string | null }
  claude: { configured: boolean; updatedAt: string | null }
  gemini: { configured: boolean; updatedAt: string | null }
  resend: { configured: boolean; updatedAt: string | null }
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

export interface WorkspaceAccess { graph8ForEveryone: boolean; geminiForEveryone: boolean; claudeForEveryone: boolean }
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
  insights?: {
    reachableNoWebsite: number | null
    newBusinesses: number | null
    sample: {
      size: number; withLinkedin: number; withFacebook: number; withPhone: number
      noWebsite: number; withDecisionMaker: number; withEmail: number
    } | null
  }
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
export type GapStage = 'graph8' | 'research' | 'saving'

// Runs Graph8 + Gemini web research for one lead (10-60 seconds). The server streams one JSON event per line:
// `stage` as each step starts, then `done` with the analysis or `error`.
export async function runGapAnalysis(campaignId: string, leadId: string, onStage: (stage: GapStage) => void) {
  const res = await fetch(`${BASE}/campaigns/${campaignId}/gaps/${encodeURIComponent(leadId)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(body?.error || `API error: ${res.status}`, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'stage') onStage(event.stage)
      else if (event.type === 'done') return event.analysis as GapAnalysis
      else if (event.type === 'error') throw new ApiError(event.error, event.status ?? 502)
    }
    if (done) break
  }
  throw new ApiError('The gap analysis stopped before it finished. Try again.', 502)
}

export interface Dashboard {
  scope: 'workspace' | 'mine'
  totals: { campaigns: number; leads: number; searches: number; gapAnalyses: number; sites: number }
  campaigns: Array<{
    id: string; name: string; target: CampaignTarget; leadCount: number; searchCount: number
    lastSearchAt: string | null; username: string; mine: boolean
  }>
  topProspects: Array<{
    campaignId: string; campaignName: string; leadId: string; leadName: string
    fitScore: number; offer: string; topGap: string; createdAt: string
  }>
  recentSearches: Array<{
    id: string; prompt: string; filters: DiscoverFilters; leadCount: number; total: number
    createdAt: string; campaignName: string; username: string; mine: boolean
  }>
  sites: DeployedSite[]
  keys: { graph8: boolean; claude: boolean; gemini: boolean } | null
  temperature: LeadTemperature | null
  charts?: {
    weekly: Array<{ week: string; count: number }>
    funnel: Array<{ stage: string; count: number }>
    campaignLeads: Array<{ id: string; name: string; count: number }>
  }
}

export type Temp = 'hot' | 'warm' | 'cold'
export interface LeadTemperature {
  total: number
  hot: number
  warm: number
  cold: number
  notAnalysed: number
  notEnriched: number
  byCampaign: Array<{ id: string; name: string; hot: number; warm: number; cold: number }>
  hottest: Array<{
    campaignId: string; campaignName: string; leadId: string; name: string; city: string
    offer: string; points: number; temp: Temp; reasons: string[]
  }>
  offers?: Array<{ offer: string; count: number }>
}

export const getDashboard = () => apiFetch<Dashboard>('/dashboard')

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

// Streams the assistant's reply: `onText` receives each new piece as it is written.
// `publicSite` uses the visitor assistant, which works without signing in.
export async function askAssistant(
  messages: ChatMessage[], page: string, onText: (text: string) => void, signal?: AbortSignal, publicSite = false,
) {
  const res = await fetch(`${BASE}${publicSite ? '/public/assistant' : '/assistant/chat'}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, page }),
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    if (res.status === 401 && !publicSite) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(body?.error || `API error: ${res.status}`, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'delta') onText(event.text)
      else if (event.type === 'done') return
      else if (event.type === 'error') throw new ApiError(event.error, 502)
    }
    if (done) return
  }
}

export type TicketStatus = 'open' | 'answered' | 'closed'
export interface TicketSummary {
  id: string
  username: string
  visitor: boolean
  // Only sent to the admin, for visitors from the public site.
  contactEmail: string | null
  mine: boolean
  subject: string
  page: string
  status: TicketStatus
  unread: boolean
  lastMessage: { from: 'user' | 'admin'; text: string; at: string } | null
  messageCount: number
  createdAt: string
  updatedAt: string
}
export interface Ticket extends TicketSummary {
  messages: Array<{ from: 'user' | 'admin'; name: string; text: string; at: string }>
  transcript: ChatMessage[]
}

export const getSupportSummary = () => apiFetch<{ waiting: number }>('/support/summary')
export const listTickets = (status?: TicketStatus) =>
  apiFetch<{ tickets: TicketSummary[] }>(`/support/tickets${status ? `?status=${status}` : ''}`)
export const getTicket = (id: string) => apiFetch<{ ticket: Ticket }>(`/support/tickets/${id}`)
export const createTicket = (message: string, transcript: ChatMessage[], page: string) =>
  apiFetch<{ ticket: Ticket }>('/support/tickets', { method: 'POST', body: JSON.stringify({ message, transcript, page }) })
export const replyToTicket = (id: string, text: string) =>
  apiFetch<{ ticket: Ticket }>(`/support/tickets/${id}/replies`, { method: 'POST', body: JSON.stringify({ text }) })
export const setTicketStatus = (id: string, status: 'open' | 'closed') =>
  apiFetch<{ ticket: Ticket }>(`/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })

// "Talk to a person" from the public site, where visitors have no account.
export const contactTeam = (name: string, email: string, message: string, transcript: ChatMessage[]) =>
  apiFetch<{ sent: boolean }>('/public/contact', { method: 'POST', body: JSON.stringify({ name, email, message, transcript }) })

export interface GeminiCheck { ok: boolean; model?: string; error?: string }
// Admin: one plain and one web-search request with the saved Gemini key.
export const testGeminiKey = () =>
  apiFetch<{ assistant: GeminiCheck; research: GeminiCheck }>('/settings-test/gemini', { method: 'POST' })

export interface GeminiModelOption { id: string; label: string; cheap: boolean }
export const getGeminiModels = () =>
  apiFetch<{ order: string[]; strict: boolean; inUse: string | null; models: GeminiModelOption[]; error: string }>('/settings-model/gemini')
// The order to try models in: the first, then the next when one fails. An empty list means automatic.
// `strict` uses only the listed models and never others.
export const setGeminiModel = (models: string[], strict: boolean) =>
  apiFetch<{ order: string[]; strict: boolean }>('/settings-model/gemini', { method: 'PUT', body: JSON.stringify({ models, strict }) })

// ── Outreach: one email per lead with its deployed MVP link, sent through the workspace's email service ──
export interface OutreachEmail {
  id: string
  leadId: string
  leadName: string
  to: string
  subject: string
  body: string
  siteUrl: string
  status: 'draft' | 'sent' | 'failed'
  error: string
  createdAt: string
  updatedAt: string
  sentAt: string | null
  username: string
}
export const getOutreach = (leadId: string) =>
  apiFetch<{ emails: OutreachEmail[]; siteUrl: string | null; sending: { ready: boolean; from: string } }>(`/outreach?leadId=${encodeURIComponent(leadId)}`)
export const draftOutreach = (lead: Lead, campaignId?: string) =>
  apiFetch<{ email: OutreachEmail }>('/outreach/draft', { method: 'POST', body: JSON.stringify({ lead, campaignId }) })
export const saveOutreach = (id: string, patch: { to?: string; subject?: string; body?: string }) =>
  apiFetch<{ email: OutreachEmail }>(`/outreach/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
export const sendOutreach = (id: string) => apiFetch<{ email: OutreachEmail }>(`/outreach/${id}/send`, { method: 'POST' })

export interface EmailSettings { from: string; replyTo: string; keyConfigured: boolean }
export const getEmailSettings = () => apiFetch<EmailSettings>('/settings-email')
export const saveEmailSettings = (from: string, replyTo: string) =>
  apiFetch<EmailSettings>('/settings-email', { method: 'PUT', body: JSON.stringify({ from, replyTo }) })
