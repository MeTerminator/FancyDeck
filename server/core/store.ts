import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defaultConfig } from '../../src/core/defaults'
import type { Condition, DeckConfig, PluginConfig } from '../../src/core/types'

/**
 * 配置持久化。一个 JSON 文件，写入走「临时文件 + rename」保证原子性，
 * 断电也不会留下半截 JSON 把下次启动卡死。
 */

const FILE = resolve(process.cwd(), process.env.FANCYDECK_CONFIG ?? 'data/config.json')

export class ConfigStore {
  private config: DeckConfig
  private writeTimer: NodeJS.Timeout | null = null

  constructor() {
    this.config = load()
  }

  get(): DeckConfig {
    return this.config
  }

  set(next: DeckConfig): DeckConfig {
    this.config = normalize(next)
    this.scheduleWrite()
    return this.config
  }

  update(mutate: (draft: DeckConfig) => DeckConfig): DeckConfig {
    return this.set(mutate(structuredClone(this.config)))
  }

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    // 后台里拖拽一个卡片会连发很多次，攒 200ms 再落盘
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      persist(this.config)
    }, 200)
  }

  flush() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    persist(this.config)
  }
}

function load(): DeckConfig {
  try {
    const raw = readFileSync(FILE, 'utf8')
    return normalize(migrate(JSON.parse(raw) as DeckConfig))
  } catch {
    const fresh = defaultConfig()
    persist(fresh)
    return fresh
  }
}

function persist(config: DeckConfig) {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(tmp, FILE)
  } catch (error) {
    console.error('[fancydeck] 配置写入失败：', error)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 迁移
// ────────────────────────────────────────────────────────────────────────────

/**
 * 「时钟」与「黄历」合并成了「时间与日期」。老配置里存的是 clock:* / almanac:*，
 * 读盘时改写成 datetime:*，用户已经摆好的布局不会因为改名就空一格。
 */
const RENAMED_PLUGINS: Record<string, string> = { clock: 'datetime', almanac: 'datetime' }

const renameKey = (key: string): string => {
  const i = key.indexOf(':')
  if (i < 0) return key
  const next = RENAMED_PLUGINS[key.slice(0, i)]
  return next ? `${next}:${key.slice(i + 1)}` : key
}

const renameCondition = (when: Condition): Condition => {
  switch (when?.kind) {
    case 'trigger':
      return { ...when, ref: renameKey(when.ref) }
    case 'all':
    case 'any':
      return { ...when, of: (when.of ?? []).map(renameCondition) }
    case 'not':
      return { ...when, of: renameCondition(when.of) }
    default:
      return when
  }
}

function migrate(input: DeckConfig): DeckConfig {
  const plugins: Record<string, PluginConfig> = {}
  for (const [id, entry] of Object.entries(input?.plugins ?? {})) {
    const target = RENAMED_PLUGINS[id] ?? id
    const prev = plugins[target]
    plugins[target] = prev
      ? // 两个老插件并成一个：设置合并，任一开着就算开着
        { enabled: prev.enabled || entry.enabled, settings: { ...prev.settings, ...entry.settings } }
      : entry
  }

  return {
    ...input,
    plugins,
    presets: (input?.presets ?? []).map((preset) => ({
      ...preset,
      slots: (preset.slots ?? []).map((slot) => ({ ...slot, card: renameKey(slot.card) })),
      when: renameCondition(preset.when),
    })),
  }
}

/** 把外部传进来的配置修剪成合法形状，后台传了脏数据也不会让服务端崩 */
function normalize(input: DeckConfig): DeckConfig {
  const base = defaultConfig()
  const presets = Array.isArray(input?.presets) && input.presets.length > 0 ? input.presets : base.presets
  const ids = new Set(presets.map((p) => p.id))
  return {
    version: 1,
    themeId: typeof input?.themeId === 'string' ? input.themeId : base.themeId,
    plugins: typeof input?.plugins === 'object' && input.plugins !== null ? input.plugins : {},
    presets: presets.map((p) => ({
      ...p,
      cols: clampInt(p.cols, 1, 12, 4),
      rows: clampInt(p.rows, 1, 12, 3),
      priority: Number.isFinite(p.priority) ? p.priority : 0,
      enabled: p.enabled !== false,
      slots: Array.isArray(p.slots) ? p.slots : [],
    })),
    fallbackPresetId: ids.has(input?.fallbackPresetId) ? input.fallbackPresetId : presets[0].id,
    pinnedPresetId: ids.has(input?.pinnedPresetId ?? '') ? input.pinnedPresetId : null,
    transitionMs: clampInt(input?.transitionMs, 0, 4000, base.transitionMs),
  }
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
