import { getGraph8Key } from './secrets.js'

const BASE_URL = process.env.G8_BASE_URL || 'https://be.graph8.com'

const ORG_ID = process.env.G8_ORG_ID || ''

async function g8Fetch(path: string, options: RequestInit = {}) {
  const apiKey = await getGraph8Key()
  if (!apiKey) throw new Error('Graph8 API key is not configured. Add it in Settings.')
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (ORG_ID) headers['X-Org-Id'] = ORG_ID

  const url = `${BASE_URL}${path.startsWith('/api') ? path : `/api${path}`}`
  console.log(`[graph8] ${options.method || 'GET'} ${url}`)

  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`[graph8] Error ${res.status}: ${text.slice(0, 200)}`)
    throw new Error(`Graph8 API error ${res.status}: ${text}`)
  }
  return res.json()
}

type SearchFilter = { field: string; operator: string; value: string[] }

export interface G8Company {
  name: string
  domain: string
  website: string
  description: string
  industry: string
  employee_count: string
  revenue: string
  phone: string
  city: string
  state: string
  country: string
  linkedin_url: string
  facebook_url: string
  twitter_url: string
}

export interface G8Contact {
  first_name: string
  last_name: string
  work_email: string
  job_title: string
  seniority_level: string
  linkedin_url: string
  linkedin_headline: string
  company_name: string
  company_domain: string
  confidence_score: number
}

// Graph8's prospecting database (700M+ contacts / 100M+ companies), not the workspace CRM.
async function g8Search<T>(entity: 'contacts' | 'companies', filters: SearchFilter[], limit: number, page = 1) {
  return g8Fetch(`/v1/search/${entity}`, {
    method: 'POST',
    body: JSON.stringify({ filters, page, limit: Math.min(limit, 100) }),
  }) as Promise<{ data: T[]; pagination: { total: number; has_next: boolean } }>
}

export type { SearchFilter }

export function searchCompaniesByFilters(filters: SearchFilter[], limit: number, page = 1) {
  return g8Search<G8Company>('companies', filters, limit, page)
}

export async function getFilterOptions(fields: string[]) {
  const out: Record<string, Array<{ id: string; label: string; count: number }>> = {}
  await Promise.all(fields.map(async f => {
    const res = await g8Fetch(`/v1/search/filter-options?resource=companies&fields=${f}`)
    out[f] = res?.data?.[f] ?? []
  }))
  return out
}

// Value counts for fields, but only among companies matching `filters` (e.g. company sizes of dentists in Lahore).
export async function getFilteredFilterOptions(filters: SearchFilter[], fields: string[], limit = 10) {
  const res = await g8Fetch('/v1/search/filter-options', {
    method: 'POST',
    body: JSON.stringify({ resource: 'companies', fields, filters, limit }),
  })
  const data = res?.data ?? {}
  const out: Record<string, Array<{ id: string; label: string; count: number }>> = {}
  for (const f of fields) {
    const raw = Array.isArray(data[f]) ? data[f] : Array.isArray(data[f]?.options) ? data[f].options : []
    out[f] = raw
      .map((o: any) => ({ id: String(o.id ?? o.value ?? ''), label: String(o.label ?? o.value ?? o.id ?? ''), count: Number(o.count) || 0 }))
      .filter((o: { label: string }) => o.label)
  }
  return out
}

export type CompanyField = 'industry' | 'city' | 'country' | 'state'

export async function autocomplete(field: CompanyField, value: string, size = 6) {
  const qs = new URLSearchParams({ resource: 'companies', field, value, size: String(size) })
  const res = await g8Fetch(`/v1/search/autocomplete?${qs}`)
  return (res?.data?.suggestions ?? []) as Array<{ value: string; count: number }>
}

export async function searchContactsByDomains(domains: string[], limit = 100) {
  if (!domains.length) return { data: [] as G8Contact[], pagination: { total: 0, has_next: false } }
  return g8Search<G8Contact>('contacts', [{ field: 'company_domain', operator: 'any_of', value: domains }], limit)
}

type Lookup<T> = { found: boolean; confidence: number; data: T | null }

export async function lookupCompany(domain: string) {
  const res = await g8Fetch('/v1/enrichment/lookup/company', { method: 'POST', body: JSON.stringify({ domain }) })
  return res.data as Lookup<Record<string, any>>
}

export async function lookupPerson(q: { linkedin_url?: string; first_name?: string; last_name?: string; company_domain?: string }) {
  const res = await g8Fetch('/v1/enrichment/lookup/person', { method: 'POST', body: JSON.stringify(q) })
  return res.data as Lookup<Record<string, any>>
}

export async function verifyEmail(email: string) {
  const res = await g8Fetch('/v1/enrichment/verify-email', { method: 'POST', body: JSON.stringify({ email }) })
  return res.data as { email: string; status: string; sub_status?: string; is_valid: boolean; mx_esp?: string }
}

export async function enrichContact(contactId: string) {
  return g8Fetch(`/v1/contacts/${contactId}/enrich`)
}

export async function enrichCompany(domain: string) {
  return g8Fetch(`/v1/companies?domain=${encodeURIComponent(domain)}`)
}

export async function getIntentSignals(companyId: string) {
  return g8Fetch(`/v1/intent?company_id=${companyId}`)
}

export async function getContactDetails(contactId: string) {
  return g8Fetch(`/v1/contacts/${contactId}`)
}

export async function getCompanyDetails(companyId: string) {
  return g8Fetch(`/v1/companies/${companyId}`)
}

export async function createSequence(data: {
  name: string
  contactIds: string[]
  steps: Array<{ type: string; subject?: string; body: string; delayDays: number }>
}) {
  return g8Fetch('/v1/sequences', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function enrollInSequence(sequenceId: string, contactIds: string[]) {
  return g8Fetch(`/v1/sequences/${sequenceId}/enroll`, {
    method: 'POST',
    body: JSON.stringify({ contact_ids: contactIds }),
  })
}

export async function listContacts(params: { limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  return g8Fetch(`/v1/contacts?${qs.toString()}`)
}

export async function listCompanies(params: { limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  return g8Fetch(`/v1/companies?${qs.toString()}`)
}
