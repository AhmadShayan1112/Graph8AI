import { getGeminiKey } from './secrets.js'

// Gemini with Google Search grounding, so answers about a business come from what is on the web now.
// Users never see which provider does the research: their messages are provider-neutral. The admin gets
// Google's own reason (GeminiError.detail) so a key or quota problem can actually be fixed.
//
// Keys differ in which models they can use and how much quota each has (free keys especially), so calls
// don't depend on one model. The cheapest models with the most generous free limits (Flash-Lite) go first,
// then regular Flash, then whatever else this key offers; the one that works is remembered. When Google
// says "too many requests", calls keep cycling through the models with growing waits until a time budget
// runs out (Vercel stops a request after 5 minutes, so it cannot be endless).
const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const PREFERRED = [
  'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite',
  'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash',
]
const BUDGET_MS = { research: 120_000, assistant: 45_000 } as const

export class GeminiError extends Error {
  constructor(message: string, public status: number, public detail = '') { super(message) }
}

export interface GroundedAnswer {
  text: string
  sources: Array<{ title: string; url: string }>
  queries: string[]
}

let workingModel: string | null = null
let listed: { models: string[]; at: number } | null = null

// The text models this key can call, newest and cheapest first; cached for ten minutes.
async function availableModels(key: string) {
  if (listed && Date.now() - listed.at < 600_000) return listed.models
  try {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) })
    const data = res.ok ? await res.json() : null
    const models = (data?.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((n: string) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|embed|vision|exp|preview)/.test(n))
      // Cheapest first: Lite models, then newest versions.
      .sort((a: string, b: string) => (/lite/.test(b) ? 1 : 0) - (/lite/.test(a) ? 1 : 0) || b.localeCompare(a))
    listed = { models, at: Date.now() }
    return models
  } catch {
    return []
  }
}

// GEMINI_MODEL (if set) wins; otherwise the model that last worked, then the cheap-first list. Only models
// this key actually offers are kept when the list could be read.
async function candidates(key: string) {
  const offered = await availableModels(key)
  const wanted = [process.env.GEMINI_MODEL, workingModel, ...PREFERRED, ...offered].filter((m): m is string => !!m)
  const usable = offered.length ? wanted.filter(m => m === process.env.GEMINI_MODEL || offered.includes(m)) : wanted
  return [...new Set(usable)].slice(0, 6)
}

function retryDelayMs(body: any) {
  const info = (body?.error?.details ?? []).find((d: any) => String(d?.['@type'] ?? '').includes('RetryInfo'))
  const secs = parseFloat(String(info?.retryDelay ?? '').replace('s', ''))
  return Number.isFinite(secs) ? secs * 1000 : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Kind = 'research' | 'assistant'
const MESSAGES: Record<Kind, { noKey: string; badKey: string; busy: string; failed: string }> = {
  research: {
    noKey: 'Gap analysis is not set up yet. Ask the admin to add the research API key in Settings.',
    badKey: 'The research API key was rejected. Ask the admin to check it in Settings.',
    busy: 'The research service has reached its usage limit. Try again later, or ask the admin to check the key\'s quota.',
    failed: 'The research could not be completed. Try again shortly.',
  },
  assistant: {
    noKey: 'The assistant is not set up yet. Ask the admin to add the research API key in Settings.',
    badKey: 'The assistant is not available right now. Ask the admin to check the research API key.',
    busy: 'The assistant has reached its usage limit. Try again later, or ask the admin to check the key\'s quota.',
    failed: 'The assistant could not answer right now. Try again shortly.',
  },
}

// Sends one request, cycling through models (and waiting between rounds) until one accepts it or the
// time budget runs out. Returns the successful response.
async function send(kind: Kind, action: string, body: unknown, timeoutMs: number) {
  const key = await getGeminiKey()
  if (!key) throw new GeminiError(MESSAGES[kind].noKey, 400, 'No Gemini API key is saved in Settings.')
  const deadline = Date.now() + BUDGET_MS[kind]
  const dead = new Set<string>() // models this key can't use at all (not found / unsupported)
  const tried = new Set<string>()
  let lastDetail = ''
  let sawQuota = false
  for (let round = 0; Date.now() < deadline; round++) {
    const models = (await candidates(key)).filter(m => !dead.has(m))
    if (!models.length) break
    let suggestedWait = 0
    for (const model of models) {
      if (Date.now() >= deadline) break
      tried.add(model)
      let res: Response
      try {
        res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(5000, deadline - Date.now() + 30_000))),
        })
      } catch (e: any) {
        lastDetail = `${model}: network error ${e?.message ?? e}`
        console.error(`[gemini] ${kind} ${lastDetail}`)
        continue
      }
      if (res.ok) {
        if (workingModel !== model) console.log(`[gemini] using model ${model}`)
        workingModel = model
        return { res, model }
      }
      const err = await res.json().catch(() => null)
      const detail = String(err?.error?.message ?? res.statusText).replace(/\s+/g, ' ').slice(0, 400)
      lastDetail = `${model}: ${res.status} ${detail}`
      console.error(`[gemini] ${kind} round ${round + 1} ${lastDetail}`)
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key|API_KEY/i.test(detail))) {
        throw new GeminiError(MESSAGES[kind].badKey, 400, lastDetail)
      }
      if (workingModel === model) workingModel = null
      if (res.status === 429) {
        sawQuota = true
        suggestedWait = Math.max(suggestedWait, retryDelayMs(err) ?? 0)
        continue // another model has its own quota
      }
      if (res.status === 404 || res.status === 400) { dead.add(model); continue }
      // 5xx: try the next model; this one comes round again next round.
    }
    // Every model refused this round: wait (as long as Google asked, growing each round) and go again.
    const backoff = Math.min(Math.max(suggestedWait, 2000 * 2 ** round), 30_000)
    if (Date.now() + backoff >= deadline) break
    await sleep(backoff)
  }
  const tail = `Tried ${[...tried].join(', ') || 'no models'}. Last reply: ${lastDetail || 'none'}`
  throw new GeminiError(sawQuota ? MESSAGES[kind].busy : MESSAGES[kind].failed, sawQuota ? 429 : 502, tail)
}

