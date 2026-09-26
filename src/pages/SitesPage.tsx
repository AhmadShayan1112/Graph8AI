import { useEffect, useState, type FC } from 'react'
import { listSites, type DeployedSite } from '../lib/api'

const SitesPage: FC = () => {
  const [sites, setSites] = useState<DeployedSite[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listSites().then(r => setSites(r.sites)).catch(err => setError(err.message))
  }, [])

  return (
    <div className="page-content fade-in">
      <header className="page-header">
        <div className="page-header-text">
          <div className="page-step">Pipeline</div>
          <h1 className="page-title">Deployed MVPs</h1>
          <div className="page-subtitle">Every site you've deployed, at the link you can send to the lead.</div>
        </div>
      </header>
      {error && <div className="settings-alert">{error}</div>}
      {sites && !sites.length && <p className="text-muted">Nothing deployed yet. Generate an MVP and click Deploy.</p>}
      {sites && sites.length > 0 && (
        <div className="settings-list">
          {sites.map(s => {
            const url = `${window.location.origin}/${s.slug}`
            return (
              <div key={s.slug} className="settings-card">
                <div className="settings-card-head">
                  <span className="settings-card-label">{s.leadName}</span>
                  <span className="settings-badge">{s.mvpType.replace(/-/g, ' ')}</span>
                </div>
                <div className="settings-card-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <a className="deploy-link mono" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                  <span className="text-muted" style={{ fontSize: 12 }}>Updated {new Date(s.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default SitesPage
