import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ratioOrEqual, tracksToFr } from '../core/engine'
import type { LayoutPreset, Slot } from '../core/types'
import { CardHost } from './CardHost'

/**
 * 布局切换的过渡。
 *
 * 两套布局之间常常有同一张卡片（时间几乎每套都有），换布局时让它从旧位置
 * 平滑挪到新位置，比整块面板重画一遍要好认得多——眼睛能跟住那张卡，
 * 就不会觉得「画面跳了一下」。
 *
 * 做法是 FLIP：
 *
 *   1. 每次提交后把每张卡的位置记下来（Last）
 *   2. 下次布局变了，拿上一次记的位置当起点（First）
 *   3. 先用 transform 把卡片按住在旧位置（Invert），下一帧再放开（Play），
 *      浏览器就自己把这段距离补成动画
 *
 * 三类卡片各走各的：
 *
 *   两套都有 → FLIP 位移 + 缩放
 *   只有新的 → 淡入
 *   只有旧的 → 用旧位置留个替身在原地淡出，不占新布局的格子
 *
 * 卡片的身份用「卡片键 + 第几次出现」，不能用落位 id——那玩意儿每套布局
 * 各生成一套，同一张卡在两套里 id 不同，就永远配不上对。
 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

type Item = { key: string; slot: Slot }
type Ghost = { key: string; slot: Slot; presetId: string; box: Box }
type Box = { left: number; top: number; width: number; height: number }

/** 同一张卡片在一套布局里可能摆两次，加上序号才是唯一身份 */
function identify(slots: Slot[]): Item[] {
  const seen = new Map<string, number>()
  return slots.map((slot) => {
    const n = seen.get(slot.card) ?? 0
    seen.set(slot.card, n + 1)
    return { key: `${slot.card}#${n}`, slot }
  })
}

export function Board({
  preset,
  slots,
  transitionMs,
}: {
  preset: LayoutPreset
  slots: Slot[]
  transitionMs: number
}) {
  const board = useRef<HTMLElement>(null)
  const cells = useRef(new Map<string, HTMLDivElement>())
  /** 上一次提交后各卡片的位置，FLIP 的起点 */
  const lastBoxes = useRef(new Map<string, Box>())
  const lastItems = useRef<Item[]>([])
  const lastPreset = useRef<string | null>(null)
  const [ghosts, setGhosts] = useState<Ghost[]>([])

  const items = identify(slots)

  useLayoutEffect(() => {
    const root = board.current
    if (!root) return

    const changed = lastPreset.current !== null && lastPreset.current !== preset.id
    const before = lastBoxes.current
    const origin = root.getBoundingClientRect()
    const after = new Map<string, Box>()
    for (const [key, el] of cells.current) {
      const rect = el.getBoundingClientRect()
      after.set(key, {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      })
    }

    if (changed && transitionMs > 0) {
      // ── 走掉的卡片：留个替身在旧位置淡出 ──────────────────────────────
      const leaving = lastItems.current.filter((item) => !after.has(item.key))
      const fading = leaving
        .map((item) => ({ ...item, presetId: lastPreset.current!, box: before.get(item.key)! }))
        .filter((ghost) => ghost.box)
      if (fading.length > 0) {
        setGhosts(fading)
        window.setTimeout(() => setGhosts([]), transitionMs)
      }

      // ── 留下来的 FLIP，新来的淡入 ────────────────────────────────────
      for (const [key, box] of after) {
        const el = cells.current.get(key)
        if (!el) continue
        const from = before.get(key)

        if (!from) {
          el.style.animation = `fd-cell-in ${transitionMs}ms ${EASE}`
          el.addEventListener('animationend', () => (el.style.animation = ''), { once: true })
          continue
        }

        const dx = from.left - box.left
        const dy = from.top - box.top
        const sx = box.width > 0 ? from.width / box.width : 1
        const sy = box.height > 0 ? from.height / box.height : 1
        // 位置和大小都没变就别折腾了，省得每次切换都重排一遍
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) {
          continue
        }

        el.style.transition = 'none'
        el.style.transformOrigin = 'top left'
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
        // 强制读一次布局，确保上面那帧真的落了地，否则浏览器会把两次改动合并掉
        void el.offsetWidth
        el.style.transition = `transform ${transitionMs}ms ${EASE}`
        el.style.transform = ''
        el.addEventListener(
          'transitionend',
          () => {
            el.style.transition = ''
            el.style.transformOrigin = ''
          },
          { once: true },
        )
      }
    }

    lastBoxes.current = after
    lastItems.current = items
    lastPreset.current = preset.id
  })

  const style = {
    gridTemplateColumns: tracksToFr(ratioOrEqual(preset.colRatio, preset.cols)),
    gridTemplateRows: tracksToFr(ratioOrEqual(preset.rowRatio, preset.rows)),
    '--fd-transition': `${transitionMs}ms`,
  } as CSSProperties

  return (
    <main ref={board} className="fd-board" style={style} data-preset={preset.id}>
      {items.map(({ key, slot }) => (
        <div
          key={key}
          ref={(el) => {
            if (el) cells.current.set(key, el)
            else cells.current.delete(key)
          }}
          className="fd-cell"
          data-card={slot.card}
          style={{
            gridColumn: `${slot.col} / span ${slot.colSpan}`,
            gridRow: `${slot.row} / span ${slot.rowSpan}`,
          }}
        >
          <CardHost slot={slot} presetId={preset.id} />
        </div>
      ))}

      {/* 替身：脱离网格，钉在旧位置上淡出，不影响新布局的排布 */}
      {ghosts.map((ghost) => (
        <div
          key={`ghost:${ghost.key}`}
          className="fd-cell fd-ghost"
          data-card={ghost.slot.card}
          aria-hidden
          style={{ ...ghost.box, animationDuration: `${transitionMs}ms` }}
        >
          <CardHost slot={ghost.slot} presetId={ghost.presetId} />
        </div>
      ))}
    </main>
  )
}
