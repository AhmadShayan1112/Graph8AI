import { useState } from 'react'
import Sidebar from './components/Sidebar'
import LandingPage from './pages/LandingPage'
import DiscoverPage, { restoreDiscover } from './pages/DiscoverPage'
import AuditPage from './pages/AuditPage'
import BuildPage from './pages/BuildPage'
import OutreachPage from './pages/OutreachPage'
import SettingsPage from './pages/SettingsPage'
import SitesPage from './pages/SitesPage'
import UsersPage from './pages/UsersPage'
import HistoryPage from './pages/HistoryPage'
import LoginGate, { useSession } from './components/LoginGate'
import { logout, type SavedSearch } from './lib/api'
import type { Lead } from './types/lead'
import './App.css'

function App() {
  const [view, setView] = useState<'landing' | 'app'>('landing')

  if (view === 'landing') {
    return <LandingPage onEnterApp={() => setView('app')} />
  }

  return (
    <LoginGate>
      <Workspace onLanding={() => setView('landing')} />
    </LoginGate>
  )
}

// Rendered inside LoginGate so it can read the signed-in user's role and key access.
function Workspace({ onLanding }: { onLanding: () => void }) {
  const { user, refresh } = useSession()
  const [page, setPage] = useState('discover')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [mvpType, setMvpType] = useState('booking-page')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [siteUrl, setSiteUrl] = useState<string | undefined>()

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead)
    setSiteUrl(undefined)
    setPage('audit')
  }

  const handleOpenSearch = (s: SavedSearch) => {
    restoreDiscover(s.filters, s.total)
    setLeads(s.leads)
    setSelectedLead(null)
    setPage('discover')
  }

  const handleBuild = (type: string) => {
    setMvpType(type)
    setPage('build')
  }

  const handleOutreach = (url?: string) => {
    setSiteUrl(url)
    setPage('outreach')
  }

  const handleNavigate = (id: string) => {
    if (id === 'landing') { onLanding(); return }
    if (id === 'logout') { logout().finally(() => window.location.reload()); return }
    // Pick up any access change the admin made since the last page.
    refresh()
    setPage(id)
    setMobileMenuOpen(false)
  }

  const isAdmin = user.role === 'admin'

  return (
    <div className="app-layout">
      <button
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        <span /><span /><span />
      </button>

      <div className={`sidebar-wrapper ${mobileMenuOpen ? 'open' : ''}`}>
        <Sidebar
          active={page}
          onNavigate={handleNavigate}
          leadCount={leads.length}
        />
      </div>

      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      <main className="main-content">
        {page === 'discover' && (
          <DiscoverPage
            leads={leads}
            setLeads={setLeads}
            onSelectLead={handleSelectLead}
          />
        )}
        {page === 'audit' && selectedLead && (
          <AuditPage
            lead={selectedLead}
            onEnriched={enriched => {
              setSelectedLead(enriched)
              setLeads(ls => ls.map(l => (l.id === enriched.id ? enriched : l)))
            }}
            onBuild={handleBuild}
            onBack={() => setPage('discover')}
          />
        )}
        {page === 'build' && selectedLead && (
          <BuildPage
            lead={selectedLead}
            mvpType={mvpType}
            onOutreach={handleOutreach}
            onBack={() => setPage('audit')}
            onOpenSettings={isAdmin ? () => setPage('settings') : undefined}
          />
        )}
        {page === 'outreach' && selectedLead && (
          <OutreachPage
            lead={selectedLead}
            mvpType={mvpType}
            siteUrl={siteUrl}
            onBack={() => setPage('build')}
          />
        )}
        {page === 'pipeline' && <SitesPage />}
        {page === 'history' && <HistoryPage onOpen={handleOpenSearch} />}
        {page === 'settings' && isAdmin && <SettingsPage />}
        {page === 'users' && isAdmin && <UsersPage />}
      </main>
    </div>
  )
}

export default App
