import { useEffect, useState } from 'react'

// A tab left open across a deploy keeps running the old code, which can call endpoints that no longer exist.
// This checks the live version when the tab regains focus (and every few minutes) and offers a reload.
const CHECK_EVERY = 5 * 60 * 1000

export default function UpdateBanner() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (__APP_COMMIT__ === 'local') return
    let last = 0
    const check = () => {
      if (document.hidden || Date.now() - last < 30_000) return
      last = Date.now()
      fetch('/api/health', { cache: 'no-store' })
        .then(r => r.json())
        .then(h => { if (h?.commit && h.commit !== 'local' && h.commit !== __APP_COMMIT__) setStale(true) })
        .catch(() => { /* offline; try later */ })
    }
    check()
    const timer = setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  if (!stale) return null
  return (
    <div className="update-banner" role="status">
      <span>A new version of Gapwise is available.</span>
      <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
