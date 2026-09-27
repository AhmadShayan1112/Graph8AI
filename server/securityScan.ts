import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'

// Passive security review of a public website: only what any visitor's browser already receives (the TLS
// certificate, response headers, cookies, the home page's HTML) plus public DNS records and the public
// security.txt file. Nothing is probed, guessed, brute-forced or submitted. Every request goes to a public
// address only (never this server's own network), follows at most a few redirects, and has a short timeout.

const UA = 'Mozilla/5.0 (compatible; GapwiseSecurityReview/1.0; passive, non-intrusive)'
const TIMEOUT_MS = 12_000
const MAX_BODY = 1_500_000
const MAX_REDIRECTS = 5

export class ScanTargetError extends Error {}

// ── Only public addresses ──

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
}

function privateIp(ip: string) {
  if (net.isIPv4(ip)) return privateV4(ip)
  const v6 = ip.toLowerCase()
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mapped) return privateV4(mapped)
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff')
}

async function assertPublicHost(host: string) {
  const h = host.replace(/^\[|\]$/g, '')
  if (!h || /^(localhost|.*\.local|.*\.internal)$/i.test(h)) throw new ScanTargetError(`${host} is not a public website`)
  const addrs = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true }).catch(() => [])).map(a => a.address)
  if (!addrs.length) throw new ScanTargetError(`${host} could not be found (no DNS record)`)
  if (addrs.some(privateIp)) throw new ScanTargetError(`${host} points to a private address`)
}

export function normalizeUrl(raw: string) {
  const s = raw.trim()
  const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ScanTargetError('Only http and https websites can be reviewed')
  if (u.username || u.password) throw new ScanTargetError('Website addresses with a login in them are not allowed')
  u.hash = ''
  return u
}

// ── Fetching one page, following redirects by hand so every hop is checked ──

interface Fetched {
  url: string
  status: number
  headers: Record<string, string>
  cookies: string[]
  body: string
  chain: Array<{ url: string; status: number }>
}

async function readLimited(res: Response) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BODY) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY)
}

async function fetchPage(start: string, opts: { follow?: boolean; readBody?: boolean } = {}): Promise<Fetched> {
  const chain: Fetched['chain'] = []
  let url = start
  for (let hop = 0; ; hop++) {
    const u = new URL(url)
    await assertPublicHost(u.hostname)
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    chain.push({ url, status: res.status })
    const location = res.headers.get('location')
    if (opts.follow !== false && res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
      await res.body?.cancel().catch(() => {})
      url = new URL(location, url).toString()
      continue
    }
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v.slice(0, 600) })
    const body = opts.readBody === false ? (await res.body?.cancel().catch(() => {}), '') : await readLimited(res)
    return { url, status: res.status, headers, cookies: res.headers.getSetCookie?.() ?? [], body, chain }
  }
}

// ── TLS ──

interface TlsResult {
  ok: boolean
  error?: string
  protocol?: string | null
  trusted?: boolean
  trustError?: string
  issuer?: string
  subject?: string
  validFrom?: string
  validTo?: string
  daysLeft?: number
  coversHost?: boolean
}

function tlsConnect(host: string, extra: tls.ConnectionOptions = {}) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, ...extra })
    socket.setTimeout(TIMEOUT_MS, () => { socket.destroy(); reject(new Error('timed out')) })
    socket.once('secureConnect', () => resolve(socket))
    socket.once('error', reject)
  })
}

async function checkTls(host: string): Promise<TlsResult> {
  try {
    const socket = await tlsConnect(host)
    const cert = socket.getPeerCertificate()
    const protocol = socket.getProtocol()
    socket.end()
    const validTo = cert?.valid_to ? new Date(cert.valid_to) : null
    const names = String(cert?.subjectaltname ?? '').split(',').map(s => s.trim().replace(/^DNS:/, '').toLowerCase())
    const coversHost = names.some(n => n === host.toLowerCase() || (n.startsWith('*.') && host.toLowerCase().endsWith(n.slice(1)) && host.split('.').length === n.split('.').length))
    return {
      ok: true,
      protocol,
      trusted: socket.authorized,
      trustError: socket.authorized ? undefined : String(socket.authorizationError ?? ''),
      issuer: [cert?.issuer?.O, cert?.issuer?.CN].filter(Boolean).join(' / '),
      subject: String(cert?.subject?.CN ?? ''),
      validFrom: cert?.valid_from,
      validTo: cert?.valid_to,
      daysLeft: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : undefined,
      coversHost,
    }
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 200) }
  }
}

