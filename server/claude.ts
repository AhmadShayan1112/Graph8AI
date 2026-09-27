import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { getClaudeToken } from './secrets.js'

export class ClaudeNotConfiguredError extends Error {}

// Vercel caps a function at 250 MB, and Claude Code's native Linux binary alone is ~240 MB, so it is
// excluded from the bundle (vercel.json) and fetched into /tmp on first use, pinned and integrity-checked.
// Keep these in sync with the @anthropic-ai/claude-agent-sdk version in package.json
// (`npm view @anthropic-ai/claude-agent-sdk-linux-x64@<version> dist.integrity`).
const LINUX_BINARY = {
  version: '0.3.283',
  integrity: 'sha512-cE5AebMvTlq7t7Oc0FmP5LzMOEtJ3F8XRGxkc3kTGr4aNcQgXplyYNH2yu1teW1yInuMXHzlCeFRdrmxpe2sRg==',
}

let binaryPromise: Promise<string> | null = null

function ensureLinuxBinary() {
  binaryPromise ??= downloadLinuxBinary().catch(err => { binaryPromise = null; throw err })
  return binaryPromise
}

async function downloadLinuxBinary() {
  const dir = path.join(tmpdir(), 'gapwise-claude-bin')
  const bin = path.join(dir, `claude-${LINUX_BINARY.version}`)
  if (await stat(bin).then(s => s.size > 0, () => false)) return bin

  const url = `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-${LINUX_BINARY.version}.tgz`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Claude Code binary download failed (${res.status})`)
  const tgz = Buffer.from(await res.arrayBuffer())
  if (`sha512-${createHash('sha512').update(tgz).digest('base64')}` !== LINUX_BINARY.integrity) {
    throw new Error('Claude Code binary failed its integrity check')
  }

  const tar = gunzipSync(tgz)
  for (let off = 0; off + 512 <= tar.length;) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/s, '')
    if (!name) break
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/s, '').trim() || '0', 8)
    if (name === 'package/claude') {
      await mkdir(dir, { recursive: true })
      const tmp = `${bin}.${process.pid}.partial`
      await writeFile(tmp, tar.subarray(off + 512, off + 512 + size))
      await chmod(tmp, 0o755)
      await rename(tmp, bin)
      return bin
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error('Claude Code binary missing from package')
}

// Models are Claude Code aliases, so they follow the newest model the token can use. Planning is short and
// structured (sonnet); building the site is the long, quality-sensitive step (opus). Both can be overridden.
export const PLAN_MODEL = () => process.env.MVP_PLAN_MODEL || 'sonnet'
export const BUILD_MODEL = () => process.env.MVP_BUILD_MODEL || 'opus'

export function extractHtml(text: string) {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1] ?? text
  const start = fenced.search(/<!doctype html|<html/i)
  const end = fenced.toLowerCase().lastIndexOf('</html>')
  if (start < 0 || end < 0) throw new Error('Claude did not return an HTML document')
  return fenced.slice(start, end + '</html>'.length)
}

// `env` replaces the subprocess environment entirely: the token goes only to that one child process,
// and none of the server's own secrets (MONGODB_URI, GAPWISE_SECRET, ADMIN_PASSWORD) are passed along.
async function claudeEnv(token: string) {
  const home = path.join(tmpdir(), 'gapwise-claude-home')
  await mkdir(home, { recursive: true })
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'gapwise/1.0.0',
    // `claude setup-token` tokens authenticate as CLAUDE_CODE_OAUTH_TOKEN; Console API keys also work.
    [token.startsWith('sk-ant-api') ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN']: token,
  }
  return { home, env }
}

// One Claude run (single turn, no tools) with the saved token, in an isolated subprocess.
// `onChars` receives the running length of the reply as it is written, for real progress.
export async function runClaude(opts: { system: string; prompt: string; model: string; onChars?: (chars: number) => void }) {
  const token = await getClaudeToken()
  if (!token) throw new ClaudeNotConfiguredError('Add your Claude token in Settings to generate MVPs.')

  const { home, env } = await claudeEnv(token)

  let result = ''
  let written = 0
  try {
    for await (const msg of query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        systemPrompt: opts.system,
        tools: [],
        maxTurns: 1,
        settingSources: [],
        persistSession: false,
        includePartialMessages: !!opts.onChars,
        cwd: home,
        env,
        pathToClaudeCodeExecutable: process.env.VERCEL ? await ensureLinuxBinary() : undefined,
      },
    })) {
      const m = msg as any
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
        written += String(m.event.delta.text ?? '').length
        opts.onChars?.(written)
      }
      if (msg.type === 'result') {
        if (msg.subtype !== 'success' || msg.is_error) {
          throw new Error(`Claude run failed (${msg.subtype}): ${msg.subtype === 'success' ? msg.result.slice(0, 300) : ''}`)
        }
        result = msg.result
      }
    }
  } catch (err) {
    // Scrub before the message can reach a log line.
    const msg = (err instanceof Error ? err.message : String(err)).split(token).join('[redacted]')
    throw new Error(msg)
  }
  return result
}

// Errors from the Claude subprocess can echo its environment; never forward their text to the browser.
export function publicClaudeError(err: unknown) {
  if (err instanceof ClaudeNotConfiguredError) return { status: 400, error: err.message }
  const msg = err instanceof Error ? err.message : ''
  if (/401|403|auth|token|credential|login/i.test(msg)) {
    return { status: 502, error: 'Claude rejected the saved token. Replace it in Settings.' }
  }
  return { status: 502, error: 'MVP generation failed. Try again.' }
}

export interface AgentActivity { action: string; chars: number }

// Claude Code as a working agent, the way AI site builders run it on a server: a fresh, empty workspace per
// job, file tools only (read / write / edit inside that folder; no shell, no web), a few turns to write, review
// and fix, and a hard deadline under Vercel's limit. Returns the contents of `file` from the workspace.
export async function runClaudeAgent(opts: {
  system: string
  prompt: string
  model: string
  file: string
  maxTurns?: number
  deadlineMs?: number
  onActivity?: (a: AgentActivity) => void
  // Files to place in the workspace before the agent starts (e.g. the app built so far).
  seed?: Record<string, string>
}) {
  const token = await getClaudeToken()
  if (!token) throw new ClaudeNotConfiguredError('Add your Claude token in Settings to generate MVPs.')
  const { env } = await claudeEnv(token)
  const workdir = path.join(tmpdir(), 'gapwise-build', randomUUID())
  await mkdir(workdir, { recursive: true })
  for (const [name, content] of Object.entries(opts.seed ?? {})) await writeFile(path.join(workdir, name), content)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), opts.deadlineMs ?? 270_000)
  let chars = 0
  let action = 'Starting'
  const report = () => opts.onActivity?.({ action, chars })
  let failure: Error | null = null
  try {
    for await (const msg of query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        systemPrompt: opts.system,
        tools: ['Read', 'Write', 'Edit'],
        allowedTools: ['Read', 'Write', 'Edit'],
        disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'Task'],
        permissionMode: 'acceptEdits',
        maxTurns: opts.maxTurns ?? 8,
        settingSources: [],
        persistSession: false,
        includePartialMessages: true,
        abortController: abort,
        cwd: workdir,
        env,
        pathToClaudeCodeExecutable: process.env.VERCEL ? await ensureLinuxBinary() : undefined,
      },
    })) {
      const m = msg as any
      if (m.type === 'stream_event') {
        const d = m.event?.delta
        if (m.event?.type === 'content_block_start' && m.event.content_block?.type === 'tool_use') {
          const tool = String(m.event.content_block.name)
          action = tool === 'Write' ? `Writing ${opts.file}` : tool === 'Read' ? 'Reading the app' : tool === 'Edit' ? 'Editing the app' : tool
          report()
        }
        if (d?.type === 'input_json_delta' || d?.type === 'text_delta') {
          chars += String(d.partial_json ?? d.text ?? '').length
          report()
        }
      }
      if (msg.type === 'result' && (msg.subtype !== 'success' || msg.is_error)) {
        // Running out of turns after the file is written is fine; the file is what we need.
        if (msg.subtype !== 'error_max_turns') failure = new Error(`Claude run failed (${msg.subtype})`)
      }
    }
  } catch (err) {
    // A deadline abort still leaves whatever the agent wrote; anything else is a real failure.
    if (!abort.signal.aborted) failure = new Error((err instanceof Error ? err.message : String(err)).split(token).join('[redacted]'))
  } finally {
    clearTimeout(timer)
  }
  try {
    const content = await readFile(path.join(workdir, opts.file), 'utf8').catch(() => '')
    if (content) return content
    throw failure ?? new Error(`The agent did not write ${opts.file}`)
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {})
  }
}
