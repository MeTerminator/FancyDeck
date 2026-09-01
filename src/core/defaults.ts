import type { DeckConfig, LayoutPreset, Slot } from './types'

/**
 * 出厂配置。纯数据，服务端首次启动时写入 data/config.json，
 * 之后一切以磁盘上那份为准，这里不再参与。
 */

let seq = 0
const slot = (card: string, col: number, row: number, colSpan = 1, rowSpan = 1): Slot => ({
  id: `s${(seq += 1)}`,
  card,
  col,
  row,
  colSpan,
  rowSpan,
})

/** 桌面横屏兜底：沿用 FancyDeck 初版的 4×3 落位 */
const desk: LayoutPreset = {
  id: 'desk',
  name: '桌面',
  cols: 4,
  rows: 3,
  slots: [
    slot('datetime:date-weekday', 1, 1),
    slot('datetime:time', 2, 1, 2, 2),
    slot('weather:compact', 1, 2),
    slot('agenda:next', 1, 3),
    slot('media:info', 2, 3, 2, 1),
  ],
  orientation: 'landscape',
  when: { kind: 'always' },
  priority: 0,
  enabled: true,
  builtin: true,
}

/** 竖屏兜底：同一批卡片换一种落位 */
const portrait: LayoutPreset = {
  id: 'portrait',
  name: '竖屏',
  cols: 2,
  rows: 6,
  slots: [
    slot('datetime:date-weekday', 1, 1),
    slot('datetime:time', 1, 2, 2, 2),
    slot('weather:compact', 1, 4),
    slot('agenda:next', 2, 4),
    slot('media:info', 1, 5, 2, 1),
  ],
  orientation: 'portrait',
  when: { kind: 'always' },
  priority: 0,
  enabled: true,
  builtin: true,
}

/** 播放音乐时自动切进来：封面与歌词占满上半屏 */
const nowPlaying: LayoutPreset = {
  id: 'now-playing',
  name: '正在播放',
  cols: 4,
  rows: 3,
  slots: [
    slot('media:cover', 1, 1, 2, 2),
    slot('media:lyrics', 3, 1, 2, 2),
    slot('datetime:time', 1, 3, 2, 1),
    slot('media:info', 3, 3, 2, 1),
  ],
  orientation: 'landscape',
  when: { kind: 'trigger', ref: 'media:playing' },
  priority: 10,
  enabled: true,
  // 不设 holdMs：防抖已经由 media:playing 自己的「暂停宽限」做了（默认 5 秒）。
  // 两层叠在一起的话，停止后要等「宽限 + holdMs」才退出，看着像卡住不动。
  builtin: true,
}

/** 日程临近：把下一件事放大 */
const agendaSoon: LayoutPreset = {
  id: 'agenda-soon',
  name: '日程临近',
  cols: 4,
  rows: 3,
  slots: [
    slot('datetime:time', 1, 1, 2, 2),
    slot('agenda:next', 3, 1, 2, 2),
    slot('weather:compact', 1, 3),
    slot('datetime:date-weekday', 2, 3),
    slot('media:info', 3, 3, 2, 1),
  ],
  orientation: 'landscape',
  when: { kind: 'trigger', ref: 'agenda:soon', params: { withinMinutes: 30 } },
  priority: 20,
  enabled: true,
  holdMs: 4000,
  builtin: true,
}

export function defaultConfig(): DeckConfig {
  return {
    version: 1,
    themeId: 'nocturne',
    plugins: {},
    presets: [desk, portrait, nowPlaying, agendaSoon],
    fallbackPresetId: 'desk',
    pinnedPresetId: null,
    transitionMs: 420,
  }
}

/** 新建预设时的空白模板 */
export function blankPreset(id: string, name: string): LayoutPreset {
  return {
    id,
    name,
    cols: 4,
    rows: 3,
    slots: [],
    orientation: 'any',
    when: { kind: 'never' },
    priority: 5,
    enabled: true,
    holdMs: 3000,
  }
}
