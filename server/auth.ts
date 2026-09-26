import { createHash } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { safeEqual, sign } from './crypto.js'

// A single admin password (ADMIN_PASSWORD env) guards the app and its settings.
// Without it a public deployment would let anyone replace or delete your keys and spend your credits.
const COOKIE = 'gw_session'
const TTL_MS = 12 * 60 * 60 * 1000

const onVercel = () => !!process.env.VERCEL
export const authRequired = () => !!process.env.ADMIN_PASSWORD || onVercel()

// Folding the password into the signing purpose means changing ADMIN_PASSWORD signs everyone out.
const sessionPurpose = () =>
  `session:${createHash('sha256').update(process.env.ADMIN_PASSWORD ?? '').digest('hex')}`

export function parseCookies(req: Request) {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function isAuthenticated(req: Request) {
  if (!authRequired()) return true
  if (!process.env.ADMIN_PASSWORD) return false
  const [exp, mac] = (parseCookies(req)[COOKIE] ?? '').split('.')
  if (!exp || !mac || Number(exp) < Date.now()) return false
  return safeEqual(mac, sign(exp, sessionPurpose()))
}

function cookieAttrs(maxAgeSec: number) {
  const secure = onVercel() || process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`
}

export function login(req: Request, res: Response) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    res.status(503).json({ error: 'Set the ADMIN_PASSWORD environment variable to enable sign-in.' })
    return
  }
  const given = String(req.body?.password ?? '')
  const digest = (s: string) => createHash('sha256').update(s).digest('hex')
  if (!safeEqual(digest(given), digest(expected))) {
    res.status(401).json({ error: 'Wrong password' })
    return
  }
  const exp = String(Date.now() + TTL_MS)
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp, sessionPurpose())}; ${cookieAttrs(TTL_MS / 1000)}`)
  res.json({ authenticated: true })
}

export function logout(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`)
  res.json({ authenticated: false })
}

export function session(req: Request, res: Response) {
  res.json({
    required: authRequired(),
    authenticated: isAuthenticated(req),
    passwordConfigured: !!process.env.ADMIN_PASSWORD,
  })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) { next(); return }
  res.status(401).json({ error: 'Sign in required' })
}
