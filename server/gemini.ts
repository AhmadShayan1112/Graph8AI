import { getGeminiKey } from './secrets.js'

// Gemini with Google Search grounding, so answers about a business come from what is on the web now.
// The model can be changed without a code change via GEMINI_MODEL.
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
  if (!key) throw new GeminiError('The Gemini API key is not set. The admin can add it in Settings.', 400)

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
    console.error(`[gemini] ${res.status}: ${detail}`)
    if (res.status === 400 && /api key/i.test(detail)) throw new GeminiError('Gemini rejected the API key. Check it in Settings.', 400)
    if (res.status === 401 || res.status === 403) throw new GeminiError('Gemini rejected the API key. Check it in Settings.', 400)
    if (res.status === 404) throw new GeminiError(`Gemini model "${MODEL()}" was not found. Set GEMINI_MODEL to a current model.`, 502)
    if (res.status === 429) throw new GeminiError('Gemini rate limit or quota reached. Wait a minute and try again.', 429)
    throw new GeminiError('Gemini could not complete the analysis. Try again shortly.', 502)
  }

  const data = await res.json()
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim()
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'empty response'
    throw new GeminiError(`Gemini returned no answer (${reason}). Try again.`, 502)
  }
  const meta = cand?.groundingMetadata ?? {}
  const seen = new Set<string>()
  const sources = (meta.groundingChunks ?? [])
    .map((c: any) => ({ title: String(c?.web?.title ?? ''), url: String(c?.web?.uri ?? '') }))
    .filter((s: { url: string }) => /^https?:\/\//.test(s.url) && !seen.has(s.url) && seen.add(s.url))
    .slice(0, 12)
  return { text, sources, queries: (meta.webSearchQueries ?? []).map(String).slice(0, 10) }
}

// Search-grounded answers can't use a JSON response schema, so the prompt asks for JSON and this pulls it out.
export function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = fenced ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new GeminiError('Gemini did not return a readable analysis. Try again.', 502)
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new GeminiError('Gemini did not return a readable analysis. Try again.', 502)
  }
}
