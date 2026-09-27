import { randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { getDb } from './db.js'
import { safeEqual } from './crypto.js'

// Users are created by the admin. Each one can be allowed or denied the shared API keys:
// `claude` gates MVP generation, `graph8` gates lead search and enrichment.
export type Permission = 'claude' | 'graph8'
export type Permissions = Record<Permission, boolean>
export const PERMISSIONS: Permission[] = ['claude', 'graph8']

interface UserDoc {
  _id: ObjectId
  username: string
  passwordHash: string
  permissions: Permissions
  disabled: boolean
  // Self sign-ups wait here, with every key off, until the admin approves them.
  pending?: boolean
  // Bumped on password reset so existing sessions for this user stop working.
  sessionVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface PublicUser {
  id: string
  username: string
  permissions: Permissions
  disabled: boolean
  pending: boolean
  createdAt: Date
  updatedAt: Date
}

// A public sign-up form must not let anyone fill the database, so cap unapproved accounts.
const MAX_PENDING = 50

let indexReady = false
async function users() {
  const col = (await getDb()).collection<UserDoc>('users')
  if (!indexReady) {
    await col.createIndex({ username: 1 }, { unique: true })
    indexReady = true
  }
  return col
}

const scrypt = (pw: string, salt: Buffer, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, 64, opts, (err, key) => (err ? reject(err) : resolve(key))))

const SCRYPT = { N: 16384, r: 8, p: 1 }

async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, SCRYPT)
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

async function verifyPassword(pw: string, stored: string) {
  const [alg, n, salt, key] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !key) return false
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), { ...SCRYPT, N: Number(n) })
  return safeEqual(got.toString('base64url'), key)
}

// Burn the same scrypt time for unknown usernames so response timing doesn't reveal which exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'))

export const normalizeUsername = (s: unknown) => String(s ?? '').trim().toLowerCase()

export function validateUsername(u: string) {
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(u)) return 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.'
  if (u === 'admin') return '"admin" is reserved for the administrator.'
  return null
}

export function validatePassword(pw: unknown) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) return 'Passwords must be 8–200 characters.'
  return null
}

export function parsePermissions(p: any): Permissions {
  return { claude: p?.claude === true, graph8: p?.graph8 === true }
}

const toPublic = (u: UserDoc): PublicUser => ({
  id: String(u._id),
  username: u.username,
  permissions: { claude: !!u.permissions?.claude, graph8: !!u.permissions?.graph8 },
  disabled: !!u.disabled,
  pending: !!u.pending,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
})

export async function listUsers() {
  const list = await (await users()).find({}, { projection: { passwordHash: 0 } }).sort({ username: 1 }).toArray()
  return list.map(toPublic)
}

export async function createUser(username: string, password: string, permissions: Permissions, pending = false) {
  const now = new Date()
  const doc: UserDoc = {
    _id: new ObjectId(),
    username,
    passwordHash: await hashPassword(password),
    permissions: pending ? { claude: false, graph8: false } : permissions,
    disabled: false,
    pending,
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  await (await users()).insertOne(doc)
  return toPublic(doc)
}

export async function signUp(username: string, password: string) {
  if ((await (await users()).countDocuments({ pending: true })) >= MAX_PENDING) return null
  return createUser(username, password, { claude: false, graph8: false }, true)
}

export async function updateUser(
  id: string,
  patch: { permissions?: Partial<Permissions>; disabled?: boolean; password?: string; approve?: boolean },
) {
  if (!ObjectId.isValid(id)) return null
  const $set: Record<string, unknown> = { updatedAt: new Date() }
  const $inc: Record<string, number> = {}
  for (const p of PERMISSIONS) {
    const on = patch.permissions?.[p]
    if (typeof on === 'boolean') $set[`permissions.${p}`] = on
  }
  if (typeof patch.disabled === 'boolean') $set.disabled = patch.disabled
  if (patch.approve === true) $set.pending = false
  if (patch.password) {
    $set.passwordHash = await hashPassword(patch.password)
    $inc.sessionVersion = 1
  }
  const res = await (await users()).findOneAndUpdate(
    { _id: new ObjectId(id) },
    Object.keys($inc).length ? { $set, $inc } : { $set },
    { returnDocument: 'after', projection: { passwordHash: 0 } },
  )
  return res ? toPublic(res) : null
}

export async function deleteUser(id: string) {
  if (!ObjectId.isValid(id)) return false
  const { deletedCount } = await (await users()).deleteOne({ _id: new ObjectId(id) })
  return deletedCount === 1
}

export async function authenticateUser(username: string, password: string) {
  const user = await (await users()).findOne({ username })
  if (!user) {
    await verifyPassword(password, await DUMMY_HASH)
    return null
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null
  // Only reveal account state to someone who knows the password.
  if (user.pending) return { status: 'pending' as const }
  if (user.disabled) return { status: 'disabled' as const }
  return { status: 'ok' as const, id: String(user._id), sessionVersion: user.sessionVersion }
}

// Read on every request so permission changes, disables and deletes take effect immediately.
export async function getSessionUser(id: string, sessionVersion: number) {
  if (!ObjectId.isValid(id)) return null
  const user = await (await users()).findOne({ _id: new ObjectId(id) }, { projection: { passwordHash: 0 } })
  if (!user || user.disabled || user.pending || user.sessionVersion !== sessionVersion) return null
  return toPublic(user)
}
