import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

// Every secret at rest is AES-256-GCM encrypted with a key derived from GAPWISE_SECRET.
// (A hash like SHA-512 is one-way, so it can't be used for tokens we must send back out.)
function masterSecret() {
  const s = process.env.GAPWISE_SECRET
  if (!s || s.length < 32) throw new Error('GAPWISE_SECRET must be set to a random string of at least 32 characters')
  return s
}

function deriveKey(purpose: string) {
  return Buffer.from(hkdfSync('sha256', masterSecret(), 'gapwise', purpose, 32))
}

// `context` is bound as associated data, so a ciphertext copied into another field fails to decrypt.
export function encrypt(plain: string, context: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey('settings-encryption'), iv)
  cipher.setAAD(Buffer.from(context))
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')}`
}

export function decrypt(payload: string, context: string) {
  const [version, body] = payload.split('.')
  if (version !== 'v1' || !body) throw new Error('Unknown ciphertext format')
  const raw = Buffer.from(body, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('settings-encryption'), raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

export function sign(value: string, purpose: string) {
  return createHmac('sha256', deriveKey(purpose)).update(value).digest('base64url')
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
