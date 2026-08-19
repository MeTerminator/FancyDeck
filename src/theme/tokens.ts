/**
 * 主题令牌。界面里的每一处颜色、间隙、圆角都从这里取值，
 * 换主题 = 换一份令牌表，布局与组件完全不动。
 *
 * 之后迁移到 React Native 时，这个文件可以原样复用：
 * 只需把 applyTheme 换成 Context 里的 StyleSheet 取值。
 */
export type Theme = {
  id: string
  /** 主题中文名 */
  name: string
  /** 主题英文代号 */
  code: string
  colors: {
    /** 页面底色，也是格子之间露出的分割色 */
    bg: string
    /** 格子底色 */
    cell: string
    /** 高亮格子（提醒条、已开启的设备等） */
    cellActive: string
    /** 1px 分割线 / 描边 */
    line: string
    /** 进度条、滑块的底槽 */
    track: string
    textPrimary: string
    textSecondary: string
    textMuted: string
    /** 唯一点缀色：进度、提醒、开启态 */
    accent: string
    /** 压在 accent 上的文字色 */
    onAccent: string
  }
  /** 格子之间的间隙（px）。0~1 表示发丝分割线的观感 */
  gap: number
  /** 整块面板的外边距（px） */
  padding: number
  /** 格子圆角（px） */
  radius: number
  fonts: {
    /** 数字（时间、温度……） */
    display: string
    /** 中文标题 */
    heading: string
    /** 标签与正文 */
    text: string
  }
}

/**
 * 三档全部用无衬线，都以自带的 HarmonyOS Sans 打头。
 *
 * 它只有西文——数字、拉丁字母归它，中文一个字形都没有，会顺着字体栈落到
 * Noto Sans SC / PingFang SC。所以屏幕上其实是「西文鸿蒙 + 中文思源」的搭配，
 * 时间、温度这类纯数字的地方才是它真正说了算的。
 *
 * 标题与正文当前是同一副字，保留两个槽位是为了让主题能各自换掉其中一个。
 */
const CJK = "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', sans-serif"
const DISPLAY = `'HarmonyOS Sans', ${CJK}`
const HEADING = `'HarmonyOS Sans', ${CJK}`
const TEXT = `'HarmonyOS Sans', ${CJK}`

const fonts = { display: DISPLAY, heading: HEADING, text: TEXT }

export const themes: Theme[] = [
  {
    id: 'nocturne',
    name: '夜航',
    code: 'NOCTURNE',
    colors: {
      bg: '#23272e',
      cell: '#14161a',
      cellActive: '#1a1e24',
      line: '#2f343c',
      track: '#2f343c',
      textPrimary: '#e8e4dc',
      textSecondary: '#9aa0a8',
      textMuted: '#5f666f',
      accent: '#d0503e',
      onAccent: '#14161a',
    },
    gap: 1,
    padding: 1,
    radius: 0,
    fonts,
  },
  {
    id: 'paper',
    name: '宣纸',
    code: 'PAPER',
    colors: {
      bg: '#d9d2c3',
      cell: '#f5f2eb',
      cellActive: '#fbf9f4',
      line: '#ddd6c8',
      track: '#ddd6c8',
      textPrimary: '#22201c',
      textSecondary: '#6b665c',
      textMuted: '#a29b8d',
      accent: '#b8402c',
      onAccent: '#f5f2eb',
    },
    gap: 1,
    padding: 1,
    radius: 0,
    fonts,
  },
  {
    id: 'celadon',
    name: '青瓷',
    code: 'CELADON',
    colors: {
      bg: '#0f1615',
      cell: '#16201e',
      cellActive: '#1c2825',
      line: '#24322f',
      track: '#24322f',
      textPrimary: '#dfe9e4',
      textSecondary: '#8fa8a1',
      textMuted: '#5c706b',
      accent: '#7fb8a4',
      onAccent: '#16201e',
    },
    gap: 14,
    padding: 14,
    radius: 22,
    fonts,
  },
  {
    id: 'amber',
    name: '显影',
    code: 'AMBER',
    colors: {
      bg: '#0a0907',
      cell: '#100e0b',
      cellActive: '#17130e',
      line: '#221d15',
      track: '#221d15',
      textPrimary: '#e6d9bf',
      textSecondary: '#a8977a',
      textMuted: '#6b5f47',
      accent: '#e0a340',
      onAccent: '#100e0b',
    },
    gap: 8,
    padding: 8,
    radius: 3,
    fonts,
  },
]

export const defaultThemeId = 'nocturne'

/** 把令牌写成 CSS 变量，样式表里统一用 var(--fd-*) 取值 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return {
    '--fd-bg': theme.colors.bg,
    '--fd-cell': theme.colors.cell,
    '--fd-cell-active': theme.colors.cellActive,
    '--fd-line': theme.colors.line,
    '--fd-track': theme.colors.track,
    '--fd-text-primary': theme.colors.textPrimary,
    '--fd-text-secondary': theme.colors.textSecondary,
    '--fd-text-muted': theme.colors.textMuted,
    '--fd-accent': theme.colors.accent,
    '--fd-on-accent': theme.colors.onAccent,
    '--fd-gap': `${theme.gap}px`,
    '--fd-padding': `${theme.padding}px`,
    '--fd-radius': `${theme.radius}px`,
    '--fd-font-display': theme.fonts.display,
    '--fd-font-heading': theme.fonts.heading,
    '--fd-font-text': theme.fonts.text,
  }
}