// Whether the server still accepts TLS 1.0/1.1 (retired in 2021 by RFC 8996). One ordinary handshake, no data.
async function acceptsLegacyTls(host: string): Promise<boolean | null> {
  try {
    const socket = await tlsConnect(host, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' })
    socket.end()
    return true
  } catch (err: any) {
    // A local OpenSSL that cannot speak old TLS at all gives no answer either way.
    return /no protocols available|unsupported protocol/i.test(String(err?.message)) ? null : false
  }
}

// ── DNS (email spoofing protection and certificate authority limits) ──

const SECOND_LEVEL = /^(co|com|net|org|gov|edu|ac|gob|or|ne|go|ltd|plc|nic|mil)$/

export function apexDomain(host: string) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.')
  if (parts.length <= 2) return parts.join('.')
  const take = parts[parts.length - 1].length === 2 && SECOND_LEVEL.test(parts[parts.length - 2]) ? 3 : 2
  return parts.slice(-take).join('.')
}

async function txt(name: string) {
  return (await dns.resolveTxt(name).catch(() => [] as string[][])).map(r => r.join(''))
}

async function checkDns(domain: string) {
  const [root, dmarc, caa] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    dns.resolveCaa(domain).catch(() => []),
  ])
  const spf = root.find(r => /^v=spf1/i.test(r)) ?? null
  const dmarcRecord = dmarc.find(r => /^v=DMARC1/i.test(r)) ?? null
  return {
    domain,
    spf,
    spfAllowsAll: !!spf && /[+?]all\b/i.test(spf),
    dmarc: dmarcRecord,
    dmarcPolicy: dmarcRecord?.match(/;\s*p=(\w+)/i)?.[1]?.toLowerCase() ?? null,
    caa: caa.map(c => `${c.critical} ${Object.entries(c).filter(([k]) => k !== 'critical').map(([k, v]) => `${k} ${v}`).join(' ')}`),
  }
}

// ── The home page's HTML ──

