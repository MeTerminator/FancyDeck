import { isCardVisible } from '../core/registry'
import { useRuntime } from '../core/runtime'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from './Board'

/**
 * 展示页。它自己没有任何布局知识——画什么、画在哪，全部来自
 * 运行时算出来的 resolution。后台改一下、音乐一响，这里就跟着变。
 */
export function Display() {
  const { config, resolution, status } = useRuntime()

  if (!resolution) {
    return (
      <ThemeProvider themeId={config.themeId} global className="fd-shell">
        <main className="fd-board fd-board--empty">
          <div className="fd-muted">还没有配置任何布局</div>
        </main>
      </ThemeProvider>
    )
  }

  const preset = resolution.preset
  const visible = preset.slots.filter((slot) => isCardVisible(config, slot.card))

  return (
    <ThemeProvider themeId={config.themeId} global className="fd-shell">
      {/*
        注意别给 Board 加 key={preset.id}：一加 key，布局一变整棵子树就重建，
        两套布局共用的卡片也跟着销毁重挂，过渡动画就无从谈起了。
      */}
      <Board preset={preset} slots={visible} transitionMs={config.transitionMs} />
      {status !== 'open' && <div className="fd-offline" title="与数据服务断开，正在重连" />}
    </ThemeProvider>
  )
}
