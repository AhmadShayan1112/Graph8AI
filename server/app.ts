import express, { type NextFunction, type Request, type Response } from 'express'
import { ObjectId } from 'mongodb'
import {
  searchCompaniesByFilters,
  getFilterOptions,
  getFilteredFilterOptions,
  type G8Company,
  type SearchFilter,
  searchContactsByDomains,
  autocomplete,
  lookupCompany,
  lookupPerson,
  verifyEmail,
  enrichCompany,
  getIntentSignals,
  listContacts,
  listCompanies,
} from './graph8.js'
import { analyzeWebsite, transformToLead, type LeadWithAnalysis } from './analyzer.js'
import { getAuth, login, logout, requireAdmin, requireAuth, requirePermission, session, signUp } from './auth.js'
import {
  deleteSecret, getEmailSettings, getGeminiModel, getWorkspaceAccess, secretStatus, setEmailSettings, setGeminiModel, setSecret, setWorkspaceAccess, type SecretName,
} from './secrets.js'
import { SendError, createDraft, createSecurityDraft, deleteEmailsFor, emailsForLead, sendEmail, updateDraft, validEmail } from './outreach.js'
import {
  auditFor, auditJobStart, auditPdf, deleteAuditsFor, getAudit, getAuditById, publicAudit, resetSelected, saveProducts,
} from './security.js'
import { ScanTargetError } from './securityScan.js'
import { reportFilename } from './outreach.js'
import { loadPlan } from './mvpAgents.js'
import {
  activeJobOf, cancelJob, countBuiltMvps, createJob, deleteJobsFor, getJob, keepAlive, listJobs, resumeJob, runStep, validRunSignature,
} from './jobs.js'
import { getDb } from './db.js'
import {
  createUser, deleteUser, listUsers, normalizeUsername, parsePermissions, updateUser, validatePassword, validateUsername,
} from './users.js'
import { countSearches, deleteSearch, deleteSearchesFor, getSearch, listSearches, saveSearch } from './history.js'
import {
  campaignForSearch, campaignIdFor, createCampaign, deleteCampaign, deleteCampaignsFor, getCampaign, listCampaigns, parseCampaignInput,
  removeCampaignLead, saveCampaignLeads, updateCampaign, updateCampaignLead,
  getMarketAnalysis, saveMarketAnalysis, getCampaignLead, leadsForCampaigns, leadsPerWeek, type CampaignTarget, type MarketAnalysis,
} from './campaigns.js'
import { fitsFor, gapStatsFor, listGapAnalyses, runGapAnalysis } from './gapAnalysis.js'
import { GeminiError, listGeminiModels, modelInUse, resetModelChoice, testGemini } from './gemini.js'
import { assistantChat, publicAssistantChat } from './assistant.js'
import { createTicket, createVisitorTicket, deleteTicketsFor, getTicket, listTickets, replyToTicket, setTicketStatus, supportSummary } from './support.js'

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// No API response is ever cacheable: some carry settings status, none should sit in a shared cache.
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

// `commit` shows which deployment is live (Vercel sets VERCEL_GIT_COMMIT_SHA).
app.get('/api/health', (_req, res) => { res.json({ status: 'ok', commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7) }) })
app.get('/api/auth/session', session)
app.post('/api/auth/login', login)
app.post('/api/auth/logout', logout)
app.post('/api/auth/signup', signUp)

// The public site's assistant and its "talk to a person" form work without signing in (rate-limited).
app.post('/api/public/assistant', publicAssistantChat)
app.post('/api/public/contact', createVisitorTicket)

// Background job steps: called only by this server (signed), to continue a job in a fresh call.
app.post('/api/internal/jobs/:id/run', (req, res) => {
  if (!validRunSignature(req.params.id, String(req.headers['x-gapwise-job'] ?? ''))) { res.status(403).json({ error: 'Forbidden' }); return }
  keepAlive(runStep(req.params.id))
  res.status(202).json({ accepted: true })
})

// Deployed MVP sites are public so leads can open them.
app.get(['/api/site/:slug', '/:slug'], serveSite)

// Everything else under /api needs a signed-in admin or user.
app.use('/api', requireAuth)

// Keys and user accounts are managed by the admin only.
app.use(['/api/settings', '/api/users'], requireAdmin)

// Users reach Graph8 and Claude only when the admin has switched that key on for them.
const needsGraph8 = requirePermission('graph8')
app.use(['/api/search', '/api/leads/discover', '/api/leads/enrich', '/api/g8'], needsGraph8)
app.use('/api/mvp', requirePermission('claude'))

// Secrets are write-only: the API accepts them but only ever reports whether they are set.
const SECRET_ROUTES: Record<string, SecretName> = { graph8: 'graph8ApiKey', claude: 'claudeToken', gemini: 'geminiApiKey', resend: 'resendApiKey' }

