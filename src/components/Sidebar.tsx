import { type FC, type ReactNode } from 'react'
import { useSession } from './LoginGate'
import { LogoMark } from './Logo'
import { useTheme } from '../lib/theme'

// Line icons drawn on a 24px grid; they inherit the item's text color.
const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="8" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="14.5" width="7" height="6" rx="1.5" /></>,
  analysis: <><path d="M4 20V11" /><path d="M10 20V5" /><path d="M16 20v-6" /><path d="M21 20H3" /></>,
  campaigns: <><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></>,
  discover: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  gaps: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /></>,
  audit: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="m9 13 2 2 4-4" /></>,
  build: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  outreach: <><path d="M21 3 10 14" /><path d="m21 3-6.5 18-4.5-7-7-4.5L21 3Z" /></>,
  pipeline: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  support: <><path d="M4 13a8 8 0 0 1 16 0" /><rect x="3" y="13" width="4" height="6" rx="1.5" /><rect x="17" y="13" width="4" height="6" rx="1.5" /><path d="M20 19c0 1.5-2 2.5-5 2.5h-2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1" /></>,
  tour: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
  back: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></>,
}

// Switches between the light and dark workspace.
export const ThemeToggle: FC<{ compact?: boolean }> = ({ compact }) => {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Light mode' : 'Dark mode'
  return (
    <button className={compact ? 'theme-toggle-compact' : 'sidebar-item sidebar-item-quiet'} onClick={toggle}
      aria-label={`Switch to ${label.toLowerCase()}`} title={`Switch to ${label.toLowerCase()}`} data-tour="theme">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      {!compact && label}
    </button>
  )
}

const Icon: FC<{ name: string }> = ({ name }) => (
  <svg className="sidebar-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {ICONS[name]}
  </svg>
)

const GROUPS: Array<{ title: string; items: Array<{ id: string; label: string }> }> = [
  { title: 'Plan', items: [{ id: 'dashboard', label: 'Dashboard' }, { id: 'analysis', label: 'Analysis' }, { id: 'campaigns', label: 'Campaigns' }] },
  {
    title: 'Prospect',
    items: [
      { id: 'discover', label: 'Discover' },
      { id: 'gaps', label: 'Gap analysis' },
      { id: 'audit', label: 'Audit' },
      { id: 'build', label: 'Build & deploy' },
      { id: 'outreach', label: 'Outreach' },
    ],
  },
  { title: 'Records', items: [{ id: 'pipeline', label: 'Pipeline' }, { id: 'history', label: 'History' }] },
]

interface SidebarProps {
  active: string
  onNavigate: (id: string) => void
  leadCount?: number
  canGoBack?: boolean
  supportCount?: number
  // Live status of a background job (gap analysis), shown above the bottom links.
  runner?: ReactNode
}

const Sidebar: FC<SidebarProps> = ({ active, onNavigate, leadCount, canGoBack, supportCount, runner }) => {
  const { user } = useSession()
  const isAdmin = user.role === 'admin'

  const item = (id: string, label: string, extra?: ReactNode) => (
    <button
      key={id}
      onClick={() => onNavigate(id)}
      className={`sidebar-item ${active === id ? 'active' : ''}`}
      aria-current={active === id ? 'page' : undefined}
      data-tour={`nav-${id}`}
    >
      <Icon name={id} />
      {label}
      {extra}
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="sidebar-brand brand-link" onClick={() => onNavigate('landing')} title="Go to the landing page">
          <LogoMark size={26} />
          <span className="sidebar-name">Gapwise</span>
        </button>
        <ThemeToggle compact />
      </div>

      <nav className="sidebar-nav">
        {GROUPS.map(g => (
          <div key={g.title} className="sidebar-group">
            <div className="sidebar-group-title">{g.title}</div>
            {g.items.map(i => item(i.id, i.label,
              i.id === 'discover' && leadCount ? <span className="sidebar-item-count">{leadCount}</span> : null))}
          </div>
        ))}
        {isAdmin && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">Admin</div>
            {item('support', 'Support', supportCount ? <span className="sidebar-item-count sidebar-item-alert">{supportCount}</span> : null)}
            {item('users', 'Users')}
            {item('settings', 'Settings')}
          </div>
        )}
      </nav>

      <div className="sidebar-bottom-links">
        {runner && <div className="sidebar-runner">{runner}</div>}
        <button className="sidebar-item sidebar-item-quiet" onClick={() => onNavigate('tour')} data-tour="take-tour">
          <Icon name="tour" />
          Take the tour
        </button>
        <button className="sidebar-item sidebar-item-quiet" onClick={() => onNavigate('back')} disabled={!canGoBack}>
          <Icon name="back" />
          Back
        </button>
        <button className="sidebar-item sidebar-item-quiet" onClick={() => onNavigate('logout')}>
          <Icon name="logout" />
          Sign out
        </button>
      </div>

      <div className="sidebar-workspace">
        <div className="sidebar-workspace-label">{isAdmin ? 'Admin' : 'Signed in as'}</div>
        <div className="sidebar-workspace-name">{user.username}</div>
        <div className="sidebar-access">
          <span className={`settings-badge ${user.permissions.claude ? 'ok' : ''}`}>Claude {user.permissions.claude ? 'on' : 'off'}</span>
          <span className={`settings-badge ${user.permissions.graph8 ? 'ok' : ''}`}>Graph8 {user.permissions.graph8 ? 'on' : 'off'}</span>
          <span className={`settings-badge ${user.permissions.gemini ? 'ok' : ''}`}>Gap analysis {user.permissions.gemini ? 'on' : 'off'}</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
