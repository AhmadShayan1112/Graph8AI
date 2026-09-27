import { useEffect, useRef, useState } from 'react'
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
import AnalysisPage from './pages/AnalysisPage'
import GapAnalysisPage from './pages/GapAnalysisPage'
import LoginGate, { useSession } from './components/LoginGate'
import { LogoMark } from './components/Logo'
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
      <Workspace />
    </LoginGate>
  )
}

// Rendered inside LoginGate so it can read the signed-in user's role and key access.
function Workspace() {
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
  const [analysisCampaignId, setAnalysisCampaignId] = useState<string | null>(null)
  const [gapCampaignId, setGapCampaignId] = useState<string | null>(null)

  // Pages visited, so Back can return to the previous one.
  const history = useRef<string[]>([])
  const previous = useRef(page)
  const goingBack = useRef(false)
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    if (goingBack.current) goingBack.current = false
    else if (previous.current !== page) history.current = [...history.current, previous.current].slice(-50)
    previous.current = page
    setCanGoBack(history.current.length > 0)
  }, [page])

  const goBack = () => {
    // Skip lead pages whose lead is no longer selected; they would render empty.
    const needsLead = new Set(['audit', 'build', 'outreach'])
    let target: string | undefined
    while ((target = history.current.pop()) && needsLead.has(target) && !selectedLead) { /* skip */ }
    setCanGoBack(history.current.length > 0)
    if (!target) return
    goingBack.current = true
    setPage(target)
    setMobileMenuOpen(false)
  }

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

  const openAnalysis = (id: string) => {
    setAnalysisCampaignId(id)
    setPage('analysis')
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
    if (id === 'back') { goBack(); return }
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
          <LogoMark size={26} />
          <div className="sidebar-name">Gapwise</div>
        </div>
        <span className="mobile-topbar-user">{user.username}</span>
      </header>

      <div className={`sidebar-wrapper ${mobileMenuOpen ? 'open' : ''}`}>
        <Sidebar
          active={page}
          onNavigate={handleNavigate}
          leadCount={leads.length}
          canGoBack={canGoBack}
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
        {page === 'analysis' && (
          <AnalysisPage
            campaignId={analysisCampaignId}
            onCampaignId={setAnalysisCampaignId}
            onOpenCampaign={id => openCampaign(id)}
            onNewCampaign={() => openCampaign(null)}
          />
        )}
        {page === 'gaps' && (
          <GapAnalysisPage
            campaignId={gapCampaignId}
            onCampaignId={setGapCampaignId}
            onAudit={handleCampaignLead}
            onBuild={(c, lead, offer) => {
              setActiveCampaign(c)
              setSelectedLead(lead)
              setSiteUrl(undefined)
              setMvpType(offer)
              setPage('build')
            }}
            onNewCampaign={() => openCampaign(null)}
          />
        )}
        {page === 'campaigns' && (
          <CampaignsPage
            openId={openCampaignId}
            onOpenId={setOpenCampaignId}
            onSearch={handleCampaignSearch}
            onOpenLead={handleCampaignLead}
            onOpenSearch={(c, s) => handleOpenSearch(s, c)}
            onAnalyse={c => openAnalysis(c.id)}
            onDeleted={id => {
              if (activeCampaign?.id === id) setActiveCampaign(null)
              if (analysisCampaignId === id) setAnalysisCampaignId(null)
            }}
          />
        )}
        {page === 'settings' && isAdmin && <SettingsPage />}
        {page === 'users' && isAdmin && <UsersPage />}
      </main>
    </div>
  )
}

export default App
