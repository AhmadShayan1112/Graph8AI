import { useEffect, useState } from 'react'

// Light or dark workspace. The choice is remembered per browser; without one, the system setting decides.
// The landing page is designed for light only, so it always shows light (see `useTheme(false)`).
export type Theme = 'light' | 'dark'
const KEY = 'gapwise:theme'
const EVENT = 'gapwise:theme'

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch { /* storage blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT))
}

// Applies the theme to the page while `active`, and returns it with a toggle.
export function useTheme(active = true) {
  const [theme, setState] = useState<Theme>(storedTheme)
  useEffect(() => {
    const sync = () => setState(storedTheme())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = active ? theme : 'light'
  }, [theme, active])
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
