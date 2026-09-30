export type ThemeMode = 'light' | 'dark'

export function useAppTheme() {
  const cookieTheme = useCookie<ThemeMode>('shanhai_theme', {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    default: () => 'light',
    sameSite: 'lax',
  })

  const currentTheme = useState<ThemeMode>('app-theme', () => cookieTheme.value || 'light')

  // 服务端与客户端同构绑定 HTML 属性
  useHead({
    htmlAttrs: {
      'data-theme': () => currentTheme.value,
    },
  })

  const applyTheme = (theme: ThemeMode) => {
    currentTheme.value = theme
    cookieTheme.value = theme
    if (import.meta.client && typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
      try {
        localStorage.setItem('shanhai_theme', theme)
      } catch {
        // ignore storage quota/security errors
      }
    }
  }

  const toggleTheme = () => {
    applyTheme(currentTheme.value === 'dark' ? 'light' : 'dark')
  }

  const initTheme = () => {
    if (import.meta.client && typeof window !== 'undefined') {
      try {
        const saved = (cookieTheme.value || localStorage.getItem('shanhai_theme')) as ThemeMode | null
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

