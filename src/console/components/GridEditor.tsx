import { GripVertical, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ratioOrEqual, rectInsideGrid, rectsOverlap, tracksToFr, type Rect } from '../../core/engine'
import { cardLabel, getCard, isPluginEnabled } from '../../core/registry'
import type { DeckConfig, LayoutPreset, Slot } from '../../core/types'
import { cn } from '../lib/utils'
import { pluginIcon } from './Shell'

/**
 * 可视化网格编辑器。
 *
 *   在空白处按住拖一片 → 松手弹出卡片选择框，把卡片放进这片区域
 *   拖卡片本体          → 整块搬走
 *   拖右下角的小把手    → 改变占几格
 *
 * 它不知道任何一张卡片的内容，只认「哪张卡 + 占哪几格」。
 */

type DragState =
  | { mode: 'marquee'; from: Rect }
  | { mode: 'move'; slotId: string; grab: { dc: number; dr: number } }
  | { mode: 'resize'; slotId: string }

export type GridEditorProps = {
  preset: LayoutPreset
  config: DeckConfig
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (next: LayoutPreset) => void
  onRequestAdd: (rect: Rect) => void
}

export function GridEditor({
  preset,
  config,
  selectedId,
  onSelect,
  onChange,
  onRequestAdd,
}: GridEditorProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hover, setHover] = useState<Rect | null>(null)

  const cols = ratioOrEqual(preset.colRatio, preset.cols)
  const rows = ratioOrEqual(preset.rowRatio, preset.rows)

  /** 屏幕坐标 → 第几列第几行。按比例累加，所以非等分网格也算得准。 */
  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const box = boardRef.current?.getBoundingClientRect()
      if (!box) return { col: 1, row: 1 }
      const pick = (offset: number, size: number, ratio: number[]) => {
        const total = ratio.reduce((a, b) => a + b, 0)
        let acc = 0
        for (let i = 0; i < ratio.length; i += 1) {
          acc += ratio[i]
          if (offset < (acc / total) * size) return i + 1
        }
        return ratio.length
      }
      return {
        col: pick(clientX - box.left, box.width, cols),
        row: pick(clientY - box.top, box.height, rows),
      }
    },
    [cols, rows],
  )

  const fits = (rect: Rect, ignoreId?: string) =>
    rectInsideGrid(rect, preset.cols, preset.rows) &&
    !preset.slots.some((s) => s.id !== ignoreId && rectsOverlap(s, rect))

  // ── 拖拽 ──────────────────────────────────────────────────────────────────

  const startMarquee = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const at = cellAt(event.clientX, event.clientY)
    const rect = { col: at.col, row: at.row, colSpan: 1, rowSpan: 1 }
    if (preset.slots.some((s) => rectsOverlap(s, rect))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(null)
    setDrag({ mode: 'marquee', from: rect })
    setHover(rect)
  }

  const startMove = (event: ReactPointerEvent, slot: Slot) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const at = cellAt(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(slot.id)
    setDrag({ mode: 'move', slotId: slot.id, grab: { dc: at.col - slot.col, dr: at.row - slot.row } })
  }

  const startResize = (event: ReactPointerEvent, slot: Slot) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(slot.id)
    setDrag({ mode: 'resize', slotId: slot.id })
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag) return
    const at = cellAt(event.clientX, event.clientY)

    if (drag.mode === 'marquee') {
      setHover({
        col: Math.min(drag.from.col, at.col),
        row: Math.min(drag.from.row, at.row),
        colSpan: Math.abs(at.col - drag.from.col) + 1,
        rowSpan: Math.abs(at.row - drag.from.row) + 1,
      })
      return
    }

    const slot = preset.slots.find((s) => s.id === drag.slotId)
    if (!slot) return

    if (drag.mode === 'move') {
      const next = {
        ...slot,
        col: Math.min(Math.max(1, at.col - drag.grab.dc), preset.cols - slot.colSpan + 1),
        row: Math.min(Math.max(1, at.row - drag.grab.dr), preset.rows - slot.rowSpan + 1),
      }
      if (next.col !== slot.col || next.row !== slot.row) {
        if (fits(next, slot.id)) onChange(replace(preset, next))
      }
      return
    }

    const min = getCard(slot.card)?.card.size
    const next = {
      ...slot,
      colSpan: Math.max(min?.minCols ?? 1, at.col - slot.col + 1),
      rowSpan: Math.max(min?.minRows ?? 1, at.row - slot.row + 1),
    }
    if (next.colSpan !== slot.colSpan || next.rowSpan !== slot.rowSpan) {
      if (fits(next, slot.id)) onChange(replace(preset, next))
    }
  }

  const onPointerUp = () => {
    if (drag?.mode === 'marquee' && hover) onRequestAdd(hover)
    setDrag(null)
    setHover(null)
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={boardRef}
      className="bg-muted/50 relative grid touch-none select-none gap-1.5 rounded-xl border p-1.5"
      style={{
        gridTemplateColumns: tracksToFr(cols),
        gridTemplateRows: tracksToFr(rows),
        aspectRatio: `${preset.cols} / ${preset.rows}`,
      }}
      onPointerDown={startMarquee}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* 空格背景 */}
      {Array.from({ length: preset.cols * preset.rows }, (_, i) => (
        <div
          key={i}
          className="border-border/70 rounded-md border border-dashed"
          style={{ gridColumn: (i % preset.cols) + 1, gridRow: Math.floor(i / preset.cols) + 1 }}
        />
      ))}

      {/* 已放置的卡片 */}
      {preset.slots.map((slot) => {
        const entry = getCard(slot.card)
        const Icon = pluginIcon(entry?.plugin.icon)
        const off = entry ? !isPluginEnabled(config, entry.plugin.id) : false
        const selected = slot.id === selectedId
        return (
          <div
            key={slot.id}
            role="button"
            tabIndex={0}
            aria-label={`${cardLabel(slot.card)}，占 ${slot.colSpan}×${slot.rowSpan} 格`}
            onPointerDown={(e) => startMove(e, slot)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(slot.id)
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                onChange({ ...preset, slots: preset.slots.filter((s) => s.id !== slot.id) })
              }
            }}
            className={cn(
              'group relative z-10 flex cursor-grab flex-col justify-between gap-1 overflow-hidden rounded-md border p-2 text-left transition-colors active:cursor-grabbing',
              selected
                ? 'border-primary bg-primary/10 ring-primary/30 ring-2'
                : 'bg-card hover:border-primary/50 border-border',
              off && 'opacity-45',
              !entry && 'border-destructive/60 bg-destructive/10',
            )}
            style={{
              gridColumn: `${slot.col} / span ${slot.colSpan}`,
              gridRow: `${slot.row} / span ${slot.rowSpan}`,
            }}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate text-xs font-medium">{entry?.card.name ?? slot.card}</span>
            </div>
            <div className="text-muted-foreground flex items-center justify-between gap-1 text-[10px]">
              <span className="truncate">{entry?.plugin.name ?? '未安装'}</span>
              <span className="font-mono">
                {slot.colSpan}×{slot.rowSpan}
              </span>
            </div>

            {off && (
              <span className="text-muted-foreground absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px]">
                插件已关闭 · 不显示
              </span>
            )}

            <button
              type="button"
              aria-label="移除这张卡片"
              className="bg-background/90 text-muted-foreground hover:text-destructive absolute top-1 right-1 hidden rounded p-0.5 group-hover:block"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChange({ ...preset, slots: preset.slots.filter((s) => s.id !== slot.id) })}
            >
              <Trash2 className="size-3" />
            </button>

            <span
              role="presentation"
              aria-hidden
              onPointerDown={(e) => startResize(e, slot)}
              className="text-muted-foreground hover:text-primary absolute right-0 bottom-0 cursor-nwse-resize p-0.5"
            >
              <GripVertical className="size-3 rotate-45" />
            </span>
          </div>
        )
      })}

      {/* 拖选中的高亮区 */}
      {drag?.mode === 'marquee' && hover && (
        <div
          className="border-primary bg-primary/15 pointer-events-none z-20 grid place-items-center rounded-md border-2 border-dashed"
          style={{
            gridColumn: `${hover.col} / span ${hover.colSpan}`,
            gridRow: `${hover.row} / span ${hover.rowSpan}`,
          }}
        >
          <span className="text-primary font-mono text-xs">
            {hover.colSpan}×{hover.rowSpan}
          </span>
        </div>
      )}
    </div>
  )
}

const replace = (preset: LayoutPreset, slot: Slot): LayoutPreset => ({
  ...preset,
  slots: preset.slots.map((s) => (s.id === slot.id ? slot : s)),
})
