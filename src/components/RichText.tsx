import { type FC, type ReactNode } from 'react'

// A small, safe subset of Markdown for assistant replies: paragraphs, bullet and numbered lists, **bold**,
// `code` and [links](...). Everything becomes React elements, so no HTML from the model is ever injected.
// Links to app routes (#/page) navigate inside the app; web links open in a new tab.

function inline(text: string, onRoute: (hash: string) => void, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${i++}`
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>)
    else if (m[2]) out.push(<code key={key}>{m[2]}</code>)
    else if (m[3]) {
      const href = m[4]
      if (href.startsWith('#/')) {
        out.push(<a key={key} href={href} onClick={e => { e.preventDefault(); onRoute(href) }}>{m[3]}</a>)
      } else if (/^https?:\/\//.test(href)) {
        out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer">{m[3]}</a>)
      } else {
        out.push(m[3])
      }
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const RichText: FC<{ text: string; onRoute: (hash: string) => void }> = ({ text, onRoute }) => {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), onRoute, `p${blocks.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, n) => <li key={n}>{inline(it, onRoute, `l${blocks.length}-${n}`)}</li>)
    blocks.push(list.ordered ? <ol key={`o${blocks.length}`}>{items}</ol> : <ul key={`u${blocks.length}`}>{items}</ul>)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (!line) { flushPara(); flushList(); continue }
    if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()
    if (heading) { flushPara(); blocks.push(<p key={`h${blocks.length}`}><strong>{heading[1]}</strong></p>); continue }
    para.push(line)
  }
  flushPara()
  flushList()
  return <div className="rich">{blocks}</div>
}

export default RichText
