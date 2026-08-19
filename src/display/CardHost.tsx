import { Component, type ReactNode } from 'react'
import { getCard } from '../core/registry'
import { useRuntime } from '../core/runtime'
import { withParamDefaults, type CardContext, type Slot } from '../core/types'
import { Tile } from '../ui/Tile'

/** 一张卡片崩了不该把整块屏拖黑 */
class CardBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`[fancydeck] 卡片「${this.props.name}」渲染失败：`, error)
  }

  render() {
    if (this.state.failed) {
      return (
        <Tile label={this.props.name}>
          <div className="fd-muted" style={{ fontSize: 'clamp(11px, 1.4vmin, 15px)' }}>
            这张卡片出错了
          </div>
        </Tile>
      )
    }
    return this.props.children
  }
}

/** 把一个落位变成一张真正的卡片：查注册表 → 组装上下文 → 渲染 */
export function CardHost({ slot, presetId }: { slot: Slot; presetId: string }) {
  const runtime = useRuntime()
  const entry = getCard(slot.card)

  if (!entry) {
    return (
      <Tile label="缺失">
        <div className="fd-muted" style={{ fontSize: 'clamp(11px, 1.4vmin, 15px)' }}>
          {slot.card}
        </div>
      </Tile>
    )
  }

  const { plugin, card } = entry
  const ctx: CardContext<unknown> = {
    state: runtime.states[plugin.id] ?? plugin.defaultState,
    settings: withParamDefaults(plugin.settings, runtime.config.plugins[plugin.id]?.settings),
    span: { cols: slot.colSpan, rows: slot.rowSpan },
    presetId,
    now: runtime.now,
    command: (action, payload) => runtime.command(plugin.id, action, payload),
    patchState: (patch) => runtime.patchState(plugin.id, patch as Record<string, unknown>),
  }

  const Render = card.render
  return (
    <CardBoundary name={`${plugin.name} · ${card.name}`}>
      <Render {...ctx} />
    </CardBoundary>
  )
}
