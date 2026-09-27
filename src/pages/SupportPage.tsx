import { useEffect, useState, type FC } from 'react'
import { listTickets, type TicketStatus, type TicketSummary } from '../lib/api'
import { TicketThread } from '../components/AssistantWidget'

const FILTERS: Array<{ key: TicketStatus | 'all'; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]
const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Waiting for you', answered: 'Answered', closed: 'Closed' }

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Admin inbox for requests people send with "Talk to a person" in the assistant.
const SupportPage: FC<{ onCountChange: () => void }> = ({ onCountChange }) => {
  const [filter, setFilter] = useState<TicketStatus | 'all'>('open')
  const [list, setList] = useState<TicketSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    listTickets(filter === 'all' ? undefined : filter).then(r => setList(r.tickets)).catch(err => setError(err.message))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [filter])

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">Support</h1>
          <div className="page-subtitle">Questions people sent from the assistant with “Talk to a person”. Replies appear in their assistant under My requests.</div>
        </div>
      </header>

      {error && <div className="settings-alert">{error}</div>}

      <div className="support-layout">
        <div className="support-list">
          <div className="auth-tabs support-filters" role="tablist">
            {FILTERS.map(f => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={`auth-tab ${filter === f.key ? 'active' : ''}`} onClick={() => { setFilter(f.key); setOpenId(null) }}>
                {f.label}
              </button>
            ))}
          </div>
          {!list && !error && <p className="text-muted pulse">Loading…</p>}
          {list && !list.length && <div className="an-empty">{filter === 'open' ? 'Nothing waiting. You are all caught up.' : 'No requests here.'}</div>}
          <ul className="assist-tickets">
            {list?.map(t => (
              <li key={t.id}>
                <button className={`assist-ticket ${t.unread ? 'unread' : ''} ${openId === t.id ? 'active' : ''}`} onClick={() => setOpenId(t.id)}>
                  <span className="assist-ticket-top">
                    <span className="assist-ticket-subject">{t.subject}</span>
                    <span className="assist-when">{ago(t.updatedAt)}</span>
                  </span>
                  <span className="assist-ticket-last">
                    <strong>{t.username}</strong>
                    {t.lastMessage && <> · {t.lastMessage.from === 'admin' ? 'You: ' : ''}{t.lastMessage.text}</>}
                  </span>
                  <span className={`assist-status ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="support-thread">
          {openId
            ? <TicketThread key={openId} id={openId} asAdmin onBack={() => { setOpenId(null); load(); onCountChange() }} />
            : <div className="an-empty support-empty">Select a request to read it and reply.</div>}
        </div>
      </div>
    </div>
  )
}

export default SupportPage
