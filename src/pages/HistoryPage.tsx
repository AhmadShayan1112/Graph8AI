import { useEffect, useState, type FC } from 'react'
import { deleteSearch, getSearch, listSearches, type SavedSearch, type SavedSearchSummary } from '../lib/api'
import { useSession } from '../components/LoginGate'
import { confirmDialog } from '../components/Dialog'

function describe(s: SavedSearchSummary) {
  const f = s.filters
  const what = f.industries?.join(', ') || 'Any industry'
  const where = f.locations?.map(l => l.value).join(', ')
  return s.prompt || (where ? `${what} in ${where}` : what)
}

function chips(s: SavedSearchSummary) {
  const f = s.filters
  const out: string[] = []
  f.industries?.forEach(x => out.push(x))
  f.locations?.forEach(l => out.push(l.field ? `${l.value} · ${l.field}` : l.value))
  f.keywords?.forEach(x => out.push(`“${x}”`))
  if (f.employees?.length) out.push(`${f.employees.join(', ')} employees`)
  if (f.revenue?.length) out.push(`${f.revenue.length} revenue band${f.revenue.length > 1 ? 's' : ''}`)
  if (f.foundedFrom || f.foundedTo) out.push(`Founded ${f.foundedFrom ?? '…'}–${f.foundedTo ?? '…'}`)
  if (f.website === 'none') out.push('No website')
  if (f.website === 'has') out.push('Has website')
  if (f.hasPhone) out.push('Has phone')
  return out
}

const HistoryPage: FC<{ onOpen: (s: SavedSearch) => void }> = ({ onOpen }) => {
  const { user } = useSession()
  const isAdmin = user.role === 'admin'
  const [searches, setSearches] = useState<SavedSearchSummary[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [who, setWho] = useState<'mine' | 'all'>('mine')
  const [query, setQuery] = useState('')

  useEffect(() => {
    listSearches().then(r => setSearches(r.searches)).catch(err => setError(err.message))
  }, [])

  const open = async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      onOpen((await getSearch(id)).search)
    } catch (err: any) {
      setError(err.message)
      setBusyId(null)
    }
  }

  const remove = async (s: SavedSearchSummary) => {
    if (!(await confirmDialog({
      title: 'Delete this saved search?',
      message: `“${describe(s)}” and its saved results are removed from History. Leads already saved to a campaign stay there.`,
      confirmLabel: 'Delete search',
      tone: 'danger',
    }))) return
    setBusyId(s.id)
    setError('')
    try {
      await deleteSearch(s.id)
      setSearches(list => list?.filter(x => x.id !== s.id) ?? null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const q = query.trim().toLowerCase()
  const shown = (searches ?? [])
    .filter(s => !isAdmin || who === 'all' || s.mine)
    .filter(s => !q || `${describe(s)} ${chips(s).join(' ')} ${s.username}`.toLowerCase().includes(q))

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Saved</div>
          <h1 className="page-title">Search history</h1>
          <div className="page-subtitle">
            Every lead search is saved with its results. Open one to pick up where you left off, without searching again.
          </div>
        </div>
      </header>

      {error && <div className="settings-alert access-note">{error}</div>}

      <div className="history-toolbar">
        <input
          className="input history-search"
          placeholder="Filter by industry, place or keyword"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {isAdmin && (
          <div className="auth-tabs history-scope" role="tablist">
            <button type="button" role="tab" aria-selected={who === 'mine'} className={`auth-tab ${who === 'mine' ? 'active' : ''}`} onClick={() => setWho('mine')}>Mine</button>
            <button type="button" role="tab" aria-selected={who === 'all'} className={`auth-tab ${who === 'all' ? 'active' : ''}`} onClick={() => setWho('all')}>Everyone</button>
          </div>
        )}
      </div>

      {!searches && !error && <p className="text-muted"><span className="pulse">Loading…</span></p>}
      {searches && !shown.length && (
        <p className="text-muted">
          {searches.length ? 'No saved searches match.' : 'No searches yet. Run one on Discover and it will show up here.'}
        </p>
      )}

      <div className="settings-list">
        {shown.map((s, i) => (
          <div key={s.id} className="settings-card history-card fade-in" style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
            <div className="settings-card-head">
              <span className="settings-card-label">{describe(s)}</span>
              <span className="settings-badge ok">{s.leadCount} leads</span>
            </div>
            {s.campaignId && <div className="settings-card-help">Saved in a campaign</div>}
            {chips(s).length > 0 && (
              <div className="history-chips">
                {chips(s).map((c, j) => <span key={j} className="active-chip">{c}</span>)}
              </div>
            )}
            <div className="history-foot">
              <span className="text-muted">
                {new Date(s.createdAt).toLocaleString()} · {s.total.toLocaleString()} matches
                {!s.mine && <> · by <strong>{s.username}</strong></>}
              </span>
              <div className="user-actions">
                <button className="btn-primary" disabled={!!busyId} onClick={() => open(s.id)}>
                  {busyId === s.id ? 'Opening…' : 'Open results'}
                </button>
                <button className="btn-secondary btn-danger" disabled={!!busyId} onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default HistoryPage
