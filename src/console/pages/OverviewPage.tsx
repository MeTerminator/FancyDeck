import { ArrowRight, Pin, PinOff } from 'lucide-react'
import { Link } from 'react-router'
import { evaluateCondition } from '../../core/engine'
import { allPlugins, allTriggers, isPluginEnabled } from '../../core/registry'
import { useRuntime } from '../../core/runtime'
import { evaluateTrigger } from '../../core/engine'
import { LivePreview } from '../components/LivePreview'
import { PageHeader, pluginIcon } from '../components/Shell'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

const REASON: Record<string, string> = {
  pinned: '被后台钉住',
  trigger: '触发条件命中',
  fallback: '没有条件命中，走兜底',
}

/** 概览：一眼看清「现在显示的是哪套布局、为什么是它」。 */
export function OverviewPage() {
  const { config, resolution, env, setConfig, orientation, states } = useRuntime()

  const triggers = allTriggers()
    .filter((t) => isPluginEnabled(config, t.plugin.id))
    .map((t) => ({ ...t, on: evaluateTrigger(t.key, undefined, env) }))

  return (
    <>
      <PageHeader
        title="概览"
        description="展示页正在显示什么，以及它为什么这么显示。"
        actions={
          config.pinnedPresetId && (
            <Button variant="outline" size="sm" onClick={() => setConfig((p) => ({ ...p, pinnedPresetId: null }))}>
              <PinOff /> 取消钉住，交还给自动切换
            </Button>
          )
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">当前生效</CardTitle>
              <CardDescription>屏幕方向：{orientation === 'portrait' ? '竖屏' : '横屏'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0">
              {resolution ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-2xl font-medium tracking-tight">{resolution.preset.name}</span>
                    <Badge variant={resolution.reason === 'pinned' ? 'default' : 'secondary'}>
                      {REASON[resolution.reason]}
                    </Badge>
                    <span className="text-muted-foreground font-mono text-xs">
                      {resolution.preset.cols}×{resolution.preset.rows} · {resolution.preset.slots.length} 张卡
                    </span>
                    <Button variant="ghost" size="sm" className="ml-auto" asChild>
                      <Link to="/layouts">
                        去编辑 <ArrowRight />
                      </Link>
                    </Button>
                  </div>

                  <div className="grid gap-1.5">
                    <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
                      候选布局（条件此刻成立的）
                    </div>
                    {config.presets
                      .filter((p) => p.enabled)
                      .map((preset) => {
                        const matched = evaluateCondition(preset.when, env)
                        const live = resolution.preset.id === preset.id
                        return (
                          <div
                            key={preset.id}
                            className={cn(
                              'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                              live && 'border-primary bg-primary/5',
                            )}
                          >
                            <span className={cn(!matched && 'text-muted-foreground')}>{preset.name}</span>
                            {matched ? (
                              <Badge variant="success" className="text-[10px]">
                                条件成立
                              </Badge>
                            ) : (
                              <Badge variant="muted" className="text-[10px]">
                                未命中
                              </Badge>
                            )}
                            <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                              优先级 {preset.priority}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`钉住 ${preset.name}`}
                              onClick={() =>
                                setConfig((prev) => ({
                                  ...prev,
                                  pinnedPresetId: prev.pinnedPresetId === preset.id ? null : preset.id,
                                }))
                              }
                            >
                              <Pin
                                className={cn(config.pinnedPresetId === preset.id && 'text-primary fill-current')}
                              />
                            </Button>
                          </div>
                        )
                      })}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">还没有可用的布局。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">触发条件实况</CardTitle>
              <CardDescription>所有已启用插件此刻对外报出的真假值</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5 pt-0">
              {triggers.map((trigger) => (
                <Badge key={trigger.key} variant={trigger.on ? 'success' : 'muted'} className="gap-1.5">
                  <span className={cn('size-1.5 rounded-full', trigger.on ? 'bg-emerald-500' : 'bg-current opacity-40')} />
                  {trigger.plugin.name} · {trigger.def.name}
                </Badge>
              ))}
              {triggers.length === 0 && <span className="text-muted-foreground text-sm">没有可用的触发条件</span>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">插件数据</CardTitle>
              <CardDescription>最近一次收到上报的时间</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 pt-0">
              {allPlugins.map((plugin) => {
                const Icon = pluginIcon(plugin.icon)
                const state = states[plugin.id] as { updatedAt?: number } | undefined
                const enabled = isPluginEnabled(config, plugin.id)
                return (
                  <div key={plugin.id} className="flex items-center gap-2.5 text-sm">
                    <Icon className="text-muted-foreground size-3.5" />
                    <span className={cn(!enabled && 'text-muted-foreground line-through')}>{plugin.name}</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {!plugin.routes
                        ? '本地数据'
                        : state?.updatedAt
                          ? new Date(state.updatedAt).toLocaleTimeString('zh-CN')
                          : '尚未收到上报'}
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">实时预览</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <LivePreview orientation={orientation} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
