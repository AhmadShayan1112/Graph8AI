import { type FC } from 'react'
import { useSession } from './LoginGate'

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
  { id: 'history', label: 'History', num: '06' },
]

interface SidebarProps {
  active: string
  onNavigate: (id: string) => void
  leadCount?: number
}

const Sidebar: FC<SidebarProps> = ({ active, onNavigate, leadCount }) => {
  const { user } = useSession()
  const isAdmin = user.role === 'admin'
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
        {isAdmin && (
          <>
            <button
              className={`sidebar-item ${active === 'users' ? 'active' : ''}`}
              onClick={() => onNavigate('users')}
            >
              <span className="sidebar-item-num">◉</span>
              Users
            </button>
            <button
              className={`sidebar-item ${active === 'settings' ? 'active' : ''}`}
              onClick={() => onNavigate('settings')}
            >
              <span className="sidebar-item-num">⚙</span>
              Settings
            </button>
          </>
        )}
        <button className="sidebar-landing-link" onClick={() => onNavigate('landing')}>
          ← Marketing site
        </button>
        <button className="sidebar-landing-link" onClick={() => onNavigate('logout')}>
          Sign out
        </button>
      </div>

      <div className="sidebar-workspace">
        <div className="sidebar-workspace-label">{isAdmin ? 'Admin' : 'Signed in as'}</div>
        <div className="sidebar-workspace-name">{user.username}</div>
        <div className="sidebar-access">
          <span className={`settings-badge ${user.permissions.claude ? 'ok' : ''}`}>Claude {user.permissions.claude ? 'on' : 'off'}</span>
          <span className={`settings-badge ${user.permissions.graph8 ? 'ok' : ''}`}>Graph8 {user.permissions.graph8 ? 'on' : 'off'}</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
