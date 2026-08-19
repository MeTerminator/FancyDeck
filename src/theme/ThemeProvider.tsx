import { createContext, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { defaultThemeId, themes, themeToCssVars } from './tokens'
import type { Theme } from './tokens'

type ThemeContextValue = { theme: Theme; themes: Theme[] }

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * 主题不再自己存 localStorage：它由服务端配置里的 themeId 决定，
 * 后台一改，所有屏幕同时换皮。
 *
 * global=true 时把变量写到 <html> 上（展示页），
 * 否则只写在自己这层 div 上（后台里的小尺寸预览，不污染 shadcn 的样式）。
 */
export function ThemeProvider({
  themeId,
  global = false,
  className,
  style,
  children,
}: {
  themeId?: string
  global?: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const theme = useMemo(
    () => themes.find((t) => t.id === (themeId ?? defaultThemeId)) ?? themes[0],
    [themeId],
  )

  const vars = useMemo(() => themeToCssVars(theme), [theme])

  useEffect(() => {
    if (!global) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  }, [global, vars])

  const value = useMemo(() => ({ theme, themes }), [theme])

  return (
    <ThemeContext.Provider value={value}>
      <div className={className} style={{ ...(vars as CSSProperties), ...style }}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}
