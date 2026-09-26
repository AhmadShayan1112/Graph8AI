import { type FC } from 'react'

interface NavItem {
  id: string
  label: string
  num: string
  count?: string
}

const navItems: NavItem[] = [
  { id: 'discover', label: 'Discover', num: '01', count: '' },
  { id: 'audit', label: 'Audit', num: '02' },
  { id: 'build', label: 'Build & deploy', num: '03' },
  { id: 'outreach', label: 'Outreach', num: '04' },
  { id: 'pipeline', label: 'Pipeline', num: '05' },
]

interface SidebarProps {
  active: string
  onNavigate: (id: string) => void
  leadCount?: number
}

const Sidebar: FC<SidebarProps> = ({ active, onNavigate, leadCount }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <div className="sidebar-logo-dot" />
        </div>
        <div className="sidebar-name">Gapwise</div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`sidebar-item ${active === item.id ? 'active' : ''}`}
          >
            <span className="sidebar-item-num">{item.num}</span>
            {item.label}
            {item.id === 'discover' && leadCount ? (
              <span className="sidebar-item-count">{leadCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom-links">
        <button
          className={`sidebar-item ${active === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="sidebar-item-num">⚙</span>
          Settings
        </button>
        <button className="sidebar-landing-link" onClick={() => onNavigate('landing')}>
          ← Marketing site
        </button>
        <button className="sidebar-landing-link" onClick={() => onNavigate('logout')}>
          Sign out
        </button>
      </div>

      <div className="sidebar-workspace">
        <div className="sidebar-workspace-label">Workspace</div>
        <div className="sidebar-workspace-name">My Agency</div>
        <div className="sidebar-workspace-credits">
          <span>MVP credits</span>
          <span className="mono">14 / 25</span>
        </div>
        <div className="sidebar-workspace-bar">
          <div className="sidebar-workspace-bar-fill" style={{ width: '56%' }} />
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
