import { getGeminiKey } from './secrets.js'

// Gemini with Google Search grounding, so answers about a business come from what is on the web now.
// The model can be changed without a code change via GEMINI_MODEL.
// Users never see which provider does the research: every message below is provider-neutral, and the
// specifics (status, model, reason) go to the server log for the admin.
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export interface GroundedAnswer {
  text: string
  sources: Array<{ title: string; url: string }>
  queries: string[]
}

export async function askGeminiWithSearch(prompt: string): Promise<GroundedAnswer> {
  const key = await getGeminiKey()
  if (!key) throw new GeminiError('Gap analysis is not set up yet. Ask the admin to add the research API key in Settings.', 400)

  const res = await fetch(`${BASE}/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = String(body?.error?.message ?? res.statusText).slice(0, 300)
    console.error(`[gemini] ${res.status} (model ${MODEL()}): ${detail}`)
    if ((res.status === 400 && /api key/i.test(detail)) || res.status === 401 || res.status === 403) {
      throw new GeminiError('The research API key was rejected. Ask the admin to check it in Settings.', 400)
    }
    if (res.status === 404) throw new GeminiError('Gap analysis is misconfigured on the server. Ask the admin to check the server log.', 502)
    if (res.status === 429) throw new GeminiError('Too many research requests right now. Wait a minute and try again.', 429)
    throw new GeminiError('The research could not be completed. Try again shortly.', 502)
  }

  const data = await res.json()
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim()
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'empty response'
    console.error(`[gemini] no answer: ${reason}`)
    throw new GeminiError('The research came back empty. Try again.', 502)
  }
  const meta = cand?.groundingMetadata ?? {}
  const raw = (meta.groundingChunks ?? [])
    .map((c: any) => ({ title: String(c?.web?.title ?? ''), url: String(c?.web?.uri ?? '') }))
    .filter((s: { url: string }) => /^https?:\/\//.test(s.url))
    .slice(0, 12)
  return { text, sources: await resolveSources(raw), queries: (meta.webSearchQueries ?? []).map(String).slice(0, 10) }
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
    throw new GeminiError('The research result could not be read. Try again.', 502)
  }
}

// Streaming chat for the in-app assistant: no web search, a system instruction, and the reply
// delivered piece by piece through `onText` as the model writes it.
export async function streamGeminiChat(
  system: string,
  turns: Array<{ role: 'user' | 'model'; text: string }>,
  onText: (text: string) => void,
) {
  const key = await getGeminiKey()
  if (!key) throw new GeminiError('The assistant is not set up yet. Ask the admin to add the research API key in Settings.', 400)

  const res = await fetch(`${BASE}/models/${encodeURIComponent(MODEL())}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map(t => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    console.error(`[assistant] ${res.status} (model ${MODEL()}): ${String(body?.error?.message ?? res.statusText).slice(0, 300)}`)
    if (res.status === 401 || res.status === 403 || res.status === 400) throw new GeminiError('The assistant is not available right now. Ask the admin to check the research API key.', 502)
    if (res.status === 429) throw new GeminiError('The assistant is busy. Wait a minute and try again.', 429)
    throw new GeminiError('The assistant could not answer right now. Try again shortly.', 502)
  }

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
