import type { PluginId, PluginStates, ServerMessage } from '../../src/core/types'

/**
 * 数据中枢：所有插件 state 的唯一持有者，也是唯一的广播出口。
 * 谁改了数据都从这里过一遍，展示页才能实时看到。
 */

type Listener = (message: ServerMessage) => void

export class Hub {
  private states: PluginStates = {}
  private lastTouched = new Map<PluginId, number>()
  private listeners = new Set<Listener>()

  init(plugin: PluginId, state: unknown) {
    if (!(plugin in this.states)) this.states[plugin] = state
  }

  snapshot(): PluginStates {
    return { ...this.states }
  }

  get(plugin: PluginId): unknown {
    return this.states[plugin]
  }

  touchedAt(plugin: PluginId): number | undefined {
    return this.lastTouched.get(plugin)
  }

  set(plugin: PluginId, state: unknown) {
    // 值没变就不广播，省掉 1s 一次的心跳把所有客户端刷一遍
    if (shallowEqual(this.states[plugin], state)) {
      this.lastTouched.set(plugin, Date.now())
      return
    }
    this.states[plugin] = state
    this.lastTouched.set(plugin, Date.now())
    this.broadcast({ type: 'state', plugin, state })
  }

  patch(plugin: PluginId, patch: Record<string, unknown>) {
    const prev = (this.states[plugin] ?? {}) as Record<string, unknown>
    this.set(plugin, { ...prev, ...patch })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  broadcast(message: ServerMessage) {
    for (const listener of this.listeners) {
      try {
        listener(message)
      } catch {
        // 单个连接炸了不影响别人
      }
    }
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a as object)
  const bk = Object.keys(b as object)
  if (ak.length !== bk.length) return false
  return ak.every((k) =>
    Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}
