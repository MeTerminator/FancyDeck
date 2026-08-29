import { Radio } from 'lucide-react'
import { allPlugins, isPluginEnabled } from '../../core/registry'
import { useRuntime } from '../../core/runtime'
import { withParamDefaults } from '../../core/types'
import { ParamForm } from '../components/ParamForm'
import { PageHeader, pluginIcon } from '../components/Shell'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'

/**
 * 插件管理。这一整页没有任何插件专属代码——
 * 卡片、触发条件、设置项、路由全部读自插件自己的 manifest。
 */
export function PluginsPage() {
  const { config, setConfig, states, resolution } = useRuntime()

  const toggle = (id: string, enabled: boolean) =>
    setConfig((prev) => ({
      ...prev,
      plugins: { ...prev.plugins, [id]: { settings: prev.plugins[id]?.settings ?? {}, enabled } },
    }))

  const setSettings = (id: string, settings: Record<string, unknown>) =>
    setConfig((prev) => ({
      ...prev,
      plugins: { ...prev.plugins, [id]: { enabled: prev.plugins[id]?.enabled ?? true, settings } },
    }))

  /** 这个插件的卡片被多少个布局用到了 */
  const usage = (pluginId: string) =>
    config.presets.reduce(
      (total, preset) => total + preset.slots.filter((s) => s.card.startsWith(`${pluginId}:`)).length,
      0,
    )

  return (
    <>
      <PageHeader
        title="插件"
        description="每个插件打包了自己的卡片、数据来源与触发条件。关掉插件，它的卡片会从所有布局里隐藏。"
      />

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {allPlugins.map((plugin) => {
          const Icon = pluginIcon(plugin.icon)
          const enabled = isPluginEnabled(config, plugin.id)
          const state = states[plugin.id] as { updatedAt?: number; syncError?: string } | undefined
          const live = typeof state?.updatedAt === 'number' && state.updatedAt > 0
          const used = usage(plugin.id)
          const activeHere = resolution?.preset.slots.some((s) => s.card.startsWith(`${plugin.id}:`))

          return (
            <Card key={plugin.id} className={cn(!enabled && 'opacity-70')}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {plugin.name}
                      <span className="text-muted-foreground font-mono text-[10px] font-normal">
                        {plugin.id}
                      </span>
                    </CardTitle>
                    <CardDescription className="mt-1">{plugin.description}</CardDescription>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggle(plugin.id, v)}
                    aria-label={`${enabled ? '关闭' : '启用'}${plugin.name}`}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant={live ? 'success' : 'muted'} className="gap-1">
                    <Radio className="size-2.5" />
                    {live ? '数据已更新' : plugin.routes ? '等待数据' : '本地数据'}
                  </Badge>
                  {state?.syncError && (
                    <Badge variant="destructive" title={state.syncError}>
                      同步失败
                    </Badge>
                  )}
                  <Badge variant="outline">{plugin.cards.length} 张卡片</Badge>
                  {plugin.triggers && plugin.triggers.length > 0 && (
                    <Badge variant="outline">{plugin.triggers.length} 个触发条件</Badge>
                  )}
                  <Badge variant={used > 0 ? 'secondary' : 'outline'}>已用于 {used} 处</Badge>
                  {activeHere && enabled && <Badge>正在屏幕上</Badge>}
                </div>
              </CardHeader>

              <CardContent className="grid gap-4 pt-0 text-sm">
                <Section title="提供的卡片">
                  <div className="grid gap-1">
                    {plugin.cards.map((card) => (
                      <div key={card.id} className="flex items-baseline gap-2">
                        <span className="font-medium">{card.name}</span>
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                          {card.description}
                        </span>
                        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                          ≥{card.size.minCols}×{card.size.minRows}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>

                {plugin.triggers && plugin.triggers.length > 0 && (
                  <>
                    <Separator />
                    <Section title="提供的触发条件">
                      <div className="grid gap-1">
                        {plugin.triggers.map((trigger) => (
                          <div key={trigger.id} className="flex items-baseline gap-2">
                            <span>{trigger.name}</span>
                            <span className="text-muted-foreground truncate font-mono text-[10px]">
                              {plugin.id}:{trigger.id}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  </>
                )}

                {plugin.routes && plugin.routes.length > 0 && (
                  <>
                    <Separator />
                    <Section title="注册的接口">
                      <div className="grid gap-1 font-mono text-[11px]">
                        {plugin.routes.map((route) => (
                          <div key={route.path} className="flex items-baseline gap-2">
                            <span className="text-muted-foreground w-10 shrink-0">{route.method}</span>
                            <span className="truncate">{route.path}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  </>
                )}

                {plugin.settings && plugin.settings.length > 0 && (
                  <>
                    <Separator />
                    <Section title="设置">
                      <ParamForm
                        specs={plugin.settings}
                        values={withParamDefaults(plugin.settings, config.plugins[plugin.id]?.settings)}
                        onChange={(next) => setSettings(plugin.id, next)}
                      />
                    </Section>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-muted-foreground text-[11px] tracking-wider uppercase">{title}</div>
      {children}
    </div>
  )
}
