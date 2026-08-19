import { useMemo, useState } from 'react'
import type { Rect } from '../../core/engine'
import { allCards } from '../../core/registry'
import type { DeckConfig } from '../../core/types'
import { isPluginEnabled } from '../../core/registry'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { pluginIcon } from './Shell'

/**
 * 卡片选择框。列出所有已安装插件提供的卡片，
 * 放不进当前选区的（比如「封面+控制」至少要 2 格宽）会标灰并给出原因。
 */
export function CardPicker({
  open,
  rect,
  config,
  onClose,
  onPick,
}: {
  open: boolean
  rect: Rect | null
  config: DeckConfig
  onClose: () => void
  onPick: (cardKey: string) => void
}) {
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return allCards()
      .filter((entry) =>
        keyword === ''
          ? true
          : `${entry.plugin.name}${entry.card.name}${entry.key}`.toLowerCase().includes(keyword),
      )
      .map((entry) => {
        const tooSmall =
          rect !== null &&
          (rect.colSpan < entry.card.size.minCols || rect.rowSpan < entry.card.size.minRows)
        return { ...entry, tooSmall, off: !isPluginEnabled(config, entry.plugin.id) }
      })
  }, [query, rect, config])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>放一张卡片</DialogTitle>
          <DialogDescription>
            {rect ? `将占据第 ${rect.col} 列第 ${rect.row} 行起的 ${rect.colSpan}×${rect.rowSpan} 格` : ''}
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="搜索卡片或插件…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ScrollArea className="h-80 -mr-2 pr-2">
          <div className="grid gap-1.5">
            {items.map((item) => {
              const Icon = pluginIcon(item.plugin.icon)
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={item.tooSmall}
                  onClick={() => onPick(item.key)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    item.tooSmall ? 'cursor-not-allowed opacity-45' : 'hover:border-primary hover:bg-accent',
                  )}
                >
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{item.card.name}</span>
                      <Badge variant="muted" className="text-[10px]">
                        {item.plugin.name}
                      </Badge>
                      {item.off && (
                        <Badge variant="outline" className="text-[10px]">
                          插件已关闭
                        </Badge>
                      )}
                    </div>
                    {item.card.description && (
                      <p className="text-muted-foreground mt-0.5 text-xs">{item.card.description}</p>
                    )}
                    {item.tooSmall && (
                      <p className="text-destructive mt-0.5 text-xs">
                        至少需要 {item.card.size.minCols}×{item.card.size.minRows} 格
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                    {item.card.size.defaultCols}×{item.card.size.defaultRows}
                  </span>
                </button>
              )
            })}
            {items.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">没有匹配的卡片</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
