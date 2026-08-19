import { useEffect, useRef, useState } from 'react'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { cn } from '../lib/utils'

export type LookupOption = { value: string; label: string; group?: string }

const get = (url: string): Promise<LookupOption[]> =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])

/**
 * 候选项由服务端按需给的选择器。用于城市这种几千条、既装不进下拉框
 * 也不该打包进浏览器的选项集。
 *
 * 给了 groupLabel 就是两级：上面一个组下拉（省份），下面在组内搜索（城市）。
 * 但存下来的始终只有二级那一个值——组是从回显里反推的，不落进配置。
 *
 * 它不认识天气，只认识 ParamSpec 里那个 source 地址。
 */
export function LookupField({
  id,
  value,
  source,
  groupLabel,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  source: string
  groupLabel?: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  const [groups, setGroups] = useState<LookupOption[]>([])
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<LookupOption[]>([])
  const [open, setOpen] = useState(false)
  /** 当前选中项的名字，只为了让框里显示「萧山」而不是一串数字 */
  const [selected, setSelected] = useState<LookupOption | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // 一级候选只在挂载时取一次
  useEffect(() => {
    if (!groupLabel) return
    let alive = true
    void get(`${source}?groups=1`).then((list) => alive && setGroups(list))
    return () => {
      alive = false
    }
  }, [source, groupLabel])

  // 回显：value 变了就问服务端它叫什么、属于哪一组
  useEffect(() => {
    if (!value) return setSelected(null)
    let alive = true
    void get(`${source}?value=${encodeURIComponent(value)}`).then((list) => {
      if (!alive) return
      const hit = list[0] ?? { value, label: value }
      setSelected(hit)
      // 用户正在翻别的组时别把他拽回去
      if (hit.group && !open) setGroup(hit.group)
    })
    return () => {
      alive = false
    }
    // open 只用来避免打断操作，不该反过来触发回显
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, source])

  // 二级候选：换组或改关键词都重取，按键停 200ms 再发
  useEffect(() => {
    if (!open) return
    let alive = true
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ group, q: query })
      void get(`${source}?${q}`).then((list) => alive && setOptions(list))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, group, source, open])

  // 点到外面就收起来
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (option: LookupOption) => {
    onChange(option.value)
    setSelected(option)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={box} className="relative grid gap-1.5">
      {groupLabel && (
        <Select
          value={group}
          onValueChange={(v) => {
            setGroup(v)
            setQuery('')
            setOpen(true)
          }}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder={`选择${groupLabel}`} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="relative">
        <Input
          id={id}
          value={open ? query : (selected?.label ?? '')}
          placeholder={placeholder ?? '输入关键词搜索'}
          className="h-8"
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && options[0]) {
              e.preventDefault()
              pick(options[0])
            }
          }}
        />
        {open && (
          <div className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border p-1 shadow-md">
            {options.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">没有匹配的结果</div>
            ) : (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => pick(option)}
                  className={cn(
                    'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm',
                    option.value === value && 'bg-accent/60',
                  )}
                >
                  <span>{option.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">{option.value}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
