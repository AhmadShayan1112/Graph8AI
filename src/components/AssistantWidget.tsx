import { useEffect, useRef, useState, type FC, type FormEvent, type KeyboardEvent } from 'react'
import {
  askAssistant, createTicket, getSupportSummary, getTicket, listTickets, replyToTicket, setTicketStatus,
  type ChatMessage, type Ticket, type TicketSummary,
} from '../lib/api'
import { useSession } from './LoginGate'
import RichText from './RichText'
import { LogoMark } from './Logo'

interface Props {
  page: string
  onRoute: (hash: string) => void
}

const STORE = 'gapwise:assistant'

// Starting questions that fit the page the person is on.
const SUGGESTIONS: Record<string, string[]> = {
  dashboard: ['Where do I start?', 'What does the fit score mean?', 'How do I get more leads?'],
  campaigns: ['How do I create a campaign?', 'How do I find leads for a campaign?', 'What happens when I delete a campaign?'],
  discover: ['How do I search for leads?', 'What do the filters do?', 'Why do I see no results?'],
  gaps: ['How does gap analysis work?', 'How do I analyse all leads?', 'How should I use the prospect profile?'],
  analysis: ['What does the market analysis show?', 'How do I refresh the numbers?'],
  audit: ['What does the audit show?', 'How do I find the decision maker’s email?'],
  build: ['How do I build and deploy an MVP?', 'Which MVP type should I pick?'],
  outreach: ['How should I write the first email?', 'When should I follow up?'],
  users: ['How do I turn tools on for a user?', 'What does “for everyone” do?'],
  settings: ['Which keys do I need?', 'What happens if I delete a key?'],
}
const DEFAULT_SUGGESTIONS = ['How does Gapwise work?', 'Where do I start?', 'How do I run a gap analysis?']

const STATUS_LABEL: Record<string, string> = { open: 'Waiting for reply', answered: 'Answered', closed: 'Closed' }

function loadChat(): ChatMessage[] {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '[]') } catch { return [] }
}

