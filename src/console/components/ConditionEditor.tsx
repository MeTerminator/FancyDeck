import { Plus, X } from 'lucide-react'
import { evaluateCondition, type EvalEnv } from '../../core/engine'
import { allTriggers, getTrigger } from '../../core/registry'
import type { Condition, ParamValues } from '../../core/types'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { ParamForm } from './ParamForm'

/**
 * 触发条件编辑器。插件把「在音乐播放时」这类判断注册进来，
 * 这里只负责把它们组合成一棵与/或/非的树——后台完全不知道音乐是什么。
 *
 * 编辑时旁边实时显示每个条件此刻的真假，配完就能看出会不会命中。
 */

const KIND_OPTIONS = [
  { value: 'always', label: '始终成立（兜底布局）' },
  { value: 'never', label: '从不（手动才用）' },
  { value: 'trigger', label: '插件条件' },
  { value: 'all', label: '同时满足（与）' },
  { value: 'any', label: '任一满足（或）' },
  { value: 'not', label: '取反（非）' },
] as const

function makeCondition(kind: Condition['kind'], previous: Condition): Condition {
  switch (kind) {
    case 'always':
      return { kind: 'always' }
    case 'never':
      return { kind: 'never' }
    case 'trigger':
      return { kind: 'trigger', ref: allTriggers()[0]?.key ?? '', params: {} }
    case 'all':
    case 'any':
      return { kind, of: previous.kind === 'all' || previous.kind === 'any' ? previous.of : [previous] }
    case 'not':
      return { kind: 'not', of: previous.kind === 'not' ? previous.of : previous }
  }
}

export function ConditionEditor({
  value,
  onChange,
  env,
  depth = 0,
}: {
  value: Condition
  onChange: (next: Condition) => void
  /** 传进来就能实时显示这条件此刻真不真 */
  env?: EvalEnv
  depth?: number
}) {
  const truth = env ? evaluateCondition(value, env) : null
  const grouped = allTriggers().reduce<Record<string, ReturnType<typeof allTriggers>>>((acc, item) => {
    ;(acc[item.plugin.name] ??= []).push(item)
    return acc
  }, {})

  return (
    <div
      className={cn(
        'grid gap-2.5 rounded-lg border p-3',
        depth > 0 && 'bg-muted/40',
        truth === true && 'border-emerald-500/50',
      )}
    >
      <div className="flex items-center gap-2">
        <Select
          value={value.kind}
          onValueChange={(kind) => onChange(makeCondition(kind as Condition['kind'], value))}
        >
          <SelectTrigger size="sm" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {truth !== null && (
          <Badge variant={truth ? 'success' : 'muted'} className="ml-auto font-mono text-[10px]">
            {truth ? '此刻成立' : '此刻不成立'}
          </Badge>
        )}
      </div>

      {value.kind === 'trigger' && (
        <TriggerRow
          refKey={value.ref}
          params={value.params ?? {}}
          grouped={grouped}
          onChange={(ref, params) => onChange({ kind: 'trigger', ref, params })}
        />
      )}

      {(value.kind === 'all' || value.kind === 'any') && (
        <div className="grid gap-2 pl-3">
          {value.of.map((child, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ConditionEditor
                  value={child}
                  env={env}
                  depth={depth + 1}
                  onChange={(next) =>
                    onChange({ ...value, of: value.of.map((c, i) => (i === index ? next : c)) })
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="删除这一条"
                onClick={() => onChange({ ...value, of: value.of.filter((_, i) => i !== index) })}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              onChange({ ...value, of: [...value.of, { kind: 'trigger', ref: allTriggers()[0]?.key ?? '', params: {} }] })
            }
          >
            <Plus /> 添加条件
          </Button>
        </div>
      )}

      {value.kind === 'not' && (
        <div className="pl-3">
          <ConditionEditor
            value={value.of}
            env={env}
            depth={depth + 1}
            onChange={(next) => onChange({ kind: 'not', of: next })}
          />
        </div>
      )}
    </div>
  )
}

function TriggerRow({
  refKey,
  params,
  grouped,
  onChange,
}: {
  refKey: string
  params: ParamValues
  grouped: Record<string, ReturnType<typeof allTriggers>>
  onChange: (ref: string, params: ParamValues) => void
}) {
  const found = getTrigger(refKey)
  const specs = found?.def.params ?? []

  return (
    <div className="grid gap-2.5">
      <Select value={refKey} onValueChange={(next) => onChange(next, {})}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="选一个插件条件" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(grouped).map(([pluginName, items]) => (
            // 必须是 SelectGroup 而不是 div：SelectLabel 靠 group 的 context 拿 id，
            // 包在普通元素里 Radix 会直接抛「must be used within SelectGroup」
            <SelectGroup key={pluginName}>
              <SelectLabel>{pluginName}</SelectLabel>
              {items.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.def.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {found?.def.description && <p className="text-muted-foreground text-xs">{found.def.description}</p>}
      {!found && refKey && (
        <p className="text-destructive text-xs">条件 {refKey} 所属的插件没有安装</p>
      )}

      {specs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <ParamForm
            specs={specs}
            values={params}
            onChange={(next) => onChange(refKey, next)}
            className="col-span-2 grid grid-cols-2 gap-3"
          />
        </div>
      )}
    </div>
  )
}