export async function askGeminiWithSearch(prompt: string): Promise<GroundedAnswer> {
  const { res } = await send('research', 'generateContent', {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4 },
  }, 120_000)
  const data = await res.json()
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim()
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'empty response'
    console.error(`[gemini] no answer: ${reason}`)
    throw new GeminiError('The research came back empty. Try again.', 502, `Empty answer (${reason}).`)
  }
  const meta = cand?.groundingMetadata ?? {}
  const raw = (meta.groundingChunks ?? [])
    .map((c: any) => ({ title: String(c?.web?.title ?? ''), url: String(c?.web?.uri ?? '') }))
    .filter((s: { url: string }) => /^https?:\/\//.test(s.url))
    .slice(0, 12)
  return { text, sources: await resolveSources(raw), queries: (meta.webSearchQueries ?? []).map(String).slice(0, 10) }
}

// Admin check from Settings: one tiny plain request and one tiny web-search request, since keys can
// have quota for one and not the other.
export async function testGemini() {
  const check = async (withSearch: boolean) => {
    try {
      const { res, model } = await send(withSearch ? 'research' : 'assistant', 'generateContent', {
        contents: [{ role: 'user', parts: [{ text: withSearch ? 'Search the web and reply with only the current year.' : 'Reply with only the word OK.' }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { maxOutputTokens: 20 },
      }, 30_000)
      await res.text()
      return { ok: true, model }
    } catch (err: any) {
      return { ok: false, error: err instanceof GeminiError ? err.detail || err.message : String(err?.message ?? err) }
    }
  }
  const assistant = await check(false)
  const research = await check(true)
  return { assistant, research }
}

// Grounding links point at Google's redirect service, which shows the provider and expires. Follow each one
// to the real page so users see (and keep) the actual source address. Ones that can't be resolved are dropped.
async function resolveSources(list: Array<{ title: string; url: string }>) {
  const resolved = await Promise.all(list.map(async s => {
    if (!/vertexaisearch\.cloud\.google\.com/.test(s.url)) return s
    try {
      const r = await fetch(s.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) })
      const to = r.headers.get('location')
      return to && /^https?:\/\//.test(to) ? { title: s.title, url: to } : null
    } catch {
      return null
    }
  }))
  const seen = new Set<string>()
  return resolved.filter((s): s is { title: string; url: string } => !!s && !seen.has(s.url) && !!seen.add(s.url))
}

// Search-grounded answers can't use a JSON response schema, so the prompt asks for JSON and this pulls it out.
export function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = fenced ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new GeminiError('The research result could not be read. Try again.', 502)
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new GeminiError('The research result could not be read. Try again.', 502, 'The reply was not valid JSON.')
  }
}

// Streaming chat for the in-app assistant: no web search, a system instruction, and the reply
// delivered piece by piece through `onText` as the model writes it.
export async function streamGeminiChat(
  system: string,
  turns: Array<{ role: 'user' | 'model'; text: string }>,
  onText: (text: string) => void,
) {
  const { res } = await send('assistant', 'streamGenerateContent?alt=sse', {
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map(t => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
  }, 60_000)
  if (!res.body) throw new GeminiError(MESSAGES.assistant.failed, 502, 'Streaming response had no body.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let wrote = false
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      try {
        const chunk = JSON.parse(line.slice(5))
        const text = (chunk?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
        if (text) { wrote = true; onText(text) }
      } catch { /* partial or keep-alive line */ }
    }
    if (done) break
  }
  if (!wrote) throw new GeminiError('The assistant came back empty. Try asking again.', 502)
}