const AssistantWidget: FC<Props> = ({ page, onRoute }) => {
  const { user } = useSession()
  // The admin is the human support, so they answer on the Support page rather than opening requests here.
  const isAdmin = user.role === 'admin'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'requests'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [handoff, setHandoff] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40))) } catch { /* ignore */ }
  }, [messages])

  // Replies from the admin: check now and every minute so the badge shows up without a refresh.
  useEffect(() => {
    if (user.role === 'admin') return
    const check = () => getSupportSummary().then(r => setUnread(r.waiting)).catch(() => {})
    check()
    const t = setInterval(check, 60_000)
    return () => clearInterval(t)
  }, [user.role])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, open, tab, handoff])

  useEffect(() => {
    if (open && tab === 'chat' && handoff === null) inputRef.current?.focus()
  }, [open, tab, handoff])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setError('')
    setInput('')
    const history: ChatMessage[] = [...messages, { role: 'user', content: q }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await askAssistant(history, page, piece => {
        setMessages(m => {
          const next = [...m]
          next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + piece }
          return next
        })
      }, ctrl.signal)
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message)
      // Drop an empty reply bubble; keep whatever did arrive.
      setMessages(m => (m[m.length - 1]?.content ? m : m.slice(0, -1)))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); send(input) }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const newChat = () => {
    abortRef.current?.abort()
    setMessages([])
    setError('')
    setHandoff(null)
  }

  const startHandoff = () => {
    const lastQuestion = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
    setHandoff(lastQuestion)
    setTab('chat')
  }

  const route = (hash: string) => {
    onRoute(hash)
    // On phones the panel covers the page, so close it to show where the link went.
    if (window.matchMedia('(max-width: 600px)').matches) setOpen(false)
  }

  const suggestions = SUGGESTIONS[page] ?? DEFAULT_SUGGESTIONS

  return (
    <>
      <button
        className={`assist-launcher ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close the assistant' : 'Open the Gapwise assistant'}
        aria-expanded={open}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 3 13.5" />
            <path d="M8.5 9.5h7M8.5 12.5h4" />
          </svg>
        )}
        {!open && unread > 0 && <span className="assist-badge" aria-label={`${unread} new replies`}>{unread}</span>}
      </button>

      {open && (
        <section className="assist-panel" role="dialog" aria-label="Gapwise assistant">
          <header className="assist-head">
            <LogoMark size={28} />
            <div className="assist-head-text">
              <div className="assist-title">Gapwise assistant</div>
              <div className="assist-sub">Answers about using Gapwise</div>
            </div>
            <button className="assist-icon-btn" onClick={newChat} title="Start a new chat" aria-label="Start a new chat">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button className="assist-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>

          {isAdmin ? (
            <div className="assist-tabs">
              <span className="assist-note">Requests from users are on the <a href="#/support" onClick={e => { e.preventDefault(); route('#/support') }}>Support</a> page.</span>
            </div>
          ) : (
            <div className="assist-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Assistant</button>
              <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => { setTab('requests'); setHandoff(null) }}>
                My requests{unread > 0 && <span className="assist-tab-dot" />}
              </button>
              {tab === 'chat' && handoff === null && (
                <button className="assist-human" onClick={startHandoff}>Talk to a person</button>
              )}
            </div>
          )}

          {tab === 'chat' && handoff === null && (
            <>
              <div className="assist-body" ref={listRef} aria-live="polite">
                {!messages.length && (
                  <div className="assist-welcome">
                    <p>Hi {user.username}, I can help you find leads, run gap analysis, build MVPs and write outreach. What would you like to do?</p>
                    <div className="assist-chips">
                      {suggestions.map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`assist-msg ${m.role}`}>
                    {m.role === 'assistant'
                      ? (m.content ? <RichText text={m.content} onRoute={route} /> : <span className="assist-typing" aria-label="Writing"><i /><i /><i /></span>)
                      : m.content}
                  </div>
                ))}
                {error && (
                  <div className="assist-error">
                    {error} {!isAdmin && <button className="dash-link" onClick={startHandoff}>Ask a person instead</button>}
                  </div>
                )}
              </div>
              <form className="assist-input" onSubmit={submit}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  maxLength={2000}
                  placeholder="Ask how to do something…"
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label="Your question"
                />
                {busy ? (
                  <button type="button" className="assist-send" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                  </button>
                ) : (
                  <button type="submit" className="assist-send" disabled={!input.trim()} aria-label="Send">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                )}
              </form>
            </>
          )}

          {tab === 'chat' && handoff !== null && (
            <Handoff
              initial={handoff}
              transcript={messages}
              page={page}
              onCancel={() => setHandoff(null)}
              onSent={() => { setHandoff(null); setTab('requests') }}
            />
          )}

          {tab === 'requests' && <Requests onUnreadChange={setUnread} />}
        </section>
      )}
    </>
  )
}

const Handoff: FC<{
  initial: string
  transcript: ChatMessage[]
  page: string
  onCancel: () => void
  onSent: () => void
}> = ({ initial, transcript, page, onCancel, onSent }) => {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await createTicket(text, transcript, page)
      onSent()
    } catch (err: any) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="assist-body assist-handoff" onSubmit={submit}>
      <div className="assist-handoff-title">Talk to a person</div>
      <p className="assist-note">
        Your message goes to the Gapwise admin{transcript.length ? ', with this chat so you don’t have to repeat yourself' : ''}.
        Their reply will appear under <strong>My requests</strong>.
      </p>
      <label className="auth-field">
        <span className="settings-card-label">What do you need help with?</span>
        <textarea className="input assist-textarea" value={text} maxLength={4000} onChange={e => setText(e.target.value)} autoFocus rows={5} />
      </label>
      {error && <div className="settings-message bad">{error}</div>}
      <div className="assist-handoff-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Back to chat</button>
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send to support'}</button>
      </div>
    </form>
  )
}

const Requests: FC<{ onUnreadChange: (n: number) => void }> = ({ onUnreadChange }) => {
  const [list, setList] = useState<TicketSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = () => listTickets().then(r => {
    setList(r.tickets)
    onUnreadChange(r.tickets.filter(t => t.unread).length)
  }).catch(err => setError(err.message))

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  if (openId) return <TicketThread id={openId} onBack={() => { setOpenId(null); load() }} />

  return (
    <div className="assist-body">
      {error && <div className="assist-error">{error}</div>}
      {!list && !error && <p className="assist-note pulse">Loading…</p>}
      {list && !list.length && (
        <div className="assist-welcome">
          <p>No requests yet. Use <strong>Talk to a person</strong> in the Assistant tab whenever you want help from the Gapwise team.</p>
        </div>
      )}
      <ul className="assist-tickets">
        {list?.map(t => (
          <li key={t.id}>
            <button className={`assist-ticket ${t.unread ? 'unread' : ''}`} onClick={() => setOpenId(t.id)}>
              <span className="assist-ticket-top">
                <span className="assist-ticket-subject">{t.subject}</span>
                <span className={`assist-status ${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </span>
              {t.lastMessage && (
                <span className="assist-ticket-last">
                  {t.lastMessage.from === 'admin' ? 'Support: ' : 'You: '}{t.lastMessage.text}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const TicketThread: FC<{ id: string; onBack: () => void; asAdmin?: boolean }> = ({ id, onBack, asAdmin }) => {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showChat, setShowChat] = useState(false)

  useEffect(() => { getTicket(id).then(r => setTicket(r.ticket)).catch(err => setError(err.message)) }, [id])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = await replyToTicket(id, reply)
      setTicket(r.ticket)
      setReply('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleStatus = async () => {
    if (!ticket) return
    setBusy(true)
    try {
      setTicket((await setTicketStatus(id, ticket.status === 'closed' ? 'open' : 'closed')).ticket)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="assist-body assist-thread">
      <div className="assist-thread-top">
        <button className="dash-link" onClick={onBack}>← {asAdmin ? 'All requests' : 'My requests'}</button>
        {ticket && (
          <button className="dash-link" onClick={toggleStatus} disabled={busy}>
            {ticket.status === 'closed' ? 'Reopen' : 'Close request'}
          </button>
        )}
      </div>
      {error && <div className="assist-error">{error}</div>}
      {!ticket && !error && <p className="assist-note pulse">Loading…</p>}
      {ticket && (
        <>
          <div className="assist-thread-head">
            <div className="assist-handoff-title">{ticket.subject}</div>
            <div className="assist-note">
              {asAdmin && <>From <strong>{ticket.username}</strong>{ticket.page && <> on the {ticket.page} page</>}, </>}
              opened {new Date(ticket.createdAt).toLocaleString()} · <span className={`assist-status ${ticket.status}`}>{STATUS_LABEL[ticket.status]}</span>
            </div>
          </div>
          {ticket.transcript.length > 0 && (
            <div className="assist-transcript">
              <button className="dash-link" onClick={() => setShowChat(s => !s)}>
                {showChat ? 'Hide' : 'Show'} the assistant chat before this request ({ticket.transcript.length} messages)
              </button>
              {showChat && ticket.transcript.map((m, i) => (
                <div key={i} className={`assist-msg small ${m.role}`}>{m.content}</div>
              ))}
            </div>
          )}
          {ticket.messages.map((m, i) => (
            <div key={i} className={`assist-msg ${(m.from === 'admin') === !!asAdmin ? 'user' : 'assistant'} human`}>
              <div className="assist-msg-meta">{m.name} · {new Date(m.at).toLocaleString()}</div>
              {m.text}
            </div>
          ))}
          <form className="assist-reply" onSubmit={send}>
            <textarea
              className="input assist-textarea"
              rows={3}
              value={reply}
              maxLength={4000}
              placeholder={asAdmin ? `Reply to ${ticket.username}…` : 'Add a message…'}
              onChange={e => setReply(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        </>
      )}
    </div>
  )
}

export default AssistantWidget
