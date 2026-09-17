export type ThemeMode = 'light' | 'dark'

export function useAppTheme() {
  const currentTheme = useState<ThemeMode>('app-theme', () => 'light')

  const applyTheme = (theme: ThemeMode) => {
    currentTheme.value = theme
    if (!import.meta.server && typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
      try {
        localStorage.setItem('shanhai_theme', theme)
      } catch {
        // ignore localStorage errors
      }
    }
  }

  const toggleTheme = () => {
    applyTheme(currentTheme.value === 'dark' ? 'light' : 'dark')
  }

  const initTheme = () => {
    if (!import.meta.server && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('shanhai_theme') as ThemeMode | null
        if (saved === 'light' || saved === 'dark') {
          applyTheme(saved)
          return
        }
      } catch {
        // fallback
      }
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      applyTheme(prefersDark ? 'dark' : 'light')
    }
  }

  return {
    currentTheme,
    applyTheme,
    toggleTheme,
    initTheme,
  }
}
