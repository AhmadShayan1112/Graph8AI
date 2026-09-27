import { useEffect, useState } from 'react'
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
import CampaignsPage from './pages/CampaignsPage'
import LoginGate, { useSession } from './components/LoginGate'
import { EMPTY_FILTERS, logout, saveCampaignLead, type Campaign, type SavedSearch } from './lib/api'
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
  // Work starts from a campaign.
  const [page, setPage] = useState('campaigns')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [mvpType, setMvpType] = useState('booking-page')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [siteUrl, setSiteUrl] = useState<string | undefined>()
  // The campaign the user is working in: Discover files searches under it, Audit saves enrichment to it.
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null)
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null)

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead)
    setSiteUrl(undefined)
    setPage('audit')
  }

  const handleOpenSearch = (s: SavedSearch, campaign: Campaign | null = null) => {
    restoreDiscover(s.filters, s.total)
    setActiveCampaign(campaign)
    setLeads(s.leads)
    setSelectedLead(null)
    setPage('discover')
  }

  const handleCampaignSearch = (c: Campaign) => {
    restoreDiscover({ ...EMPTY_FILTERS, industries: c.target.industries, locations: c.target.locations }, null)
    setActiveCampaign(c)
    setLeads([])
    setSelectedLead(null)
    setPage('discover')
  }

  const handleCampaignLead = (c: Campaign, lead: Lead) => {
    setActiveCampaign(c)
    handleSelectLead(lead)
  }

  const openCampaign = (id: string | null) => {
    setOpenCampaignId(id)
    setPage('campaigns')
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
    // The Campaigns menu item always lands on the list.
    if (id === 'campaigns') setOpenCampaignId(null)
    setPage(id)
    setMobileMenuOpen(false)
  }

  const isAdmin = user.role === 'admin'

  // Stop the page behind the open mobile menu from scrolling.
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  return (
    <div className="app-layout">
      <header className="mobile-topbar">
        <button
          className={`mobile-menu-toggle ${mobileMenuOpen ? 'open' : ''}`}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <span /><span /><span />
        </button>
        <div className="sidebar-brand mobile-topbar-brand">
          <div className="sidebar-logo"><div className="sidebar-logo-dot" /></div>
          <div className="sidebar-name">Gapwise</div>
        </div>
        <span className="mobile-topbar-user">{user.username}</span>
      </header>

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
            campaign={activeCampaign}
            onOpenCampaign={openCampaign}
            onLeaveCampaign={() => setActiveCampaign(null)}
          />
        )}
        {page === 'audit' && selectedLead && (
          <AuditPage
            lead={selectedLead}
            onEnriched={enriched => {
              setSelectedLead(enriched)
              setLeads(ls => ls.map(l => (l.id === enriched.id ? enriched : l)))
              // Keep the enrichment in the campaign so the lookups aren't paid for twice.
              if (activeCampaign) saveCampaignLead(activeCampaign.id, enriched).catch(() => {})
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
        {page === 'history' && <HistoryPage onOpen={s => handleOpenSearch(s)} />}
        {page === 'campaigns' && (
          <CampaignsPage
            openId={openCampaignId}
            onOpenId={setOpenCampaignId}
            onSearch={handleCampaignSearch}
            onOpenLead={handleCampaignLead}
            onOpenSearch={(c, s) => handleOpenSearch(s, c)}
            onDeleted={id => { if (activeCampaign?.id === id) setActiveCampaign(null) }}
          />
        )}
        {page === 'settings' && isAdmin && <SettingsPage />}
        {page === 'users' && isAdmin && <UsersPage />}
      </main>
    </div>
  )
}

export default App
