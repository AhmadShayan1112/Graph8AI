import express, { type NextFunction, type Request, type Response } from 'express'
import { ObjectId } from 'mongodb'
import {
  searchCompaniesByFilters,
  getFilterOptions,
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
import { deleteSecret, secretStatus, setSecret, type SecretName } from './secrets.js'
import { generateSiteHtml, publicClaudeError } from './claude.js'
import { getDb } from './db.js'
import {
  createUser, deleteUser, listUsers, normalizeUsername, parsePermissions, updateUser, validatePassword, validateUsername,
} from './users.js'
import { deleteSearch, deleteSearchesFor, getSearch, listSearches, saveSearch } from './history.js'

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// No API response is ever cacheable: some carry settings status, none should sit in a shared cache.
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }) })
app.get('/api/auth/session', session)
app.post('/api/auth/login', login)
app.post('/api/auth/logout', logout)
app.post('/api/auth/signup', signUp)

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
const SECRET_ROUTES: Record<string, SecretName> = { graph8: 'graph8ApiKey', claude: 'claudeToken' }

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
    await deleteSearchesFor(req.params.id)
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
  const { save = true, ...asked } = (req.body ?? {}) as DiscoverBody
  const body: DiscoverBody = { ...asked }
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

    // History is a convenience: a failed save must not lose the search the user just paid for.
    const searchId = save
      ? await saveSearch(getAuth(res), {
          prompt: asked.prompt?.trim() ?? '',
          filters: savedFilters(asked),
          matchedOn,
          total: companyRes.pagination.total,
          leads,
        }).catch(err => { console.error('[history] save failed:', err.message); null })
      : null

    res.json({
      leads,
      searchId,
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

// Generate an MVP site for a lead with Claude, kept as a draft until it is deployed.
const MVP_TYPES: Record<string, { title: string; tag: string; description: string; fixes: string; steps: string[] }> = {
  'booking-page': {
    title: 'Online Booking Page',
    tag: 'recommended',
    description: 'Branded booking page with their services, hours, contact info and a booking flow.',
    fixes: 'No online booking, Phone-only appointments',
    steps: ['Reading business data', 'Planning services and hours', 'Designing the booking flow', 'Writing the page', 'Checking mobile layout'],
  },
  'contact-form': {
    title: 'Lead Capture Form',
    tag: 'quick win',
    description: 'Landing page built around a smart contact form with service selection.',
    fixes: 'No contact form, Missing lead capture',
    steps: ['Reading business data', 'Choosing form fields', 'Adding service options', 'Writing the page', 'Checking mobile layout'],
  },
  'mobile-landing': {
    title: 'Mobile-First Landing',
    tag: 'high impact',
    description: 'Responsive landing page optimized for mobile visitors, with click-to-call.',
    fixes: 'Not mobile-friendly, Poor mobile experience',
    steps: ['Reading business data', 'Extracting key content', 'Designing mobile layout', 'Writing the page', 'Adding click-to-call'],
  },
  'speed-landing': {
    title: 'Fast Landing Page',
    tag: 'performance',
    description: 'Lightweight landing page with minimal assets that loads in under a second.',
    fixes: 'Slow website, Poor Core Web Vitals',
    steps: ['Reading business data', 'Planning a lightweight layout', 'Inlining critical styles', 'Writing the page', 'Trimming page weight'],
  },
}

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

app.post('/api/mvp/generate', async (req, res) => {
  const { lead, mvpType } = req.body ?? {}
  if (!lead?.name) { res.status(400).json({ error: 'lead required' }); return }
  const meta = MVP_TYPES[mvpType] ?? MVP_TYPES['booking-page']
  try {
    const html = await generateSiteHtml({
      name: lead.name,
      type: lead.type,
      city: lead.city,
      site: lead.site,
      gaps: lead.gaps,
      mvpTitle: meta.title,
      mvpDescription: meta.description,
      phone: lead.enrichment?.company?.phone || lead.enrichment?.person?.phone,
      address: lead.enrichment?.company?.address,
      description: lead.enrichment?.company?.description,
    })
    const { insertedId } = await (await drafts()).insertOne({
      html, leadId: String(lead.id ?? lead.name), leadName: lead.name, mvpType, createdAt: new Date(),
    })
    res.json({ mvp: { ...meta, html, draftId: String(insertedId) }, lead })
  } catch (err) {
    console.error('[mvp] generate failed:', err instanceof Error ? err.message : err)
    const { status, error } = publicClaudeError(err)
    res.status(status).json({ error })
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

// Generate outreach email
app.post('/api/outreach/generate', async (req, res) => {
  try {
    const { lead, mvpType, mvpUrl } = req.body

    const outreach = {
      subject: `${lead.contact.split(' ')[0]}, I built something for ${lead.name}`,
      greeting: `Hi ${lead.contact.split(' ')[0]},`,
      body1: `I noticed ${lead.name} doesn't have an easy way for customers to`,
      signal: lead.gaps[0]?.toLowerCase() || 'book online',
      body2: `So I went ahead and built one — a working ${mvpType?.replace(/-/g, ' ') || 'booking page'} using your actual services and hours. It's live and ready for you to try:`,
      liveUrl: mvpUrl || `${lead.name.toLowerCase().replace(/\s+/g, '')}.gapwise.site`,
      body3: `No obligation — if it's useful, I'd love to help you take it further. If not, no worries at all.`,
      signature: 'Best regards',
      sequence: [
        {
          day: 'Day 0',
          channel: 'Email',
          title: 'MVP delivery',
          condition: 'On send',
        },
        {
          day: 'Day 3',
          channel: 'Email',
          title: 'Usage follow-up',
          condition: 'If opened, not replied',
        },
        {
          day: 'Day 7',
          channel: 'LinkedIn',
          title: 'Connection request',
          condition: 'If no reply',
        },
      ],
    }

    res.json(outreach)
  } catch (err: any) {
    console.error('Outreach error:', err)
    res.status(500).json({ error: err.message })
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
