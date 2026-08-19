/**
 * FancyDeck 框架契约。
 *
 * 这份文件被三端共用：展示页（浏览器）、管理后台（浏览器）、数据服务（Node）。
 * 因此它只能包含类型与纯常量，不得 import React 或 node 内置模块。
 *
 * 三个核心概念：
 *   插件 Plugin  —— 一次性打包「卡片 + 数据 + 路由 + 触发条件」的功能单元
 *   布局 Layout  —— 一张网格上的卡片落位表；有多套，按触发条件自动切换
 *   触发 Trigger —— 插件对外暴露的布尔量（如「音乐正在播放」），供布局引用
 */

// ────────────────────────────────────────────────────────────────────────────
// 标识
// ────────────────────────────────────────────────────────────────────────────

/** 插件 id，全局唯一，只允许 [a-z0-9-] */
export type PluginId = string

/** 卡片全局键：`插件id:卡片id`，例如 `media:cover-controls` */
export type CardKey = string

/** 触发器全局键：`插件id:触发器id`，例如 `media:playing` */
export type TriggerKey = string

export const cardKey = (plugin: PluginId, card: string): CardKey => `${plugin}:${card}`
export const triggerKey = (plugin: PluginId, trigger: string): TriggerKey => `${plugin}:${trigger}`
export const splitKey = (key: string): [PluginId, string] => {
  const i = key.indexOf(':')
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]
}

// ────────────────────────────────────────────────────────────────────────────
// 参数描述（管理后台据此自动渲染表单，插件不写任何后台 UI）
// ────────────────────────────────────────────────────────────────────────────

export type ParamSpec =
  | { key: string; label: string; type: 'boolean'; default: boolean; help?: string }
  | {
      key: string
      label: string
      type: 'number'
      default: number
      min?: number
      max?: number
      step?: number
      unit?: string
      help?: string
    }
  | { key: string; label: string; type: 'string'; default: string; placeholder?: string; help?: string }
  | {
      key: string
      label: string
      type: 'select'
      default: string
      options: { value: string; label: string }[]
      help?: string
    }
  /**
   * 候选项太多、塞不进下拉框时用它（几千个城市这种）。选项不随插件打包进浏览器，
   * 由服务端按需给，插件只要声明一个接口地址：
   *   GET <source>?group=<组>&q=<关键词>  → 该组下的候选，返回 { value, label }[]
   *   GET <source>?value=<值>            → 回显当前选中项，返回 [{ value, label, group }]
   *
   * 给了 groupLabel 就是两级选择（先选省再选市），后台会多问一次：
   *   GET <source>?groups=1              → 一级候选，返回 { value, label }[]
   * 存下来的始终只有二级那个值，一级是从 ?value= 的回显里反推的，不占设置项。
   */
  | {
      key: string
      label: string
      type: 'lookup'
      default: string
      source: string
      /** 例如「省份」。不给就是单级搜索。 */
      groupLabel?: string
      placeholder?: string
      help?: string
    }

export type ParamValues = Record<string, unknown>

/** 用 ParamSpec[] 的默认值补全一份取值，管理后台与运行时都靠它兜底 */
export function withParamDefaults(specs: ParamSpec[] | undefined, values: ParamValues | undefined): ParamValues {
  const out: ParamValues = {}
  for (const spec of specs ?? []) out[spec.key] = spec.default
  for (const [k, v] of Object.entries(values ?? {})) if (v !== undefined) out[k] = v
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// 卡片
// ────────────────────────────────────────────────────────────────────────────

/** 卡片拿到的一切。插件卡片是纯函数式的：读 state，发 command。 */
export type CardContext<S = unknown> = {
  /** 该插件当前的数据快照（服务端下发 + 客户端本地源合并后的结果） */
  state: S
  /** 插件设置（管理后台里配的），已用 ParamSpec 默认值补全 */
  settings: ParamValues
  /** 这张卡片在当前布局里占的格数，卡片可据此切换紧凑/完整排版 */
  span: { cols: number; rows: number }
  /** 当前生效的布局预设 id */
  presetId: string
  /** 向插件服务端发指令（例如暂停播放）。不保证送达，失败静默。 */
  command: (action: string, payload?: unknown) => void
  /** 本地 patch 插件数据（乐观更新，随后会被服务端下发覆盖） */
  patchState: (patch: Partial<S>) => void
  now: Date
}

export type CardSize = {
  /** 低于这个格数就不给放（管理后台会拦） */
  minCols: number
  minRows: number
  /** 拖到网格上时的默认大小 */
  defaultCols: number
  defaultRows: number
  maxCols?: number
  maxRows?: number
}

export type CardDefinition = {
  id: string
  name: string
  description?: string
  size: CardSize
  /** 后台卡片库里的示意图（纯 CSS 画的缩略图），可选 */
  preview?: string
}

// ────────────────────────────────────────────────────────────────────────────
// 触发条件
// ────────────────────────────────────────────────────────────────────────────

export type TriggerContext<S = unknown> = {
  state: S
  settings: ParamValues
  params: ParamValues
  now: Date
}

export type TriggerDefinition<S = unknown> = {
  id: string
  /** 后台条件下拉里显示的文案，例如「在音乐播放时」 */
  name: string
  description?: string
  /** 该触发器自身的参数，例如「日程临近」的提前分钟数 */
  params?: ParamSpec[]
  /** 纯函数，必须无副作用；同一份输入必须给出同一个结果 */
  evaluate: (ctx: TriggerContext<S>) => boolean
}

/** 布局的触发条件树 */
export type Condition =
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'trigger'; ref: TriggerKey; params?: ParamValues }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; of: Condition }