function analyseHtml(html: string, pageUrl: string) {
  const https = pageUrl.startsWith('https:')
  const tags = (re: RegExp) => [...html.matchAll(re)].map(m => m[0])
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? ''
  const host = new URL(pageUrl).hostname

  const scripts = tags(/<script\b[^>]*\bsrc\s*=[^>]*>/gi)
  const external = scripts
    .map(t => ({ src: attr(t, 'src'), integrity: !!attr(t, 'integrity') }))
    .filter(s => /^(https?:)?\/\//i.test(s.src))
    .map(s => ({ ...s, host: (() => { try { return new URL(s.src, pageUrl).hostname } catch { return '' } })() }))
    .filter(s => s.host && s.host !== host)

  const loaded = [
    ...scripts.map(t => attr(t, 'src')),
    ...tags(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi).map(t => attr(t, 'href')),
    ...tags(/<(?:img|iframe|video|audio|source|embed)\b[^>]*>/gi).map(t => attr(t, 'src')),
  ]
  const mixed = https ? loaded.filter(u => /^http:\/\//i.test(u)).slice(0, 10) : []

  const forms = tags(/<form\b[^>]*>/gi).map(t => attr(t, 'action'))
  const insecureForms = forms.filter(a => /^http:\/\//i.test(a) || (!https && a !== undefined)).slice(0, 5)

  const generator = tags(/<meta\b[^>]*name\s*=\s*["']generator["'][^>]*>/gi).map(t => attr(t, 'content')).filter(Boolean)
  // Library versions published in file names or ?ver= parameters (e.g. jquery-1.12.4.min.js, ?ver=5.8.1).
  const versions = [...new Set(
    [...scripts.map(t => attr(t, 'src')), ...tags(/<link\b[^>]*>/gi).map(t => attr(t, 'href'))]
      .map(src => {
        const m = src.match(/([a-z][a-z0-9_.-]*?)[-.@/]v?(\d+\.\d+(?:\.\d+)?)(?:[.-]min)?\.(?:js|css)/i) ?? src.match(/\/([a-z][a-z0-9_-]+)\/[^?]*\?ver=(\d+\.\d+(?:\.\d+)?)/i)
        return m ? `${m[1].toLowerCase()} ${m[2]}` : ''
      })
      .filter(Boolean),
  )].slice(0, 15)

  const cms = /wp-content|wp-includes/i.test(html) ? 'WordPress' : /cdn\.shopify\.com/i.test(html) ? 'Shopify'
    : /static\.wixstatic\.com|wix\.com/i.test(html) ? 'Wix' : /squarespace/i.test(html) ? 'Squarespace'
      : /\/sites\/default\/files|drupal/i.test(html) ? 'Drupal' : /joomla/i.test(html) ? 'Joomla' : null

  return {
    title: html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() ?? '',
    cms,
    generator,
    versions,
    externalScripts: external.length,
    externalScriptHosts: [...new Set(external.map(s => s.host))].slice(0, 15),
    externalScriptsWithoutIntegrity: external.filter(s => !s.integrity).length,
    mixedContent: mixed,
    forms: forms.length,
    passwordFields: tags(/<input\b[^>]*type\s*=\s*["']?password/gi).length,
    insecureForms,
  }
}

function parseCookies(list: string[]) {
  return list.slice(0, 20).map(c => {
    const [pair, ...attrs] = c.split(';').map(s => s.trim())
    const flags = attrs.map(a => a.toLowerCase())
    return {
      name: pair.split('=')[0].slice(0, 80),
      secure: flags.includes('secure'),
      httpOnly: flags.includes('httponly'),
      sameSite: flags.find(f => f.startsWith('samesite='))?.split('=')[1] ?? null,
    }
  })
}

const SECURITY_HEADERS = [
  'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy',
] as const

export type ScanResult = Awaited<ReturnType<typeof scanWebsite>>

export async function scanWebsite(raw: string) {
  const target = normalizeUrl(raw)
  const host = target.hostname
  await assertPublicHost(host)
  const httpsUrl = `https://${target.host}${target.pathname}${target.search}`

  const [page, plain, tlsInfo, legacyTls, dnsInfo, securityTxt] = await Promise.all([
    fetchPage(httpsUrl).catch((err: any) => ({ error: String(err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err).slice(0, 200) })),
    fetchPage(`http://${target.host}${target.pathname}`, { follow: false, readBody: false }).catch(() => null),
    checkTls(host),
    acceptsLegacyTls(host),
    checkDns(apexDomain(host)),
    fetchPage(`https://${target.host}/.well-known/security.txt`, { follow: false })
      .then(r => r.status === 200 && /^\s*contact:/im.test(r.body)).catch(() => false),
  ])

  // No HTTPS at all: review what the plain-HTTP site sends instead.
  const served = 'error' in page ? await fetchPage(`http://${target.host}${target.pathname}`).catch(() => null) : page
  if (!served) throw new ScanTargetError(`${host} did not respond over HTTPS or HTTP`)

  const location = plain?.headers.location ?? ''
  const h = served.headers
  const csp = h['content-security-policy'] ?? ''
  return {
    url: target.toString(),
    host,
    scannedAt: new Date().toISOString(),
    https: {
      available: !('error' in page),
      error: 'error' in page ? page.error : undefined,
      httpRedirectsToHttps: plain ? plain.status >= 300 && plain.status < 400 && /^https:/i.test(new URL(location || '/', `http://${host}`).toString()) : null,
      httpStatus: plain?.status ?? null,
    },
    tls: { ...tlsInfo, acceptsTls10or11: legacyTls },
    response: {
      finalUrl: served.url,
      status: served.status,
      redirects: served.chain.length - 1,
      server: h.server ?? null,
      poweredBy: h['x-powered-by'] ?? null,
      aspNetVersion: h['x-aspnet-version'] ?? h['x-aspnetmvc-version'] ?? null,
      corsAllowOrigin: h['access-control-allow-origin'] ?? null,
    },
    headers: Object.fromEntries(SECURITY_HEADERS.map(k => [k, h[k] ?? null])) as Record<(typeof SECURITY_HEADERS)[number], string | null>,
    hstsMaxAge: Number(h['strict-transport-security']?.match(/max-age=(\d+)/i)?.[1] ?? 0) || null,
    cspWeaknesses: csp ? [
      /'unsafe-inline'/.test(csp) && !/'nonce-|'sha(256|384|512)-/.test(csp) ? "allows 'unsafe-inline' scripts" : '',
      /'unsafe-eval'/.test(csp) ? "allows 'unsafe-eval'" : '',
      /(?:^|;)\s*(?:default|script)-src[^;]*\s\*(?:\s|;|$)/.test(csp) ? 'allows scripts from any site (*)' : '',
      !/frame-ancestors/.test(csp) ? 'no frame-ancestors rule' : '',
    ].filter(Boolean) : [],
    cookies: parseCookies(served.cookies),
    page: analyseHtml(served.body, served.url),
    dns: dnsInfo,
    securityTxt,
  }
}
