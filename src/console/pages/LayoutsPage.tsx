import { Copy, Minus, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { blankPreset } from '../../core/defaults'
import { clampSlots, findFreeRect, type Rect } from '../../core/engine'
import { cardLabel, getCard } from '../../core/registry'
import { useRuntime } from '../../core/runtime'
import type { LayoutPreset, Orientation, Slot } from '../../core/types'
import { CardPicker } from '../components/CardPicker'
import { ConditionEditor } from '../components/ConditionEditor'
import { GridEditor } from '../components/GridEditor'
import { LivePreview } from '../components/LivePreview'
import { PageHeader } from '../components/Shell'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Tooltip } from '../ui/tooltip'

/** 常用网格尺寸的快捷入口 */
const GRID_PRESETS = [
  { cols: 3, rows: 3 },
  { cols: 4, rows: 3 },
  { cols: 5, rows: 5 },
  { cols: 6, rows: 4 },
  { cols: 2, rows: 6 },
]

const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'any', label: '任意方向' },
  { value: 'landscape', label: '仅横屏' },
  { value: 'portrait', label: '仅竖屏' },
]

const newId = () => `s${Math.random().toString(36).slice(2, 9)}`

export function LayoutsPage() {
  const { config, setConfig, env, resolution, previewOrientation } = useRuntime()
  const [activeId, setActiveId] = useState(config.presets[0]?.id ?? '')
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  // 拖出来的区域走 rect，「从卡片库选…」走 auto——后者由 findFreeRect 自己找位置
  const [pending, setPending] = useState<{ mode: 'rect'; rect: Rect } | { mode: 'auto' } | null>(null)

  const preset = useMemo(
    () => config.presets.find((p) => p.id === activeId) ?? config.presets[0],
    [config.presets, activeId],
  )

  // 编辑哪套布局，右侧预览就按那套布局的方向来
  useEffect(() => {
    if (!preset) return
    previewOrientation(preset.orientation === 'any' ? null : preset.orientation)
    return () => previewOrientation(null)
  }, [preset?.orientation, previewOrientation])

  if (!preset) return null

  const patch = (next: Partial<LayoutPreset>) =>
    setConfig((prev) => ({
      ...prev,
      presets: prev.presets.map((p) => (p.id === preset.id ? { ...p, ...next } : p)),
    }))

  const replacePreset = (next: LayoutPreset) =>
    setConfig((prev) => ({ ...prev, presets: prev.presets.map((p) => (p.id === next.id ? next : p)) }))

  const resize = (cols: number, rows: number) =>
    patch({
      cols,
      rows,
      colRatio: undefined,
      rowRatio: undefined,
      // 网格变小时把越界的卡片裁回来，而不是让它们悄悄消失
      slots: clampSlots(preset.slots, cols, rows),
    })

  const addPreset = () => {
    const id = `p${Math.random().toString(36).slice(2, 8)}`
    const created = blankPreset(id, `新布局 ${config.presets.length + 1}`)
    setConfig((prev) => ({ ...prev, presets: [...prev.presets, created] }))
    setActiveId(id)
  }

  const duplicate = () => {
    const id = `p${Math.random().toString(36).slice(2, 8)}`
    const copy: LayoutPreset = {
      ...structuredClone(preset),
      id,
      name: `${preset.name} 副本`,
      builtin: false,
      slots: preset.slots.map((s) => ({ ...s, id: newId() })),
    }
    setConfig((prev) => ({ ...prev, presets: [...prev.presets, copy] }))
    setActiveId(id)
  }

  const remove = () => {
    if (config.presets.length <= 1) return
    setConfig((prev) => {
      const presets = prev.presets.filter((p) => p.id !== preset.id)
      return {
        ...prev,
        presets,
        fallbackPresetId: prev.fallbackPresetId === preset.id ? presets[0].id : prev.fallbackPresetId,
        pinnedPresetId: prev.pinnedPresetId === preset.id ? null : prev.pinnedPresetId,
      }
    })
    setActiveId(config.presets.find((p) => p.id !== preset.id)!.id)
  }

  const pinned = config.pinnedPresetId === preset.id
  const togglePin = () =>
    setConfig((prev) => ({ ...prev, pinnedPresetId: pinned ? null : preset.id }))

  const addCard = (cardKey: string) => {
    const size = getCard(cardKey)?.card.size
    const rect =
      pending?.mode === 'rect'
        ? pending.rect
        : findFreeRect(preset.slots, preset.cols, preset.rows, size?.defaultCols ?? 1, size?.defaultRows ?? 1)
    setPending(null)
    if (!rect) return
    const slot: Slot = { id: newId(), card: cardKey, ...rect }
    replacePreset({ ...preset, slots: [...preset.slots, slot] })
    setSelectedSlot(slot.id)
  }

  const slot = preset.slots.find((s) => s.id === selectedSlot) ?? null

  return (
    <>
      <PageHeader
        title="布局"
        description="拖出一片区域就能放卡片；给布局配上触发条件，屏幕会自己切过去。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={duplicate}>
              <Copy /> 复制
            </Button>
            <Button size="sm" onClick={addPreset}>
              <Plus /> 新建布局
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        {/* ── 布局列表 ───────────────────────────────────────────────────── */}
        <div className="grid content-start gap-1.5">
          {config.presets.map((item) => {
            const isLive = resolution?.preset.id === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveId(item.id)
                  setSelectedSlot(null)
                }}
                className={cn(
                  'grid gap-1 rounded-lg border p-2.5 text-left transition-colors',
                  item.id === preset.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  !item.enabled && 'opacity-55',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  {isLive && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-emerald-500" />}
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-mono">
                    {item.cols}×{item.rows}
                  </span>
                  <span>·</span>
                  <span>{item.slots.length} 张卡</span>
                  {item.orientation !== 'any' && (
                    <Badge variant="outline" className="px-1 py-0 text-[10px]">
                      {item.orientation === 'portrait' ? '竖' : '横'}
                    </Badge>
                  )}
                  {config.fallbackPresetId === item.id && (
                    <Badge variant="muted" className="px-1 py-0 text-[10px]">
                      兜底
                    </Badge>
                  )}
                  {config.pinnedPresetId === item.id && (
                    <Badge className="px-1 py-0 text-[10px]">已钉住</Badge>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* ── 编辑区 ─────────────────────────────────────────────────────── */}
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={preset.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="h-8 max-w-56 font-medium"
                  aria-label="布局名称"
                />
                <div className="ml-auto flex items-center gap-2">
                  <Tooltip label={pinned ? '取消钉住，交还给触发条件' : '钉住这套布局，屏幕先按它显示'}>
                    <Button variant={pinned ? 'default' : 'outline'} size="sm" onClick={togglePin}>
                      {pinned ? <PinOff /> : <Pin />} {pinned ? '已钉住' : '钉住预览'}
                    </Button>
                  </Tooltip>
                  <Tooltip label="停用后这套布局不再参与匹配">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="enabled" className="text-muted-foreground text-xs font-normal">
                        启用
                      </Label>
                      <Switch
                        id="enabled"
                        checked={preset.enabled}
                        onCheckedChange={(v) => patch({ enabled: v })}
                      />
                    </div>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={remove}
                    disabled={config.presets.length <= 1}
                    aria-label="删除这套布局"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="grid gap-4 pt-0">
              {/* 网格数量 */}
              <div className="flex flex-wrap items-center gap-4">
                <Stepper label="列" value={preset.cols} min={1} max={12} onChange={(v) => resize(v, preset.rows)} />
                <Stepper label="行" value={preset.rows} min={1} max={12} onChange={(v) => resize(preset.cols, v)} />
                <Separator orientation="vertical" className="h-6" />
                <div className="flex flex-wrap items-center gap-1.5">
                  {GRID_PRESETS.map((g) => (
                    <Button
                      key={`${g.cols}x${g.rows}`}
                      variant={preset.cols === g.cols && preset.rows === g.rows ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2 font-mono text-xs"
                      onClick={() => resize(g.cols, g.rows)}
                    >
                      {g.cols}×{g.rows}
                    </Button>
                  ))}
                </div>
              </div>

              <GridEditor
                preset={preset}
                config={config}
                selectedId={selectedSlot}
                onSelect={setSelectedSlot}
                onChange={replacePreset}
                onRequestAdd={(rect) => setPending({ mode: 'rect', rect })}
              />

              <p className="text-muted-foreground text-xs">
                在空白处按住拖出一片区域放卡片 · 拖动卡片可搬家 · 拖右下角改大小 · 选中后按 Delete 移除
              </p>

              <RatioEditor preset={preset} onChange={replacePreset} />
            </CardContent>
          </Card>

          {/* 选中的卡片 */}
          {slot && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{cardLabel(slot.card)}</CardTitle>
                <CardDescription>
                  第 {slot.col} 列第 {slot.row} 行，占 {slot.colSpan}×{slot.rowSpan} 格
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-4 pt-0">
                <Stepper
                  label="宽"
                  value={slot.colSpan}
                  min={getCard(slot.card)?.card.size.minCols ?? 1}
                  max={preset.cols - slot.col + 1}
                  onChange={(v) => replacePreset(patchSlot(preset, slot.id, { colSpan: v }))}
                />
                <Stepper
                  label="高"
                  value={slot.rowSpan}
                  min={getCard(slot.card)?.card.size.minRows ?? 1}
                  max={preset.rows - slot.row + 1}
                  onChange={(v) => replacePreset(patchSlot(preset, slot.id, { rowSpan: v }))}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    replacePreset({ ...preset, slots: preset.slots.filter((s) => s.id !== slot.id) })
                    setSelectedSlot(null)
                  }}
                >
                  <Trash2 /> 移除
                </Button>
              </CardContent>
            </Card>
          )}

          {/* 触发条件 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">什么时候用这套布局</CardTitle>
              <CardDescription>
                条件由插件提供。多套布局同时成立时，优先级数值大的赢。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              <ConditionEditor value={preset.when} env={env} onChange={(when) => patch({ when })} />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground text-xs font-normal">优先级</Label>
                  <Input
                    type="number"
                    className="h-8"
                    value={preset.priority}
                    onChange={(e) => patch({ priority: Number(e.target.value) })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground text-xs font-normal">适用方向</Label>
                  <Select
                    value={preset.orientation}
                    onValueChange={(v) => patch({ orientation: v as Orientation })}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIENTATIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground text-xs font-normal">最短停留（毫秒）</Label>
                  <Input
                    type="number"
                    step={500}
                    min={0}
                    className="h-8"
                    value={preset.holdMs ?? 0}
                    onChange={(e) => patch({ holdMs: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="fallback"
                  checked={config.fallbackPresetId === preset.id}
                  onCheckedChange={(v) => v && setConfig((prev) => ({ ...prev, fallbackPresetId: preset.id }))}
                />
                <Label htmlFor="fallback" className="text-muted-foreground text-xs font-normal">
                  作为兜底布局（什么条件都没命中时显示它）
                </Label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── 预览与快速添加 ─────────────────────────────────────────────── */}
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">实时预览</CardTitle>
              <CardDescription>
                这就是展示页本身。钉住某套布局即可在这里核对效果。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <LivePreview orientation={preset.orientation === 'portrait' ? 'portrait' : 'landscape'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">快速添加</CardTitle>
              <CardDescription>自动找个空位放进去</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 pt-0">
              <Button variant="outline" size="sm" onClick={() => setPending({ mode: 'auto' })}>
                <Plus /> 从卡片库选…
              </Button>
              <Separator className="my-2" />
              {preset.slots.length === 0 && (
                <p className="text-muted-foreground text-xs">还没有卡片，先加一张。</p>
              )}
              {preset.slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSlot(s.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    s.id === selectedSlot ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
                  )}
                >
                  <span className="truncate">{cardLabel(s.card)}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 font-mono">
                    {s.colSpan}×{s.rowSpan}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <CardPicker
        open={pending !== null}
        rect={pending?.mode === 'rect' ? pending.rect : null}
        config={config}
        onClose={() => setPending(null)}
        onPick={addCard}
      />
    </>
  )
}

const patchSlot = (preset: LayoutPreset, id: string, patch: Partial<Slot>): LayoutPreset => ({
  ...preset,
  slots: preset.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
})

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center rounded-md border">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-r-none"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          aria-label={`减少${label}`}
        >
          <Minus />
        </Button>
        <span className="w-7 text-center font-mono text-xs">{value}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-l-none"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          aria-label={`增加${label}`}
        >
          <Plus />
        </Button>
      </div>
    </div>
  )
}

/** 列宽与行高的比例。默认等分，拉一下就能让中间那列宽一些。 */
function RatioEditor({
  preset,
  onChange,
}: {
  preset: LayoutPreset
  onChange: (next: LayoutPreset) => void
}) {
  const cols = preset.colRatio ?? Array.from({ length: preset.cols }, () => 1)
  const rows = preset.rowRatio ?? Array.from({ length: preset.rows }, () => 1)
  const even = !preset.colRatio && !preset.rowRatio

  const setCol = (index: number, value: number) => {
    const next = [...cols]
    next[index] = value
    onChange({ ...preset, colRatio: next })
  }
  const setRow = (index: number, value: number) => {
    const next = [...rows]
    next[index] = value
    onChange({ ...preset, rowRatio: next })
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">列宽与行高比例</span>
        {!even && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...preset, colRatio: undefined, rowRatio: undefined })}
          >
            恢复等分
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground w-6 text-xs">列</span>
          {cols.map((value, index) => (
            <Input
              key={index}
              type="number"
              min={1}
              max={12}
              value={value}
              onChange={(e) => setCol(index, Math.max(1, Number(e.target.value)))}
              className="h-7 w-12 px-1.5 text-center font-mono text-xs"
              aria-label={`第 ${index + 1} 列宽度比例`}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground w-6 text-xs">行</span>
          {rows.map((value, index) => (
            <Input
              key={index}
              type="number"
              min={1}
              max={12}
              value={value}
              onChange={(e) => setRow(index, Math.max(1, Number(e.target.value)))}
              className="h-7 w-12 px-1.5 text-center font-mono text-xs"
              aria-label={`第 ${index + 1} 行高度比例`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
