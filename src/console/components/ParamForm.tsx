import type { ParamSpec, ParamValues } from '../../core/types'
import { LookupField } from './LookupField'
import { withParamDefaults } from '../../core/types'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'

/**
 * 插件的设置项与触发器参数都用 ParamSpec 描述，这里统一渲染成表单。
 * 意义在于：插件作者不用写一行后台代码，声明几个参数就能在后台配。
 */
export function ParamForm({
  specs,
  values,
  onChange,
  className,
}: {
  specs: ParamSpec[]
  values: ParamValues
  onChange: (next: ParamValues) => void
  className?: string
}) {
  if (specs.length === 0) return null
  const filled = withParamDefaults(specs, values)
  const set = (key: string, value: unknown) => onChange({ ...filled, [key]: value })

  return (
    <div className={className ?? 'grid gap-4'}>
      {specs.map((spec) => (
        <div key={spec.key} className="grid gap-1.5">
          {spec.type === 'boolean' ? (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={spec.key} className="font-normal">
                {spec.label}
              </Label>
              <Switch
                id={spec.key}
                checked={Boolean(filled[spec.key])}
                onCheckedChange={(v) => set(spec.key, v)}
              />
            </div>
          ) : (
            <>
              <Label htmlFor={spec.key} className="text-muted-foreground text-xs font-normal">
                {spec.label}
                {spec.type === 'number' && spec.unit ? `（${spec.unit}）` : ''}
              </Label>
              {spec.type === 'number' && (
                <Input
                  id={spec.key}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step ?? 1}
                  value={Number(filled[spec.key])}
                  onChange={(e) => set(spec.key, Number(e.target.value))}
                  className="h-8"
                />
              )}
              {spec.type === 'string' && (
                <Input
                  id={spec.key}
                  value={String(filled[spec.key] ?? '')}
                  placeholder={spec.placeholder}
                  onChange={(e) => set(spec.key, e.target.value)}
                  className="h-8"
                />
              )}
              {spec.type === 'lookup' && (
                <LookupField
                  id={spec.key}
                  value={String(filled[spec.key] ?? '')}
                  source={spec.source}
                  groupLabel={spec.groupLabel}
                  placeholder={spec.placeholder}
                  onChange={(v) => set(spec.key, v)}
                />
              )}
              {spec.type === 'select' && (
                <Select value={String(filled[spec.key])} onValueChange={(v) => set(spec.key, v)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
          {spec.help && <p className="text-muted-foreground text-xs">{spec.help}</p>}
        </div>
      ))}
    </div>
  )
}
