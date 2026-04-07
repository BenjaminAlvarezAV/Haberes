import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type ThemeChoice = 'light' | 'dark'

type ThemeContextValue = {
  /** `null` = seguir `prefers-color-scheme` hasta que el usuario elija Claro/Oscuro. */
  override: ThemeChoice | null
  setTheme: (t: ThemeChoice) => void
  resolved: 'light' | 'dark'
}

const STORAGE_KEY = 'haberes-theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getStoredOverride(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
    if (v === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverrideState] = useState<ThemeChoice | null>(() =>
    typeof window === 'undefined' ? null : getStoredOverride(),
  )

  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' = override ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved === 'dark' ? 'dark' : 'light'
  }, [resolved])

  const setTheme = useCallback((t: ThemeChoice) => {
    setOverrideState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ override, setTheme, resolved }),
    [override, setTheme, resolved],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
