import { createHash } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { safeEqual, sign } from './crypto.js'
import {
  authenticateUser, getSessionUser, normalizeUsername, signUp as createAccount, validatePassword, validateUsername,
  type Permission, type Permissions,
} from './users.js'
import { getWorkspaceAccess } from './secrets.js'

// The admin signs in as "admin" with ADMIN_PASSWORD and manages keys and users.
// Users are created by the admin and can only use the API keys the admin has switched on for them.
// Without ADMIN_PASSWORD a public deployment would let anyone replace or delete your keys and spend your credits.
const COOKIE = 'gw_session'
const TTL_MS = 12 * 60 * 60 * 1000

const onVercel = () => !!process.env.VERCEL
export const authRequired = () => !!process.env.ADMIN_PASSWORD || onVercel()

// Folding the password into the signing purpose means changing ADMIN_PASSWORD signs everyone out.
const sessionPurpose = () =>
  `session:${createHash('sha256').update(process.env.ADMIN_PASSWORD ?? '').digest('hex')}`

export interface AuthInfo {
  role: 'admin' | 'user'
  userId: string | null
  username: string
  permissions: Permissions
}

const ADMIN: AuthInfo = { role: 'admin', userId: null, username: 'admin', permissions: { claude: true, graph8: true, gemini: true } }

export function parseCookies(req: Request) {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

// Cookie: `<subject>.<expiry>.<mac>`, subject is "admin" or "u-<userId>-<sessionVersion>".
async function resolveSession(req: Request): Promise<AuthInfo | null> {
  if (!authRequired()) return ADMIN
  if (!process.env.ADMIN_PASSWORD) return null
  const [sub, exp, mac] = (parseCookies(req)[COOKIE] ?? '').split('.')
  if (!sub || !exp || !mac || Number(exp) < Date.now()) return null
  if (!safeEqual(mac, sign(`${sub}.${exp}`, sessionPurpose()))) return null
  if (sub === 'admin') return ADMIN
  const m = sub.match(/^u-([0-9a-f]{24})-(\d+)$/)
  if (!m) return null
  return userAuth(m[1], Number(m[2]))
}

// A user's access is their own switches, plus anything the admin has opened to everyone.
async function userAuth(id: string, sessionVersion: number): Promise<AuthInfo | null> {
  const [user, workspace] = await Promise.all([getSessionUser(id, sessionVersion), getWorkspaceAccess()])
  if (!user) return null
  const permissions = {
    ...user.permissions,
    graph8: user.permissions.graph8 || workspace.graph8ForEveryone,
    gemini: user.permissions.gemini || workspace.geminiForEveryone,
  }
  return { role: 'user', userId: user.id, username: user.username, permissions }
}

function cookieAttrs(maxAgeSec: number) {
  const secure = onVercel() || process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`
}

function startSession(res: Response, sub: string) {
  const exp = String(Date.now() + TTL_MS)
  res.setHeader('Set-Cookie', `${COOKIE}=${sub}.${exp}.${sign(`${sub}.${exp}`, sessionPurpose())}; ${cookieAttrs(TTL_MS / 1000)}`)
}

const publicAuth = (a: AuthInfo) => ({ username: a.username, role: a.role, permissions: a.permissions })

export async function login(req: Request, res: Response) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    res.status(503).json({ error: 'Set the ADMIN_PASSWORD environment variable to enable sign-in.' })
    return
  }
  const username = normalizeUsername(req.body?.username) || 'admin'
  const given = String(req.body?.password ?? '')

  if (username === 'admin') {
    const digest = (s: string) => createHash('sha256').update(s).digest('hex')
    if (!safeEqual(digest(given), digest(expected))) {
      res.status(401).json({ error: 'Wrong username or password' })
      return
    }
    startSession(res, 'admin')
    res.json({ authenticated: true, user: publicAuth(ADMIN) })
    return
  }

  try {
    const user = await authenticateUser(username, given)
    if (!user) { res.status(401).json({ error: 'Wrong username or password' }); return }
    if (user.status === 'disabled') { res.status(403).json({ error: 'Your account has been disabled by the admin.' }); return }
    startSession(res, `u-${user.id}-${user.sessionVersion}`)
    const auth = await userAuth(user.id, user.sessionVersion)
    res.json({ authenticated: true, user: auth && publicAuth(auth) })
  } catch (err: any) {
    console.error('[auth] user login failed:', err.message)
    res.status(503).json({ error: 'Could not reach the database. Try again shortly.' })
  }
}

// Anyone can create an account and is signed in right away, with every key off until the admin enables it.
export async function signUp(req: Request, res: Response) {
  if (!process.env.ADMIN_PASSWORD) {
    res.status(503).json({ error: 'Sign-up is unavailable until the server is configured.' })
    return
  }
  const username = normalizeUsername(req.body?.username)
  const invalid = validateUsername(username) ?? validatePassword(req.body?.password)
  if (invalid) { res.status(400).json({ error: invalid }); return }
  try {
    const created = await createAccount(username, req.body.password)
    if (!created) { res.status(429).json({ error: 'Too many new accounts right now. Try again in a while.' }); return }
    startSession(res, `u-${created.user.id}-${created.sessionVersion}`)
    const auth = await userAuth(created.user.id, created.sessionVersion)
    res.json({ authenticated: true, user: auth && publicAuth(auth) })
  } catch (err: any) {
    if (err.code === 11000) { res.status(409).json({ error: 'That username is taken.' }); return }
    console.error('[auth] sign-up failed:', err.message)
    res.status(503).json({ error: 'Could not reach the database. Try again shortly.' })
  }
}

export function logout(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`)
  res.json({ authenticated: false })
}

export async function session(req: Request, res: Response) {
  const auth = await resolveSession(req).catch(() => null)
  res.json({
    required: authRequired(),
    authenticated: !!auth,
    passwordConfigured: !!process.env.ADMIN_PASSWORD,
    user: auth ? publicAuth(auth) : null,
  })
}

export const getAuth = (res: Response) => res.locals.auth as AuthInfo

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = await resolveSession(req)
    if (auth) { res.locals.auth = auth; next(); return }
  } catch (err: any) {
    console.error('[auth] session check failed:', err.message)
    res.status(503).json({ error: 'Could not reach the database. Try again shortly.' })
    return
  }
  res.status(401).json({ error: 'Sign in required' })
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (getAuth(res)?.role === 'admin') { next(); return }
  res.status(403).json({ error: 'Only the admin can do this.' })
}

const PERMISSION_LABEL: Record<Permission, string> = {
  claude: 'MVP generation with Claude',
  graph8: 'Lead search with Graph8',
  gemini: 'Gap analysis with Gemini',
}

export function requirePermission(p: Permission) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (getAuth(res)?.permissions[p]) { next(); return }
    res.status(403).json({ error: `${PERMISSION_LABEL[p]} is turned off for your account. Ask the admin to enable it.`, permission: p })
  }
}
