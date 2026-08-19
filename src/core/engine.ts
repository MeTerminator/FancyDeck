import {
  withParamDefaults,
  type Condition,
  type DeckConfig,
  type LayoutPreset,
  type Orientation,
  type ParamValues,
  type PluginId,
  type PluginStates,
  type TriggerDefinition,
  type TriggerKey,
} from './types'

/**
 * 布局决策引擎：给定「插件数据 + 配置 + 屏幕方向 + 时间」，算出该显示哪套布局。
 *
 * 刻意做成没有任何 React / DOM 依赖的纯函数，
 * 这样展示页、管理后台预览、以后的服务端渲染都能跑同一套判定。
 */

export type TriggerLookup = (ref: TriggerKey) =>
  | { plugin: PluginId; def: TriggerDefinition<any> }
  | undefined

export type EvalEnv = {
  states: PluginStates
  /** pluginId → 已补全默认值的设置 */
  settings: Record<PluginId, ParamValues>
  enabled: (plugin: PluginId) => boolean
  lookup: TriggerLookup
  now: Date
}

/** 单个触发条件求值；插件被关掉时其触发条件恒为 false。 */
export function evaluateTrigger(ref: TriggerKey, params: ParamValues | undefined, env: EvalEnv): boolean {
  const found = env.lookup(ref)
  if (!found) return false
  if (!env.enabled(found.plugin)) return false
  try {
    return Boolean(
      found.def.evaluate({
        state: env.states[found.plugin],
        settings: env.settings[found.plugin] ?? {},
        params: withParamDefaults(found.def.params, params),
        now: env.now,
      }),
    )
  } catch {
    // 插件写崩了不该拖垮整块屏
    return false
  }
}

export function evaluateCondition(condition: Condition, env: EvalEnv): boolean {
  switch (condition.kind) {
    case 'always':
      return true
    case 'never':
      return false
    case 'trigger':
      return evaluateTrigger(condition.ref, condition.params, env)
    case 'all':
      return condition.of.every((c) => evaluateCondition(c, env))
    case 'any':
      return condition.of.length > 0 && condition.of.some((c) => evaluateCondition(c, env))
    case 'not':
      return !evaluateCondition(condition.of, env)
    default:
      return false
  }
}

const orientationMatches = (want: Orientation, actual: Exclude<Orientation, 'any'>) =>
  want === 'any' || want === actual

export type Resolution = {
  preset: LayoutPreset
  /** 命中原因，后台的「当前生效」面板会显示 */
  reason: 'pinned' | 'trigger' | 'fallback'
  /** 所有条件成立的预设（含被优先级压过的），后台用来解释决策 */
  candidates: LayoutPreset[]
}

/**
 * 挑出该生效的布局：
 *   1. 后台钉住了某套 → 用它
 *   2. 方向匹配 + 条件成立的里面，priority 最高的
 *   3. 兜底预设
 */
export function resolveLayout(
  config: DeckConfig,
  env: EvalEnv,
  orientation: Exclude<Orientation, 'any'>,
): Resolution | null {
  const byId = (id: string | null) => config.presets.find((p) => p.id === id)

  if (config.pinnedPresetId) {
    const pinned = byId(config.pinnedPresetId)
    if (pinned) return { preset: pinned, reason: 'pinned', candidates: [pinned] }
  }

  const candidates = config.presets
    .filter((p) => p.enabled)
    .filter((p) => orientationMatches(p.orientation, orientation))
    .filter((p) => evaluateCondition(p.when, env))
    .sort((a, b) => b.priority - a.priority)

  if (candidates.length > 0) {
    const top = candidates[0]
    const isFallback = top.id === config.fallbackPresetId && top.when.kind === 'always'
    return { preset: top, reason: isFallback ? 'fallback' : 'trigger', candidates }
  }

  const fallback = byId(config.fallbackPresetId) ?? config.presets[0]
  return fallback ? { preset: fallback, reason: 'fallback', candidates: [] } : null
}

// ────────────────────────────────────────────────────────────────────────────
// 网格几何：管理后台的可视化编辑器与展示页共用
// ────────────────────────────────────────────────────────────────────────────

export const ratioOrEqual = (ratio: number[] | undefined, count: number): number[] =>
  ratio && ratio.length === count ? ratio.map((n) => (n > 0 ? n : 1)) : Array.from({ length: count }, () => 1)

/** 转成 grid-template-columns / rows 的 fr 串 */
export const tracksToFr = (ratio: number[]) => ratio.map((n) => `${n}fr`).join(' ')

export type Rect = { col: number; row: number; colSpan: number; rowSpan: number }

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.col < b.col + b.colSpan &&
  b.col < a.col + a.colSpan &&
  a.row < b.row + b.rowSpan &&
  b.row < a.row + a.rowSpan

export const rectInsideGrid = (r: Rect, cols: number, rows: number) =>
  r.col >= 1 && r.row >= 1 && r.col + r.colSpan - 1 <= cols && r.row + r.rowSpan - 1 <= rows

/** 找到能放下 w×h 的第一个空位，按行优先扫描。放不下返回 null。 */
export function findFreeRect(
  occupied: Rect[],
  cols: number,
  rows: number,
  w: number,
  h: number,
): Rect | null {
  const width = Math.min(w, cols)
  const height = Math.min(h, rows)
  for (let row = 1; row + height - 1 <= rows; row += 1) {
    for (let col = 1; col + width - 1 <= cols; col += 1) {
      const candidate = { col, row, colSpan: width, rowSpan: height }
      if (!occupied.some((o) => rectsOverlap(o, candidate))) return candidate
    }
  }
  return null
}

/** 网格尺寸变小之后，把越界的落位裁回来；裁不动的丢弃。 */
export function clampSlots<T extends Rect>(slots: T[], cols: number, rows: number): T[] {
  const kept: T[] = []
  for (const slot of slots) {
    if (slot.col > cols || slot.row > rows) continue
    kept.push({
      ...slot,
      colSpan: Math.max(1, Math.min(slot.colSpan, cols - slot.col + 1)),
      rowSpan: Math.max(1, Math.min(slot.rowSpan, rows - slot.row + 1)),
    })
  }
  return kept
}