app.get('/api/settings', async (_req, res) => {
  try {
    const db = await getDb()
    res.json({ database: { connected: true, name: db.databaseName }, ...(await secretStatus()) })
  } catch (err: any) {
    console.error('[settings]', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.put('/api/settings/:name', async (req, res) => {
  const name = SECRET_ROUTES[req.params.name]
  const value = typeof req.body?.value === 'string' ? req.body.value.trim() : ''
  if (!name) { res.status(404).json({ error: 'Unknown setting' }); return }
  if (value.length < 20 || value.length > 4096 || /\s/.test(value)) {
    res.status(400).json({ error: 'That does not look like a valid key or token.' })
    return
  }
  try {
    await setSecret(name, value)
    res.json(await secretStatus())
  } catch (err: any) {
    console.error('[settings] save failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.delete('/api/settings/:name', async (req, res) => {
  const name = SECRET_ROUTES[req.params.name]
  if (!name) { res.status(404).json({ error: 'Unknown setting' }); return }
  try {
    await deleteSecret(name)
    res.json(await secretStatus())
  } catch (err: any) {
    console.error('[settings] delete failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

// Workspace-wide access: e.g. let every user use Graph8 regardless of their own switch.
// Admin: check the Gemini key with one plain and one web-search request, and report Google's answer.
app.post('/api/settings-test/gemini', requireAdmin, async (_req, res) => {
  try {
    res.json(await testGemini())
  } catch (err: any) {
    res.status(502).json({ error: err.message })
  }
})

// Admin: which Gemini model to use. Empty means automatic (cheapest available, with fallback).
app.get('/api/settings-model/gemini', requireAdmin, async (_req, res) => {
  try {
    const [choice, list] = await Promise.all([getGeminiModel(), listGeminiModels()])
    res.json({ order: choice.models, strict: choice.strict, inUse: modelInUse(), ...list })
  } catch (err: any) {
    console.error('[settings] model list failed:', err.message)
    res.status(502).json({ error: 'Could not load the model list.' })
  }
})

app.put('/api/settings-model/gemini', requireAdmin, async (req, res) => {
  const raw: unknown[] = Array.isArray(req.body?.models) ? req.body.models : []
  const models = [...new Set(raw.filter((m): m is string => typeof m === 'string').map(m => m.trim()).filter(Boolean))]
  if (models.length > 10) { res.status(400).json({ error: 'Choose at most 10 models.' }); return }
  if (models.some(m => !/^[a-z0-9][a-z0-9.\-]{2,80}$/.test(m))) { res.status(400).json({ error: 'One of the model names is not valid.' }); return }
  const strict = models.length > 0 && req.body?.strict === true
  try {
    await setGeminiModel({ models, strict })
    resetModelChoice()
    res.json({ order: models, strict })
  } catch (err: any) {
    console.error('[settings] model save failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.get('/api/users/access', async (_req, res) => {
  try {
    res.json(await getWorkspaceAccess())
  } catch (err: any) {
    console.error('[users] access read failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.put('/api/users/access', async (req, res) => {
  const { graph8ForEveryone, geminiForEveryone, claudeForEveryone } = req.body ?? {}
  const valid = (v: unknown) => v === undefined || typeof v === 'boolean'
  if (![graph8ForEveryone, geminiForEveryone, claudeForEveryone].every(valid)
    || [graph8ForEveryone, geminiForEveryone, claudeForEveryone].every(v => v === undefined)) {
    res.status(400).json({ error: 'Send graph8ForEveryone, geminiForEveryone and/or claudeForEveryone as true or false' })
    return
  }
  try {
    res.json(await setWorkspaceAccess({ graph8ForEveryone, geminiForEveryone, claudeForEveryone }))
  } catch (err: any) {
    console.error('[users] access update failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.get('/api/users', async (_req, res) => {
  try {
    res.json({ users: await listUsers() })
  } catch (err: any) {
    console.error('[users] list failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.post('/api/users', async (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const invalid = validateUsername(username) ?? validatePassword(req.body?.password)
  if (invalid) { res.status(400).json({ error: invalid }); return }
  try {
    res.json({ user: await createUser(username, req.body.password, parsePermissions(req.body?.permissions)) })
  } catch (err: any) {
    if (err.code === 11000) { res.status(409).json({ error: 'That username is taken.' }); return }
    console.error('[users] create failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.patch('/api/users/:id', async (req, res) => {
  const { permissions, disabled, password } = req.body ?? {}
  if (password !== undefined) {
    const invalid = validatePassword(password)
    if (invalid) { res.status(400).json({ error: invalid }); return }
  }
  try {
    const user = await updateUser(req.params.id, { permissions, disabled, password })
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    res.json({ user })
  } catch (err: any) {
    console.error('[users] update failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

app.delete('/api/users/:id', async (req, res) => {
  try {
    if (!(await deleteUser(req.params.id))) { res.status(404).json({ error: 'User not found' }); return }
    await Promise.all([deleteSearchesFor(req.params.id), deleteCampaignsFor(req.params.id), deleteTicketsFor(req.params.id), deleteJobsFor(req.params.id), deleteEmailsFor(req.params.id), deleteAuditsFor(req.params.id)])
    res.json({ deleted: true })
  } catch (err: any) {
    console.error('[users] delete failed:', err.message)
    res.status(503).json({ error: settingsError(err) })
  }
})

function settingsError(err: Error) {
  if (/MONGODB_URI|GAPWISE_SECRET/.test(err.message)) return err.message
  return 'Could not reach the database. Check MONGODB_URI.'
}

// Suggestions come straight from Graph8 so users can only pick values its search accepts.
app.get('/api/search/suggest', async (req, res) => {
  const { kind, q = '' } = req.query as Record<string, string>
  if (q.trim().length < 2) { res.json({ suggestions: [] }); return }
  try {
    if (kind === 'industry') {
      const s = await autocomplete('industry', q.trim(), 8)
      res.json({ suggestions: s.map(x => ({ ...x, field: 'industry' })) })
      return
    }
    const [countries, states, cities] = await Promise.all(
      (['country', 'state', 'city'] as const).map(f =>
        autocomplete(f, q.trim(), 4).then(s => s.map(x => ({ ...x, field: f }))).catch(() => []))
    )
    res.json({ suggestions: [...countries, ...states, ...cities].filter(s => s.value) })
  } catch (err: any) {
    console.error('[suggest]', err.message)
    res.json({ suggestions: [] })
  }
})

let filterOptionsCache: Awaited<ReturnType<typeof getFilterOptions>> | null = null
app.get('/api/search/options', async (_req, res) => {
  try {
    filterOptionsCache ??= await getFilterOptions(['employee_count', 'revenue'])
    res.json(filterOptionsCache)
  } catch (err: any) {
    console.error('[options]', err.message)
    res.json({ employee_count: [], revenue: [] })
  }
})

type LocField = 'city' | 'country' | 'state'
interface DiscoverBody {
  prompt?: string
  industries?: string[]
  locations?: Array<{ value: string; field?: LocField }>
  keywords?: string[]
  employees?: string[]
  revenue?: string[]
  foundedFrom?: number
  foundedTo?: number
  website?: 'any' | 'has' | 'none'
  hasPhone?: boolean
  limit?: number
  page?: number
  // false for searches the app runs on its own (e.g. the first load), so only real queries are saved.
  save?: boolean
  // Files the search, and the leads it finds, under this campaign.
  campaignId?: string
}

// "Food in Pakistan" -> industry "Food", location "Pakistan"
function parsePrompt(prompt = '') {
  const m = prompt.trim().match(/^(.+?)\s+(?:in|near|at|from)\s+(.+)$/i)
  if (m) return { industry: m[1].trim(), location: m[2].trim() }
  return { industry: prompt.trim(), location: '' }
}

function buildCompanyFilters(b: DiscoverBody, industryField: 'industry' | 'description' | 'name', untypedLocField: LocField) {
  const f: SearchFilter[] = []
  const industries = (b.industries ?? []).map(s => s.trim()).filter(Boolean)
  if (industries.length) {
    // "Dentists" -> "Dent" so the name fallback also matches "Dental Clinic".
    const values = industryField === 'name'
      ? industries.map(s => s.split(',')[0].trim().replace(/(ists|ist|s)$/i, ''))
      : industries
    f.push({ field: industryField, operator: 'contains', value: values })
  }
  const byField: Record<LocField, string[]> = { city: [], country: [], state: [] }
  for (const l of b.locations ?? []) {
    if (l.value?.trim()) byField[l.field ?? untypedLocField].push(l.value.trim())
  }
  for (const field of ['city', 'state', 'country'] as LocField[]) {
    if (byField[field].length) f.push({ field, operator: 'contains', value: byField[field] })
  }
  const keywords = (b.keywords ?? []).map(s => s.trim()).filter(Boolean)
  if (keywords.length) f.push({ field: 'description', operator: 'contains', value: keywords })
  if (b.employees?.length) f.push({ field: 'employee_count', operator: 'any_of', value: b.employees })
  if (b.revenue?.length) f.push({ field: 'revenue', operator: 'any_of', value: b.revenue })
  if (b.foundedFrom || b.foundedTo) {
    f.push({ field: 'founded_year', operator: 'between', value: [String(b.foundedFrom || 1800), String(b.foundedTo || 2100)] })
  }
  if (b.website === 'has') f.push({ field: 'website', operator: 'is_not_empty', value: [] })
  if (b.website === 'none') f.push({ field: 'website', operator: 'is_empty', value: [] })
  if (b.hasPhone) f.push({ field: 'phone', operator: 'is_not_empty', value: [] })
  return f
}

// Free-typed places are ambiguous ("Pakistan" also appears in some city fields, "Lahore Division"
// is a state), so ask Graph8 which field holds the value and prefer an exact, most-common match.
async function resolveLocation(value: string): Promise<{ value: string; field: LocField }> {
  const hits = (await Promise.all((['country', 'state', 'city'] as const).map(f =>
    autocomplete(f, value, 5).then(s => s.map(x => ({ ...x, field: f }))).catch(() => []))
  )).flat()
  const v = value.toLowerCase()
  const exact = hits.filter(h => h.value.toLowerCase() === v).sort((a, b) => b.count - a.count)[0]
  const best = exact ?? hits.sort((a, b) => b.count - a.count)[0]
  return best ? { value: best.value, field: best.field } : { value, field: 'city' }
}

// Only the known filter fields are stored, never the raw request body.
function savedFilters(b: DiscoverBody) {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 50) : [])
  return {
    industries: strings(b.industries),
    locations: (Array.isArray(b.locations) ? b.locations : [])
      .filter(l => typeof l?.value === 'string')
      .slice(0, 50)
      .map(l => ({ value: l.value, ...(l.field && ['city', 'country', 'state'].includes(l.field) ? { field: l.field } : {}) })),
    keywords: strings(b.keywords),
    employees: strings(b.employees),
    revenue: strings(b.revenue),
    foundedFrom: typeof b.foundedFrom === 'number' ? b.foundedFrom : undefined,
    foundedTo: typeof b.foundedTo === 'number' ? b.foundedTo : undefined,
    website: b.website === 'has' || b.website === 'none' ? b.website : 'any',
    hasPhone: b.hasPhone === true,
    limit: typeof b.limit === 'number' ? b.limit : 20,
  }
}

// Pipeline step 1: fetch real leads from Graph8, then step 2: run our gap analysis on each.
app.post('/api/leads/discover', async (req, res) => {
  const { save = true, campaignId: campaignParam, ...asked } = (req.body ?? {}) as DiscoverBody
  const body: DiscoverBody = { ...asked }
  let campaignId: ObjectId | null = null
  if (campaignParam) {
    campaignId = await campaignIdFor(getAuth(res), campaignParam).catch(() => null)
    if (!campaignId) { res.status(404).json({ error: 'That campaign no longer exists.' }); return }
  }
  if (body.prompt?.trim()) {
    const p = parsePrompt(body.prompt)
    if (p.industry) body.industries = [...(body.industries ?? []), p.industry]
    if (p.location) body.locations = [...(body.locations ?? []), { value: p.location }]
  }
  const limit = Math.min(Math.max(body.limit || 20, 1), 100)
  const page = body.page || 1
  const industryModes: Array<'industry' | 'description' | 'name'> = body.industries?.length ? ['industry', 'description', 'name'] : ['industry']

  try {
    body.locations = await Promise.all((body.locations ?? []).map(l => (l.field ? l : resolveLocation(l.value))))

    // Industry labels are rigid ("SaaS" isn't one), so when the label match is thin,
    // also try the company description and name and keep whichever finds the most.
    const FEW = 5
    let companyRes: Awaited<ReturnType<typeof searchCompaniesByFilters>> = { data: [], pagination: { total: 0, has_next: false } }
    let matchedOn: { industry: string; locations: DiscoverBody['locations'] } | null = null
    for (const im of industryModes) {
      const r = await searchCompaniesByFilters(buildCompanyFilters(body, im, 'city'), limit, page)
      if (r.pagination.total > companyRes.pagination.total) {
        companyRes = r
        matchedOn = { industry: im, locations: body.locations }
      }
      if (companyRes.pagination.total >= FEW) break
    }
    const companies = companyRes.data.filter(c => c.name?.trim())

    const contactRes = await searchContactsByDomains(companies.map(c => c.domain).filter(Boolean)).catch(err => {
      console.error('[discover] contact lookup failed:', err.message)
      return { data: [] as Awaited<ReturnType<typeof searchContactsByDomains>>['data'] }
    })
    const contactByDomain = new Map<string, (typeof contactRes.data)[number]>()
    for (const c of contactRes.data) {
      const prev = contactByDomain.get(c.company_domain)
      if (!prev || rankContact(c) > rankContact(prev)) contactByDomain.set(c.company_domain, c)
    }

    const leads: LeadWithAnalysis[] = companies.map(company => {
      const contact = company.domain ? contactByDomain.get(company.domain) ?? null : null
      return transformToLead(contact, company, analyzeWebsite(company.domain || `${company.name}|${company.city}`, !company.domain))
    })

    // Every search the person runs belongs to a campaign: outside one, file it under a matching campaign,
    // creating it if needed. (The app's own first-load search, save=false, is not stored.)
    let assigned: Awaited<ReturnType<typeof campaignForSearch>>['campaign'] | null = null
    let createdCampaign = false
    if (save && !campaignId) {
      const target = {
        industries: (body.industries ?? []).map(s => s.trim()).filter(Boolean).slice(0, 20),
        locations: (body.locations ?? []).filter(l => l.value?.trim()).slice(0, 20)
          .map(l => ({ value: l.value.trim(), ...(l.field ? { field: l.field } : {}) })),
      }
      const auto = await campaignForSearch(getAuth(res), target, asked.prompt?.trim() ?? '')
        .catch(err => { console.error('[campaigns] auto campaign failed:', err.message); return null })
      if (auto) { campaignId = auto.id; assigned = auto.campaign; createdCampaign = auto.created }
    }

    // History is a convenience: a failed save must not lose the search the user just paid for.
    const searchId = save || campaignId
      ? await saveSearch(getAuth(res), {
          prompt: asked.prompt?.trim() ?? '',
          filters: savedFilters(asked),
          matchedOn,
          total: companyRes.pagination.total,
          leads,
          campaignId,
        }).catch(err => { console.error('[history] save failed:', err.message); return null })
      : null
    if (campaignId) {
      await saveCampaignLeads(campaignId, leads, searchId).catch(err => console.error('[campaigns] saving leads failed:', err.message))
    }

    res.json({
      leads,
      searchId,
      // The campaign this search was filed under automatically, if it was made outside one.
      campaign: assigned,
      createdCampaign,
      source: 'graph8',
      total: companyRes.pagination.total,
      hasMore: companyRes.pagination.has_next,
      matchedOn,
    })
  } catch (err: any) {
    console.error('[discover] Graph8 search failed:', err.message)
    const missingKey = /not configured/.test(err.message)
    res.status(missingKey ? 400 : 502).json({
      error: missingKey ? err.message : 'Lead search failed. Check the server log for the Graph8 response.',
      leads: [],
    })
  }
})

function rankContact(c: { seniority_level?: string; job_title?: string; confidence_score?: number }) {
  const t = `${c.seniority_level} ${c.job_title}`.toLowerCase()
  const seniority = /owner|founder|ceo|president|principal|partner/.test(t) ? 100
    : /director|manager|c_suite|vp/.test(t) ? 50 : 0
  return seniority + (c.confidence_score ?? 0) / 10
}

// Pipeline step 2: enrich one lead on demand (company + decision maker + verified email).
// Cached per lead so reopening a lead doesn't spend lookups again.
const enrichCache = new Map<string, unknown>()
const MAX_EMAIL_VERIFICATIONS = 3

app.post('/api/leads/enrich', async (req, res) => {
  const { domain, firstName, lastName, linkedin } = req.body as Record<string, string | undefined>
  if (!domain && !linkedin) { res.status(400).json({ error: 'domain or linkedin required' }); return }
  const key = `${domain}|${linkedin || `${firstName} ${lastName}`}`.toLowerCase()
  if (enrichCache.has(key)) { res.json(enrichCache.get(key)); return }

  try {
    const personQuery = linkedin
      ? { linkedin_url: linkedin }
      : firstName && domain ? { first_name: firstName, last_name: lastName, company_domain: domain } : null

    const [company, person] = await Promise.all([
      domain ? lookupCompany(domain).catch(() => null) : null,
      personQuery ? lookupPerson(personQuery).catch(() => null) : null,
    ])
    const c = company?.found ? company.data ?? {} : {}
    const p = person?.found ? person.data ?? {} : {}

    // Lookup emails are pattern matches; only keep one the mailbox server confirms.
    const candidates = [p.work_email, ...String(p.additional_work_emails || '').split(',')]
      .map((e: string | undefined) => (e || '').trim().toLowerCase())
      .filter((e, i, arr) => e.includes('@') && e !== '***' && arr.indexOf(e) === i)
      .slice(0, MAX_EMAIL_VERIFICATIONS)
    const checked: Array<{ email: string; status: string; valid: boolean }> = []
    let verifiedEmail = ''
    for (const email of candidates) {
      const v = await verifyEmail(email).catch(() => null)
      if (!v) continue
      checked.push({ email, status: v.sub_status || v.status, valid: v.is_valid })
      if (v.is_valid) { verifiedEmail = email; break }
    }

    const result = {
      found: { company: !!company?.found, person: !!person?.found },
      company: company?.found ? {
        phone: c.phone || '',
        address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
        revenue: c.revenue || '',
        employees: c.employee_count || '',
        description: c.description || '',
        industry: c.industry || '',
        linkedin: c.linkedin_url || '',
        facebook: c.facebook_url || '',
      } : null,
      person: person?.found ? {
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        title: p.job_title || '',
        seniority: p.seniority_level || '',
        linkedin: p.linkedin_url || '',
        phone: [p.direct_phone, p.mobile_phone].find((x: string) => x && x !== '***') || '',
        education: p.education_university_name || '',
      } : null,
      email: {
        address: verifiedEmail,
        verified: !!verifiedEmail,
        bestGuess: verifiedEmail || candidates[0] || '',
        checked,
      },
    }
    enrichCache.set(key, result)
    res.json(result)
  } catch (err: any) {
    console.error('[enrich]', err.message)
    res.status(502).json({ error: 'Enrichment failed' })
  }
})

// Saved searches. Reading them needs no Graph8 access: the results are already stored.
app.get('/api/searches', async (_req, res) => {
  try {
    res.json({ searches: await listSearches(getAuth(res)) })
  } catch (err: any) {
    console.error('[history] list failed:', err.message)
    res.status(503).json({ error: 'Could not load your search history.' })
  }
})

app.get('/api/searches/:id', async (req, res) => {
  try {
    const search = await getSearch(getAuth(res), req.params.id)
    if (!search) { res.status(404).json({ error: 'Search not found' }); return }
    res.json({ search })
  } catch (err: any) {
    console.error('[history] read failed:', err.message)
    res.status(503).json({ error: 'Could not load that search.' })
  }
})

app.delete('/api/searches/:id', async (req, res) => {
  try {
    if (!(await deleteSearch(getAuth(res), req.params.id))) { res.status(404).json({ error: 'Search not found' }); return }
    res.json({ deleted: true })
  } catch (err: any) {
    console.error('[history] delete failed:', err.message)
    res.status(503).json({ error: 'Could not delete that search.' })
  }
})

// Campaigns group searches and keep the leads they find. Reading them needs no Graph8 access.
app.get('/api/campaigns', async (_req, res) => {
  try {
    res.json({ campaigns: await listCampaigns(getAuth(res)) })
  } catch (err: any) {
    console.error('[campaigns] list failed:', err.message)
    res.status(503).json({ error: 'Could not load campaigns.' })
  }
})

app.post('/api/campaigns', async (req, res) => {
  const input = parseCampaignInput(req.body)
  if (!input.name) { res.status(400).json({ error: 'Give the campaign a name.' }); return }
  try {
    const campaign = await createCampaign(getAuth(res), input)
    if (!campaign) { res.status(400).json({ error: 'You have reached the limit of 100 campaigns. Delete one first.' }); return }
    res.json({ campaign })
  } catch (err: any) {
    console.error('[campaigns] create failed:', err.message)
    res.status(503).json({ error: 'Could not create the campaign.' })
  }
})

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const found = await getCampaign(getAuth(res), req.params.id)
    if (!found) { res.status(404).json({ error: 'Campaign not found' }); return }
    const searches = await listSearches(getAuth(res), new ObjectId(req.params.id))
    res.json({ ...found, searches })
  } catch (err: any) {
    console.error('[campaigns] read failed:', err.message)
    res.status(503).json({ error: 'Could not load the campaign.' })
  }
})

app.patch('/api/campaigns/:id', async (req, res) => {
  const input = parseCampaignInput(req.body)
  if (!input.name) { res.status(400).json({ error: 'Give the campaign a name.' }); return }
  try {
    const campaign = await updateCampaign(getAuth(res), req.params.id, input)
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return }
    res.json({ campaign })
  } catch (err: any) {
    console.error('[campaigns] update failed:', err.message)
    res.status(503).json({ error: 'Could not save the campaign.' })
  }
})

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    if (!(await deleteCampaign(getAuth(res), req.params.id))) { res.status(404).json({ error: 'Campaign not found' }); return }
    res.json({ deleted: true })
  } catch (err: any) {
    console.error('[campaigns] delete failed:', err.message)
    res.status(503).json({ error: 'Could not delete the campaign.' })
  }
})

// Saves a lead's latest state (e.g. after enrichment) inside the campaign.
app.put('/api/campaigns/:id/leads', async (req, res) => {
  const lead = req.body?.lead
  if (!lead || typeof lead !== 'object' || typeof lead.id !== 'string') { res.status(400).json({ error: 'lead required' }); return }
  try {
    if (!(await updateCampaignLead(getAuth(res), req.params.id, lead))) { res.status(404).json({ error: 'Lead not in this campaign' }); return }
    res.json({ saved: true })
  } catch (err: any) {
    console.error('[campaigns] lead update failed:', err.message)
    res.status(503).json({ error: 'Could not save the lead.' })
  }
})

app.delete('/api/campaigns/:id/leads/:leadId', async (req, res) => {
  try {
    if (!(await removeCampaignLead(getAuth(res), req.params.id, req.params.leadId))) { res.status(404).json({ error: 'Lead not found' }); return }
    res.json({ deleted: true })
  } catch (err: any) {
    console.error('[campaigns] lead delete failed:', err.message)
    res.status(503).json({ error: 'Could not remove the lead.' })
  }
})

// Campaign analysis: the target market from Graph8 (size, gaps, breakdowns) plus what the campaign has saved.
// Reading it is free; refreshing the market numbers calls Graph8, so it needs Graph8 access.
const BREAKDOWN_FIELDS = ['employee_count', 'revenue', 'city', 'industry']

async function computeMarket(target: CampaignTarget, username: string): Promise<MarketAnalysis> {
  const locations = await Promise.all(target.locations.map(l => (l.field ? { value: l.value, field: l.field } : resolveLocation(l.value))))
  const body: DiscoverBody = { industries: target.industries, locations }
  const modes: Array<'industry' | 'description'> = target.industries.length ? ['industry', 'description'] : ['industry']
  // Same fallback as Discover: rigid industry labels can miss, so also try the description.
  let best: { mode: 'industry' | 'description'; filters: SearchFilter[]; total: number } | null = null
  for (const mode of modes) {
    const filters = buildCompanyFilters(body, mode, 'city')
    const total = (await searchCompaniesByFilters(filters, 1)).pagination.total
    if (!best || total > best.total) best = { mode, filters, total }
    if (best.total >= 5) break
  }
  const { mode, filters, total } = best!
  const count = (...extra: SearchFilter[]) => searchCompaniesByFilters([...filters, ...extra], 1).then(r => r.pagination.total)
  // Optional signals: a field Graph8 does not support gives null instead of failing the whole analysis.
  const maybe = (p: Promise<number>) => p.catch(err => { console.error('[analysis] signal skipped:', err.message); return null })
  const year = new Date().getFullYear()
  const [noWebsite, withPhone, breakdowns, reachableNoWebsite, newBusinesses, sample] = await Promise.all([
    count({ field: 'website', operator: 'is_empty', value: [] }),
    count({ field: 'phone', operator: 'is_not_empty', value: [] }),
    getFilteredFilterOptions(filters, BREAKDOWN_FIELDS, 10).catch(err => {
      console.error('[analysis] breakdowns failed:', err.message)
      return {} as MarketAnalysis['breakdowns']
    }),
    maybe(count({ field: 'website', operator: 'is_empty', value: [] }, { field: 'phone', operator: 'is_not_empty', value: [] })),
    maybe(count({ field: 'founded_year', operator: 'between', value: [String(year - 3), String(year)] })),
    sampleMarket(filters).catch(err => { console.error('[analysis] sample skipped:', err.message); return null }),
  ])
  return {
    filtersUsed: { industryField: mode, industries: target.industries, locations },
    total, noWebsite, withPhone, breakdowns,
    insights: { reachableNoWebsite, newBusinesses, sample },
    computedAt: new Date(),
    computedBy: username,
  }
}

// Up to 100 of the market's businesses and their contacts: how many have a decision maker, an email,
// social profiles and a phone. Uses the same company and contact searches as Discover.
async function sampleMarket(filters: SearchFilter[]) {
  const companies = (await searchCompaniesByFilters(filters, 100)).data.filter((c: G8Company) => c.name?.trim())
  if (!companies.length) return null
  const domains = companies.map(c => c.domain).filter(Boolean)
  const contacts = domains.length ? (await searchContactsByDomains(domains, 100).catch(() => ({ data: [] }))).data : []
  const senior = /owner|founder|ceo|president|principal|partner|director|manager|c_suite|vp|head/i
  const withDm = new Set(contacts.filter(c => senior.test(`${c.seniority_level} ${c.job_title}`)).map(c => c.company_domain))
  const withEmail = new Set(contacts.filter(c => c.work_email && c.work_email.trim()).map(c => c.company_domain))
  const has = (v?: string) => !!v && !!v.trim()
  return {
    size: companies.length,
    withLinkedin: companies.filter(c => has(c.linkedin_url)).length,
    withFacebook: companies.filter(c => has(c.facebook_url)).length,
    withPhone: companies.filter(c => has(c.phone)).length,
    noWebsite: companies.filter(c => !has(c.domain) && !has(c.website)).length,
    withDecisionMaker: companies.filter(c => c.domain && withDm.has(c.domain)).length,
    withEmail: companies.filter(c => c.domain && withEmail.has(c.domain)).length,
  }
}

function leadStats(leads: Array<Record<string, any>>) {
  const gapCounts = new Map<string, number>()
  for (const l of leads) for (const g of l.gaps ?? []) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1)
  return {
    saved: leads.length,
    noWebsite: leads.filter(l => !l.site).length,
    enriched: leads.filter(l => l.enrichment).length,
    verifiedEmail: leads.filter(l => l.enrichment?.email?.verified).length,
    scores: {
      poor: leads.filter(l => l.score < 40).length,
      fair: leads.filter(l => l.score >= 40 && l.score < 70).length,
      good: leads.filter(l => l.score >= 70).length,
    },
    topGaps: [...gapCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })),
  }
}

async function campaignAnalysis(res: Response, id: string) {
  const found = await getCampaign(getAuth(res), id)
  if (!found) return null
  const [market, searches] = await Promise.all([getMarketAnalysis(id), listSearches(getAuth(res), new ObjectId(id))])
  return { campaign: found.campaign, market, leads: leadStats(found.leads), searchCount: searches.length }
}

app.get('/api/campaigns/:id/analysis', async (req, res) => {
  try {
    const analysis = await campaignAnalysis(res, req.params.id)
    if (!analysis) { res.status(404).json({ error: 'Campaign not found' }); return }
    res.json(analysis)
  } catch (err: any) {
    console.error('[analysis] read failed:', err.message)
    res.status(503).json({ error: 'Could not load the analysis.' })
  }
})

app.post('/api/campaigns/:id/analysis', needsGraph8, async (req, res) => {
  try {
    const found = await getCampaign(getAuth(res), req.params.id)
    if (!found) { res.status(404).json({ error: 'Campaign not found' }); return }
    const { target } = found.campaign
    if (!target.industries.length && !target.locations.length) {
      res.status(400).json({ error: 'Add target industries or locations to this campaign first. The analysis describes that market.' })
      return
    }
    await saveMarketAnalysis(req.params.id, await computeMarket(target, getAuth(res).username))
    res.json(await campaignAnalysis(res, req.params.id))
  } catch (err: any) {
    console.error('[analysis] refresh failed:', err.message)
    const missingKey = /not configured/.test(err.message)
    res.status(missingKey ? 400 : 502).json({ error: missingKey ? err.message : 'Graph8 could not analyse this market right now. Try again shortly.' })
  }
})

// Gap analysis: Graph8's record plus Gemini web research per saved campaign lead.
app.get('/api/campaigns/:id/gaps', async (req, res) => {
  try {
    const campaignId = await campaignIdFor(getAuth(res), req.params.id)
    if (!campaignId) { res.status(404).json({ error: 'Campaign not found' }); return }
    res.json({ analyses: await listGapAnalyses(campaignId) })
  } catch (err: any) {
    console.error('[gaps] list failed:', err.message)
    res.status(503).json({ error: 'Could not load gap analyses.' })
  }
})

// Streams newline-delimited JSON: a `stage` event as each step starts, then `done` with the analysis
// (or `error`). Problems found before streaming starts still come back as a normal JSON error.
app.post('/api/campaigns/:id/gaps/:leadId', requirePermission('gemini'), async (req, res) => {
  let found: Awaited<ReturnType<typeof getCampaignLead>>
  try {
    found = await getCampaignLead(getAuth(res), req.params.id, req.params.leadId)
  } catch (err: any) {
    console.error('[gaps] lead lookup failed:', err.message)
    res.status(503).json({ error: 'Could not load that lead.' })
    return
  }
  if (!found) { res.status(404).json({ error: 'Lead not found in this campaign' }); return }

  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const send = (event: Record<string, unknown>) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`) }
  // Keeps the connection visibly alive through the long web-research step. If the person closes the tab,
  // the run still finishes and is saved; only the progress updates stop.
  const heartbeat = setInterval(() => send({ type: 'tick' }), 5000)
  try {
    const analysis = await runGapAnalysis(getAuth(res), found.campaignId, found.lead, stage => send({ type: 'stage', stage }))
    send({ type: 'done', analysis })
  } catch (err: any) {
    if (err instanceof GeminiError) {
      // The admin also gets Google's own reason, so a key or quota problem can be fixed.
      const detail = getAuth(res).role === 'admin' && err.detail ? ` Details: ${err.detail}` : ''
      send({ type: 'error', error: err.message + detail, status: err.status })
    }
    else {
      console.error('[gaps] run failed:', err.message)
      send({ type: 'error', error: 'The gap analysis failed. Try again shortly.', status: 502 })
    }
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// In-app help assistant, open to every signed-in person (rate-limited per person).
app.post('/api/assistant/chat', assistantChat)

// Human support requests: users see their own, the admin sees and answers all of them.
app.get('/api/support/summary', supportSummary)
app.get('/api/support/tickets', listTickets)
app.post('/api/support/tickets', createTicket)
app.get('/api/support/tickets/:id', getTicket)
app.post('/api/support/tickets/:id/replies', replyToTicket)
app.patch('/api/support/tickets/:id', setTicketStatus)

// Lead temperature: every saved lead scored from the evidence Gapwise has, so the hottest get worked first.
//   fit (gap analysis)           up to 50 points (fit / 2)
//   verified email               20   · named decision maker 10 · phone 5
//   no website                   15   · otherwise a weak site (health < 40) 10, fair (40-69) 5
// Hot 55+, warm 30-54, cold below 30.
type Temp = 'hot' | 'warm' | 'cold'
function scoreLead(lead: Record<string, any>, fit: number | null) {
  const e = lead.enrichment
  const reasons: string[] = []
  let points = 0
  if (fit !== null) { points += fit / 2; reasons.push(`fit ${fit}`) }
  if (e?.email?.verified) { points += 20; reasons.push('verified email') }
  if (e?.person?.name) { points += 10; reasons.push('decision maker known') }
  if (e?.company?.phone || e?.person?.phone) { points += 5; reasons.push('phone') }
  if (!lead.site) { points += 15; reasons.push('no website') }
  else if (lead.score < 40) { points += 10; reasons.push(`weak site (${lead.score})`) }
  else if (lead.score < 70) { points += 5; reasons.push(`site ${lead.score}`) }
  const temp: Temp = points >= 55 ? 'hot' : points >= 30 ? 'warm' : 'cold'
  return { points: Math.round(points), temp, reasons }
}

async function leadTemperature(campaigns: Array<{ id: string; name: string }>) {
  const ids = campaigns.map(c => new ObjectId(c.id))
  const [saved, fits] = await Promise.all([leadsForCampaigns(ids), fitsFor(ids)])
  const names = new Map(campaigns.map(c => [c.id, c.name]))
  const counts = { hot: 0, warm: 0, cold: 0 }
  const offers = new Map<string, number>()
  for (const g of fits.values()) if (g.offer) offers.set(g.offer, (offers.get(g.offer) ?? 0) + 1)
  const byCampaign = new Map<string, { hot: number; warm: number; cold: number }>()
  let notAnalysed = 0
  let notEnriched = 0
  const scored = saved.map(({ campaignId, lead }) => {
    const g = fits.get(`${campaignId}:${lead.id}`)
    if (!g) notAnalysed++
    if (!lead.enrichment) notEnriched++
    const s = scoreLead(lead, g ? g.fit : null)
    counts[s.temp]++
    const c = byCampaign.get(campaignId) ?? { hot: 0, warm: 0, cold: 0 }
    c[s.temp]++
    byCampaign.set(campaignId, c)
    return { campaignId, campaignName: names.get(campaignId) ?? '', leadId: String(lead.id), name: String(lead.name ?? ''), city: String(lead.city ?? ''), offer: g?.offer ?? '', ...s }
  })
  return {
    total: saved.length,
    ...counts,
    notAnalysed,
    notEnriched,
    byCampaign: [...byCampaign].map(([id, c]) => ({ id, name: names.get(id) ?? '', ...c }))
      .sort((a, b) => b.hot - a.hot || b.warm - a.warm).slice(0, 6),
    hottest: scored.filter(s => s.temp !== 'cold').sort((a, b) => b.points - a.points).slice(0, 8),
    // What gap analysis recommends across these leads, most common first.
    offers: [...offers].sort((a, b) => b[1] - a[1]).map(([offer, count]) => ({ offer, count })),
  }
}

// Dashboard: one read that summarises everything this person can see (the admin sees the whole workspace).
app.get('/api/dashboard', async (_req, res) => {
  const auth = getAuth(res)
  try {
    const campaigns = await listCampaigns(auth)
    const ids = campaigns.map(c => new ObjectId(c.id))
    const names = new Map(campaigns.map(c => [c.id, c.name]))
    const siteCol = await sites()
    const [searchCount, searches, gaps, siteCount, recentSites, keys, temperature] = await Promise.all([
      countSearches(auth),
      listSearches(auth),
      gapStatsFor(ids),
      siteCol.countDocuments({}),
      siteCol.find({}, { projection: { html: 0 } }).sort({ updatedAt: -1 }).limit(5).toArray(),
      auth.role === 'admin' ? secretStatus() : Promise.resolve(null),
      leadTemperature(campaigns).catch(err => { console.error('[dashboard] temperature failed:', err.message); return null }),
    ])
    const [weekly, mvpsBuilt] = await Promise.all([
      leadsPerWeek(campaigns.map(c => new ObjectId(c.id))).catch(() => []),
      countBuiltMvps(auth).catch(() => 0),
    ])
    res.json({
      scope: auth.role === 'admin' ? 'workspace' : 'mine',
      totals: {
        campaigns: campaigns.length,
        leads: campaigns.reduce((n, c) => n + c.leadCount, 0),
        searches: searchCount,
        gapAnalyses: gaps.count,
        sites: siteCount,
      },
      campaigns: campaigns.slice(0, 5).map(c => ({
        id: c.id, name: c.name, target: c.target, leadCount: c.leadCount, searchCount: c.searchCount,
        lastSearchAt: c.lastSearchAt, username: c.username, mine: c.mine,
      })),
      topProspects: gaps.top.map(p => ({ ...p, campaignName: names.get(p.campaignId) ?? '' })),
      recentSearches: searches.slice(0, 5).map(s => ({
        id: s.id, prompt: s.prompt, filters: s.filters, leadCount: s.leadCount, total: s.total,
        createdAt: s.createdAt, campaignName: s.campaignId ? names.get(s.campaignId) ?? '' : '', username: s.username, mine: s.mine,
      })),
      sites: recentSites.map(s => ({ slug: s._id, leadName: s.leadName, mvpType: s.mvpType, updatedAt: s.updatedAt })),
      keys: keys && { graph8: keys.graph8.configured, claude: keys.claude.configured, gemini: keys.gemini.configured },
      temperature,
      charts: {
        // Last 8 weeks, oldest first, including empty weeks.
        weekly: (() => {
          const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x }
          const byWeek = new Map(weekly.map(w => [monday(new Date(w.week)).getTime(), w.count]))
          const start = monday(new Date())
          return Array.from({ length: 8 }, (_, i) => {
            const d = new Date(start.getTime() - (7 - i) * 7 * 24 * 3600 * 1000)
            return { week: d.toISOString().slice(0, 10), count: byWeek.get(d.getTime()) ?? 0 }
          })
        })(),
        funnel: temperature ? [
          { stage: 'Saved leads', count: temperature.total },
          { stage: 'Enriched', count: temperature.total - temperature.notEnriched },
          { stage: 'Gap analysed', count: temperature.total - temperature.notAnalysed },
          { stage: 'MVPs built', count: mvpsBuilt },
          ...(auth.role === 'admin' ? [{ stage: 'Sites live', count: siteCount }] : []),
        ] : [],
        campaignLeads: [...campaigns].sort((a, b) => b.leadCount - a.leadCount).slice(0, 6).map(c => ({ id: c.id, name: c.name, count: c.leadCount })),
      },
    })
  } catch (err: any) {
    console.error('[dashboard]', err.message)
    res.status(503).json({ error: 'Could not load the dashboard.' })
  }
})

// Audit a specific website
app.get('/api/leads/audit', async (req, res) => {
  const canUseGraph8 = getAuth(res).permissions.graph8
  try {
    const { domain } = req.query as Record<string, string>
    if (!domain) {
      res.status(400).json({ error: 'domain parameter required' })
      return
    }

    const analysis = analyzeWebsite(domain)

    // Try to enrich from Graph8
    let companyData = null
    try {
      if (canUseGraph8) companyData = await enrichCompany(domain)
    } catch {
      // Enrichment optional
    }

    res.json({
      domain,
      analysis,
      company: companyData,
    })
  } catch (err: any) {
    console.error('Audit error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Get intent signals for a company
app.get('/api/leads/:id/intent', needsGraph8, async (req, res) => {
  try {
    const signals = await getIntentSignals(req.params.id)
    res.json(signals)
  } catch (err: any) {
    // Return mock intent signals as fallback
    res.json({
      signals: [
        { type: 'website_visit', topic: 'booking software', strength: 'high' },
        { type: 'content_engagement', topic: 'digital transformation', strength: 'medium' },
      ],
    })
  }
})

// MVPs are kept as drafts until deployed.
interface DraftDoc { html: string; leadId: string; leadName: string; mvpType: string; createdAt: Date }
interface SiteDoc { _id: string; html: string; leadId: string; leadName: string; mvpType: string; createdAt: Date; updatedAt: Date }

let draftIndexReady = false
async function drafts() {
  const col = (await getDb()).collection<DraftDoc>('mvp_drafts')
  if (!draftIndexReady) {
    await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 })
    draftIndexReady = true
  }
  return col
}
const sites = async () => (await getDb()).collection<SiteDoc>('sites')

// ── Background jobs (MVP builds, gap analysis runs) ──
// The work runs on the server whether or not anyone keeps the page open; pages start jobs and watch them.

const originOf = (req: Request) =>
  `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${String(req.headers['x-forwarded-host'] ?? req.headers.host).split(',')[0]}`

app.post('/api/jobs', async (req, res) => {
  const auth = getAuth(res)
  const kind = req.body?.kind
  try {
    if (kind === 'mvp') {
      if (!auth.permissions.claude) { res.status(403).json({ error: 'MVP generation with Claude is turned off for your account. Ask the admin to enable it.' }); return }
      const lead = req.body?.lead
      if (!lead?.name || typeof lead !== 'object') { res.status(400).json({ error: 'lead required' }); return }
      const leadId = String(lead.id ?? lead.name)
      // One build per lead at a time: starting again while one runs just returns it.
      const running = await activeJobOf(auth, 'mvp', { leadId })
      if (running) { res.json({ job: await getJob(auth, String(running._id)) }); return }
      const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId : null
      const preference = typeof req.body?.preference === 'string' ? req.body.preference : undefined
      // "Rebuild with this plan": skip straight to the builder.
      const planId = typeof req.body?.planId === 'string' ? req.body.planId : ''
      const plan = planId ? await loadPlan(auth, planId).catch(() => null) : null
      if (planId && !plan) { res.status(404).json({ error: 'That plan has expired. Plan the MVP again.' }); return }
      const job = await createJob(auth, originOf(req), {
        kind: 'mvp',
        title: `MVP for ${lead.name}`,
        leadId,
        campaignId,
        input: { lead, preference, planId: planId || undefined },
        step: plan ? 'build' : 'research',
        state: plan ? {
          planId, plan: plan.plan, images: plan.images, industry: plan.industry, research: plan.research,
          researchNote: plan.researchNote, agents: { research: plan.research ? 'done' : 'skipped', strategy: 'done', design: 'done' },
        } : { agents: {} },
      })
      res.json({ job })
      return
    }
    if (kind === 'gaps') {
      if (!auth.permissions.gemini) { res.status(403).json({ error: 'Gap analysis is turned off for your account. Ask the admin to enable it.' }); return }
      const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId : ''
      if (!(await campaignIdFor(auth, campaignId).catch(() => null))) { res.status(404).json({ error: 'Campaign not found' }); return }
      const queue = (Array.isArray(req.body?.leads) ? req.body.leads : [])
        .filter((l: any) => typeof l?.id === 'string' && l.id)
        .slice(0, 1000)
        .map((l: any) => ({ id: l.id, name: String(l.name ?? '').slice(0, 120) }))
      if (!queue.length) { res.status(400).json({ error: 'Choose at least one lead.' }); return }
      // One gap-analysis run at a time per person keeps within the research service's limits.
      const running = await activeJobOf(auth, 'gaps')
      if (running) { res.status(409).json({ error: 'A gap analysis is already running. Wait for it or stop it first.', job: await getJob(auth, String(running._id)) }); return }
      const job = await createJob(auth, originOf(req), {
        kind: 'gaps',
        title: `Gap analysis: ${String(req.body?.campaignName ?? 'campaign').slice(0, 80)}`,
        campaignId,
        input: { campaignName: String(req.body?.campaignName ?? '') },
        step: 'lead',
        state: { queue, total: queue.length, done: 0, durations: [], current: null, retry: null, lastError: '' },
      })
      res.json({ job })
      return
    }
    res.status(400).json({ error: 'Unknown job kind' })
  } catch (err: any) {
    console.error('[jobs] create failed:', err.message)
    res.status(503).json({ error: 'Could not start the job. Try again shortly.' })
  }
})

app.get('/api/jobs', async (req, res) => {
  const q = req.query as Record<string, string>
  try {
    res.json({
      jobs: await listJobs(getAuth(res), {
        kind: q.kind === 'mvp' || q.kind === 'gaps' || q.kind === 'security' ? q.kind : undefined,
        leadId: q.leadId || undefined,
        campaignId: q.campaignId || undefined,
        activeOnly: q.active === '1',
        limit: Math.min(Number(q.limit) || 20, 50),
      }),
    })
  } catch (err: any) {
    console.error('[jobs] list failed:', err.message)
    res.status(503).json({ error: 'Could not load jobs.' })
  }
})

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(getAuth(res), req.params.id)
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    res.json({ job })
  } catch (err: any) {
    console.error('[jobs] read failed:', err.message)
    res.status(503).json({ error: 'Could not load the job.' })
  }
})

app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const job = await cancelJob(getAuth(res), req.params.id)
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    res.json({ job })
  } catch (err: any) {
    console.error('[jobs] cancel failed:', err.message)
    res.status(503).json({ error: 'Could not stop the job.' })
  }
})

app.post('/api/jobs/:id/resume', async (req, res) => {
  try {
    const job = await resumeJob(getAuth(res), req.params.id, originOf(req))
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    res.json({ job })
  } catch (err: any) {
    console.error('[jobs] resume failed:', err.message)
    res.status(503).json({ error: 'Could not resume the job.' })
  }
})

// Slugs share the root path with the app, so keep ones the app itself needs.
const RESERVED_SLUGS = new Set(['api', 'assets', 'src', 'node_modules', 'public', 'index', 'settings', 'login', 'admin', 'favicon', 'robots'])

function slugify(name: string) {
  const s = name.toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '')
  return s && !RESERVED_SLUGS.has(s) ? s : `site-${s || 'mvp'}`
}

app.post('/api/sites', async (req, res) => {
  const { draftId } = req.body ?? {}
  try {
    if (!ObjectId.isValid(draftId)) { res.status(400).json({ error: 'draftId required' }); return }
    const draft = await (await drafts()).findOne({ _id: new ObjectId(draftId) })
    if (!draft) { res.status(404).json({ error: 'Draft expired. Generate the MVP again.' }); return }

    // Redeploying the same lead keeps its URL; a different business with the same name gets a suffix.
    const col = await sites()
    const base = slugify(draft.leadName)
    let slug = base
    for (let n = 2; ; n++) {
      const existing = await col.findOne({ _id: slug }, { projection: { leadId: 1 } })
      if (!existing || existing.leadId === draft.leadId) break
      slug = `${base}-${n}`
    }
    const now = new Date()
    await col.updateOne(
      { _id: slug },
      { $set: { html: draft.html, leadId: draft.leadId, leadName: draft.leadName, mvpType: draft.mvpType, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
    res.json({ slug, path: `/${slug}` })
  } catch (err: any) {
    console.error('[sites] deploy failed:', err.message)
    res.status(500).json({ error: 'Deploy failed' })
  }
})

app.get('/api/sites', async (_req, res) => {
  try {
    const list = await (await sites()).find({}, { projection: { html: 0 } }).sort({ updatedAt: -1 }).limit(100).toArray()
    res.json({ sites: list.map(s => ({ slug: s._id, leadName: s.leadName, mvpType: s.mvpType, updatedAt: s.updatedAt })) })
  } catch (err: any) {
    console.error('[sites] list failed:', err.message)
    res.status(500).json({ error: 'Could not load sites' })
  }
})

// Generated pages share this app's origin, so they are served under a CSP sandbox: the page runs with an
// opaque origin and cannot call this API with the viewer's session cookie or read anything of the app's.
async function serveSite(req: Request, res: Response, next: NextFunction) {
  const slug = String(req.params.slug || '')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || RESERVED_SLUGS.has(slug)) { next(); return }
  try {
    const site = await (await sites()).findOne({ _id: slug }, { projection: { html: 1 } })
    if (!site) { res.status(404).type('text/plain').send('Site not found'); return }
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-modals')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.type('html').send(site.html)
  } catch (err: any) {
    console.error('[sites] serve failed:', err.message)
    res.status(500).type('text/plain').send('Site temporarily unavailable')
  }
}

// Outreach: one email per lead with the deployed MVP's link, drafted here, edited by the person, sent via Resend.
async function deployedUrlFor(req: Request, leadId: string) {
  const site = await (await sites()).find({ leadId }, { projection: { _id: 1 } }).sort({ updatedAt: -1 }).limit(1).next()
  return site ? `${originOf(req)}/${site._id}` : null
}

app.get('/api/outreach', async (req, res) => {
  const auth = getAuth(res)
  const leadId = String((req.query as Record<string, string>).leadId ?? '')
  if (!leadId) { res.status(400).json({ error: 'leadId required' }); return }
  try {
    const [emails, siteUrl, email] = await Promise.all([emailsForLead(auth, leadId), deployedUrlFor(req, leadId), getEmailSettings()])
    res.json({ emails, siteUrl, sending: { ready: email.keyConfigured && !!email.from, from: email.from } })
  } catch (err: any) {
    console.error('[outreach] read failed:', err.message)
    res.status(503).json({ error: 'Could not load outreach for this lead.' })
  }
})

app.post('/api/outreach/draft', async (req, res) => {
  const auth = getAuth(res)
  const lead = req.body?.lead
  if (!lead?.name || typeof lead !== 'object') { res.status(400).json({ error: 'lead required' }); return }
  try {
    const siteUrl = await deployedUrlFor(req, String(lead.id ?? lead.name))
    if (!siteUrl) { res.status(400).json({ error: 'Deploy this lead’s MVP first. The email is built around its live link.' }); return }
    let gap: Record<string, any> | null = null
    const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId : null
    if (campaignId) {
      const cid = await campaignIdFor(auth, campaignId).catch(() => null)
      if (cid) gap = (await listGapAnalyses(cid).catch(() => [])).find(g => g.leadId === String(lead.id))?.result ?? null
    }
    res.json({ email: await createDraft(auth, { lead, gap, siteUrl, campaignId }) })
  } catch (err: any) {
    console.error('[outreach] draft failed:', err.message)
    res.status(503).json({ error: 'Could not write the draft. Try again shortly.' })
  }
})

app.put('/api/outreach/:id', async (req, res) => {
  const to = req.body?.to
  if (typeof to === 'string' && to.trim() && !validEmail(to.trim())) { res.status(400).json({ error: 'That email address does not look right.' }); return }
  try {
    const email = await updateDraft(getAuth(res), req.params.id, { to: req.body?.to, subject: req.body?.subject, body: req.body?.body })
    if (!email) { res.status(404).json({ error: 'Draft not found (it may already have been sent).' }); return }
    res.json({ email })
  } catch (err: any) {
    console.error('[outreach] save failed:', err.message)
    res.status(503).json({ error: 'Could not save the draft.' })
  }
})

app.post('/api/outreach/:id/send', async (req, res) => {
  try {
    res.json({ email: await sendEmail(getAuth(res), req.params.id) })
  } catch (err: any) {
    if (err instanceof SendError) { res.status(err.status).json({ error: err.message }); return }
    console.error('[outreach] send failed:', err.message)
    res.status(503).json({ error: 'Could not send the email. Try again shortly.' })
  }
})

// Admin: who outreach emails come from.
app.get('/api/settings-email', requireAdmin, async (_req, res) => {
  try { res.json(await getEmailSettings()) } catch (err: any) { res.status(503).json({ error: settingsError(err) }) }
})
app.put('/api/settings-email', requireAdmin, async (req, res) => {
  const from = typeof req.body?.from === 'string' ? req.body.from.trim().slice(0, 200) : ''
  const replyTo = typeof req.body?.replyTo === 'string' ? req.body.replyTo.trim().slice(0, 200) : ''
  const addr = (v: string) => (v.match(/<([^>]+)>/)?.[1] ?? v).trim()
  if (from && !validEmail(addr(from))) { res.status(400).json({ error: 'Use a From address like "Your Agency <hello@youragency.com>".' }); return }
  if (replyTo && !validEmail(addr(replyTo))) { res.status(400).json({ error: 'The reply-to address does not look right.' }); return }
  try { res.json(await setEmailSettings(from, replyTo)) } catch (err: any) { res.status(503).json({ error: settingsError(err) }) }
})

// ── Security audits: a lead's products, reviewed passively, explained by Claude, shared as a PDF ──

const latestSecurityJob = async (auth: ReturnType<typeof getAuth>, leadId: string) =>
  (await listJobs(auth, { kind: 'security', leadId, limit: 1 }))[0] ?? null

app.get('/api/security', async (req, res) => {
  const auth = getAuth(res)
  const leadId = String((req.query as Record<string, string>).leadId ?? '')
  if (!leadId) { res.status(400).json({ error: 'leadId required' }); return }
  try {
    const [audit, job] = await Promise.all([getAudit(auth, leadId), latestSecurityJob(auth, leadId)])
    res.json({ audit: audit ? publicAudit(audit) : null, job })
  } catch (err: any) {
    console.error('[security] read failed:', err.message)
    res.status(503).json({ error: 'Could not load the security audit.' })
  }
})

// Creates the lead's audit (with its website as the first product) if there isn't one yet.
app.post('/api/security', async (req, res) => {
  const lead = req.body?.lead
  if (!lead?.name || typeof lead !== 'object') { res.status(400).json({ error: 'lead required' }); return }
  try {
    const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId : null
    res.json({ audit: publicAudit(await auditFor(getAuth(res), lead, campaignId)) })
  } catch (err: any) {
    console.error('[security] create failed:', err.message)
    res.status(503).json({ error: 'Could not start the security audit.' })
  }
})

app.put('/api/security/:id/products', async (req, res) => {
  const auth = getAuth(res)
  try {
    const d = await getAuditById(auth, req.params.id)
    if (!d) { res.status(404).json({ error: 'Security audit not found' }); return }
    if (await activeJobOf(auth, 'security', { leadId: d.leadId })) { res.status(409).json({ error: 'Wait for the running audit to finish before changing the products.' }); return }
    const saved = await saveProducts(auth, req.params.id, req.body?.products)
    res.json({ audit: saved ? publicAudit(saved) : null })
  } catch (err: any) {
    if (err instanceof ScanTargetError) { res.status(400).json({ error: err.message }); return }
    console.error('[security] save products failed:', err.message)
    res.status(503).json({ error: 'Could not save the products.' })
  }
})

// Starts a background job: `discover` searches the web for the company's products, `run` reviews the chosen ones.
app.post('/api/security/:id/:action(discover|run)', requirePermission('claude'), async (req, res) => {
  const auth = getAuth(res)
  const action = req.params.action as 'discover' | 'run'
  try {
    const d = await getAuditById(auth, req.params.id)
    if (!d) { res.status(404).json({ error: 'Security audit not found' }); return }
    const running = await activeJobOf(auth, 'security', { leadId: d.leadId })
    if (running) { res.json({ job: await getJob(auth, String(running._id)) }); return }
    const lead = req.body?.lead && typeof req.body.lead === 'object' ? req.body.lead : { name: d.leadName, site: d.site }
    if (action === 'run') {
      if (!d.products.some(p => p.selected)) { res.status(400).json({ error: 'Choose at least one product to audit.' }); return }
      await resetSelected(d)
    }
    const start = action === 'run' ? auditJobStart(d) : { step: 'discover', state: {} }
    const job = await createJob(auth, originOf(req), {
      kind: 'security',
      title: `${action === 'run' ? 'Security audit' : 'Finding products'}: ${d.leadName}`,
      leadId: d.leadId,
      campaignId: d.campaignId,
      input: { auditId: String(d._id), mode: action === 'run' ? 'audit' : 'discover', lead },
      ...start,
    })
    res.json({ job })
  } catch (err: any) {
    console.error('[security] start failed:', err.message)
    res.status(503).json({ error: 'Could not start the job. Try again shortly.' })
  }
})

app.get('/api/security/:id/report.pdf', async (req, res) => {
  try {
    const r = await auditPdf(getAuth(res), req.params.id)
    if (!r) { res.status(404).json({ error: 'No report yet. Run the security audit first.' }); return }
    const name = reportFilename(r.leadName)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    res.send(r.pdf)
  } catch (err: any) {
    console.error('[security] pdf failed:', err.message)
    res.status(503).json({ error: 'Could not load the report.' })
  }
})

app.post('/api/outreach/security-draft', async (req, res) => {
  const auth = getAuth(res)
  const lead = req.body?.lead
  if (!lead?.name || typeof lead !== 'object') { res.status(400).json({ error: 'lead required' }); return }
  try {
    const d = await getAudit(auth, String(lead.id ?? lead.name))
    if (!d?.report) { res.status(400).json({ error: 'Run the security audit for this lead first. The email shares its report.' }); return }
    const campaignId = typeof req.body?.campaignId === 'string' ? req.body.campaignId : null
    res.json({ email: await createSecurityDraft(auth, { lead, audit: publicAudit(d), campaignId }) })
  } catch (err: any) {
    console.error('[outreach] security draft failed:', err.message)
    res.status(503).json({ error: 'Could not write the draft. Try again shortly.' })
  }
})

// List Graph8 contacts directly
app.get('/api/g8/contacts', async (_req, res) => {
  try {
    const data = await listContacts({ limit: 50 })
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// List Graph8 companies directly
app.get('/api/g8/companies', async (_req, res) => {
  try {
    const data = await listCompanies({ limit: 50 })
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