export const ALWAYS: Condition = { kind: 'always' }

// ────────────────────────────────────────────────────────────────────────────
// 布局
// ────────────────────────────────────────────────────────────────────────────

export type Slot = {
  id: string
  card: CardKey
  /** 1-based，与 CSS Grid 一致 */
  col: number
  row: number
  colSpan: number
  rowSpan: number
}

export type Orientation = 'any' | 'landscape' | 'portrait'

export type LayoutPreset = {
  id: string
  name: string
  /** 网格规格，例如 5×5 */
  cols: number
  rows: number
  /** 列宽/行高比例，长度须等于 cols/rows；缺省视为全 1（等分） */
  colRatio?: number[]
  rowRatio?: number[]
  slots: Slot[]
  /** 只在某个屏幕方向下参与匹配 */
  orientation: Orientation
  /** 触发条件；`always` 表示随时可命中（通常配 priority 0 当兜底） */
  when: Condition
  /** 数值大的优先。同分按数组顺序。 */
  priority: number
  enabled: boolean
  /** 切进来之后至少停留多久，避免条件抖动导致布局闪烁 */
  holdMs?: number
  /** 内置预设不可删除 */
  builtin?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// 配置（服务端持久化的全部内容）
// ────────────────────────────────────────────────────────────────────────────

export type PluginConfig = {
  enabled: boolean
  settings: ParamValues
}

export type DeckConfig = {
  version: 1
  themeId: string
  /** 未列出的插件按其 manifest 的 defaultEnabled 处理 */
  plugins: Record<PluginId, PluginConfig>
  presets: LayoutPreset[]
  /** 什么都没命中时用它 */
  fallbackPresetId: string
  /** 后台「钉住」某套布局用于预览；非 null 时压过一切触发条件 */
  pinnedPresetId: string | null
  /** 布局切换动画时长（ms），0 为关闭 */
  transitionMs: number
}

// ────────────────────────────────────────────────────────────────────────────
// 线上协议（WebSocket + REST 共用的消息体）
// ────────────────────────────────────────────────────────────────────────────

export type PluginStates = Record<PluginId, unknown>

export type ServerMessage =
  | { type: 'hello'; config: DeckConfig; states: PluginStates; serverTime: number }
  | { type: 'config'; config: DeckConfig }
  | { type: 'state'; plugin: PluginId; state: unknown }
  /** 服务端转给「采集端」（macOS 助手）的指令 */
  | { type: 'command'; plugin: PluginId; action: string; payload?: unknown }
  | { type: 'error'; message: string }

export type ClientMessage =
  /** 展示页/后台连上来 */
  | { type: 'subscribe'; role: 'display' | 'console' }
  /** 采集端连上来，声明自己负责哪些插件 */
  | { type: 'register-agent'; plugins: PluginId[] }
  /** 后台整份写配置 */
  | { type: 'set-config'; config: DeckConfig }
  /** 采集端上报数据 */
  | { type: 'push-state'; plugin: PluginId; state: unknown; merge?: boolean }
  /** 展示页发指令，服务端转发给采集端 */
  | { type: 'command'; plugin: PluginId; action: string; payload?: unknown }
  | { type: 'ping' }
