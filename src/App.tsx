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
import DashboardPage from './pages/DashboardPage'
import LoginGate, { useSession } from './components/LoginGate'
import { LogoMark } from './components/Logo'
import { EMPTY_FILTERS, getSearch, logout, saveCampaignLead, type Campaign, type SavedSearch } from './lib/api'
import type { Lead } from './types/lead'
import './App.css'

// The app lives under `#/page[/id]`, so a refresh or bookmark reopens the same page. The site root
// without a hash is the landing page. (Hash routes never reach the server, whose `/:slug` paths are
// the deployed MVP sites.)
const PAGES = new Set(['dashboard', 'analysis', 'campaigns', 'discover', 'gaps', 'audit', 'build', 'outreach', 'pipeline', 'history', 'users', 'settings'])
const PAGES_WITH_ID = new Set(['campaigns', 'analysis', 'gaps'])

function readHash() {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  return PAGES.has(page) ? { page, id: id ? decodeURIComponent(id) : null } : null
}

function App() {
  const [view, setView] = useState<'landing' | 'app'>(() => (readHash() ? 'app' : 'landing'))

  useEffect(() => {
    const onHash = () => setView(readHash() ? 'app' : 'landing')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (view === 'landing') {
    return <LandingPage onEnterApp={() => { window.location.hash = '#/dashboard'; setView('app') }} />
  }

  return (
    <LoginGate>
      <Workspace
        onLanding={() => {
          window.history.pushState(null, '', window.location.pathname + window.location.search)
          setView('landing')
          window.scrollTo(0, 0)
        }}
      />
    </LoginGate>
  )
}

// Work in progress survives a refresh for the rest of the browser session.
const SAVED = 'gapwise:workspace'
function loadSaved(): Partial<{ leads: Lead[]; selectedLead: Lead | null; mvpType: string; siteUrl: string; activeCampaign: Campaign | null }> {
  try { return JSON.parse(sessionStorage.getItem(SAVED) || '{}') } catch { return {} }
}

// Rendered inside LoginGate so it can read the signed-in user's role and key access.
function Workspace({ onLanding }: { onLanding: () => void }) {
  const { user, refresh } = useSession()
  const [initial] = useState(() => ({ route: readHash(), saved: loadSaved() }))
  const idFor = (p: string) => (initial.route?.page === p ? initial.route.id : null)
  const [page, setPage] = useState(initial.route?.page ?? 'dashboard')
  const [leads, setLeads] = useState<Lead[]>(initial.saved.leads ?? [])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(initial.saved.selectedLead ?? null)
  const [mvpType, setMvpType] = useState(initial.saved.mvpType ?? 'booking-page')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [siteUrl, setSiteUrl] = useState<string | undefined>(initial.saved.siteUrl)
  // The campaign the user is working in: Discover files searches under it, Audit saves enrichment to it.
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(initial.saved.activeCampaign ?? null)
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(idFor('campaigns'))
  const [analysisCampaignId, setAnalysisCampaignId] = useState<string | null>(idFor('analysis'))
  const [gapCampaignId, setGapCampaignId] = useState<string | null>(idFor('gaps'))

  useEffect(() => {
    try {
      sessionStorage.setItem(SAVED, JSON.stringify({ leads, selectedLead, mvpType, siteUrl, activeCampaign }))
    } catch { /* storage full or blocked: a refresh just won't restore */ }
  }, [leads, selectedLead, mvpType, siteUrl, activeCampaign])

  // Keep the address bar in step with the page, so refresh, bookmarks and the browser's Back work.
  const routeId = page === 'campaigns' ? openCampaignId : page === 'analysis' ? analysisCampaignId : page === 'gaps' ? gapCampaignId : null
  useEffect(() => {
    const hash = `#/${page}${PAGES_WITH_ID.has(page) && routeId ? `/${encodeURIComponent(routeId)}` : ''}`
    if (window.location.hash !== hash) window.history.pushState(null, '', hash)
  }, [page, routeId])

  useEffect(() => {
    const onPop = () => {
      const r = readHash()
      if (!r) return
      if (r.page === 'campaigns') setOpenCampaignId(r.id)
      if (r.page === 'analysis') setAnalysisCampaignId(r.id)
      if (r.page === 'gaps') setGapCampaignId(r.id)
      setPage(r.page)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Pages visited, so Back can return to the previous one.
  const visited = useRef<string[]>([])
  const previous = useRef(page)
  const goingBack = useRef(false)
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    if (goingBack.current) goingBack.current = false
    else if (previous.current !== page) visited.current = [...visited.current, previous.current].slice(-50)
    previous.current = page
    setCanGoBack(visited.current.length > 0)
  }, [page])

  const goBack = () => {
    // Skip lead pages whose lead is no longer selected; they would render empty.
    const needsLead = new Set(['audit', 'build', 'outreach'])
    let target: string | undefined
    while ((target = visited.current.pop()) && needsLead.has(target) && !selectedLead) { /* skip */ }
    setCanGoBack(visited.current.length > 0)
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
    if (id === 'logout') {
      try { sessionStorage.removeItem(SAVED) } catch { /* ignore */ }
      logout().finally(() => window.location.replace(window.location.pathname))
      return
    }
    // Pick up any access change the admin made since the last page.
    refresh()
    // The Campaigns menu item always lands on the list.
    if (id === 'campaigns') setOpenCampaignId(null)
    setPage(id)
    setMobileMenuOpen(false)
  }

  const isAdmin = user.role === 'admin'

  // A link to an admin page opened by a user falls back to the dashboard instead of a blank screen.
  useEffect(() => {
    if (!isAdmin && (page === 'settings' || page === 'users')) setPage('dashboard')
  }, [page, isAdmin])

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
        {page === 'dashboard' && (
          <DashboardPage
            onNavigate={handleNavigate}
            onLanding={onLanding}
            onOpenCampaign={openCampaign}
            onOpenGaps={id => { setGapCampaignId(id); setPage('gaps') }}
            onOpenSearch={id => { getSearch(id).then(r => handleOpenSearch(r.search)).catch(() => setPage('history')) }}
          />
        )}
        {['audit', 'build', 'outreach'].includes(page) && !selectedLead && (
          <div className="page-content fade-in">
            <div className="an-callout">
              <div className="an-callout-title">Choose a lead first</div>
              <div className="text-muted">Open a lead from Discover, a campaign or gap analysis, and it will show here.</div>
              <button className="btn-primary" onClick={() => handleNavigate('discover')}>Go to Discover</button>
            </div>
          </div>
        )}
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
