import { plugins } from '../plugins'
import type { AnyPlugin, ClientCard } from './plugin'
import {
  splitKey,
  withParamDefaults,
  type CardKey,
  type DeckConfig,
  type ParamValues,
  type PluginId,
  type TriggerDefinition,
  type TriggerKey,
} from './types'

/**
 * 前端插件注册表。所有「按 key 找卡片 / 找触发器」都从这里走，
 * 展示页与管理后台看到的是同一份，不会出现后台能选但屏幕上画不出来的卡片。
 */

const byId = new Map<PluginId, AnyPlugin>(plugins.map((p) => [p.id, p]))

export const allPlugins = plugins

export const getPlugin = (id: PluginId): AnyPlugin | undefined => byId.get(id)

export type CardEntry = { plugin: AnyPlugin; card: ClientCard<any>; key: CardKey }

const cardIndex = new Map<CardKey, CardEntry>()
const triggerIndex = new Map<TriggerKey, { plugin: AnyPlugin; def: TriggerDefinition<any> }>()

for (const plugin of plugins) {
  for (const card of plugin.cards) {
    cardIndex.set(`${plugin.id}:${card.id}`, { plugin, card, key: `${plugin.id}:${card.id}` })
  }
  for (const trigger of plugin.triggers ?? []) {
    triggerIndex.set(`${plugin.id}:${trigger.id}`, { plugin, def: trigger })
  }
}

export const getCard = (key: CardKey): CardEntry | undefined => cardIndex.get(key)
export const allCards = (): CardEntry[] => [...cardIndex.values()]

export const getTrigger = (key: TriggerKey) => {
  const found = triggerIndex.get(key)
  return found ? { plugin: found.plugin.id, def: found.def } : undefined
}
export const allTriggers = (): { key: TriggerKey; plugin: AnyPlugin; def: TriggerDefinition<any> }[] =>
  [...triggerIndex.entries()].map(([key, v]) => ({ key, ...v }))

/** 卡片键对应的插件是否开着 */
export const isPluginEnabled = (config: DeckConfig, id: PluginId): boolean => {
  const entry = config.plugins[id]
  if (entry) return entry.enabled
  return getPlugin(id)?.defaultEnabled !== false
}

export const isCardVisible = (config: DeckConfig, key: CardKey): boolean => {
  const entry = cardIndex.get(key)
  if (!entry) return false
  return isPluginEnabled(config, entry.plugin.id)
}

/** 所有插件的设置，已补上 ParamSpec 里的默认值 */
export function resolveSettings(config: DeckConfig): Record<PluginId, ParamValues> {
  const out: Record<PluginId, ParamValues> = {}
  for (const plugin of plugins) {
    out[plugin.id] = withParamDefaults(plugin.settings, config.plugins[plugin.id]?.settings)
  }
  return out
}

/** 卡片键的人话名字，后台到处要用 */
export function cardLabel(key: CardKey): string {
  const entry = cardIndex.get(key)
  if (entry) return `${entry.plugin.name} · ${entry.card.name}`
  const [plugin, card] = splitKey(key)
  return `${plugin} · ${card}（未安装）`
}
