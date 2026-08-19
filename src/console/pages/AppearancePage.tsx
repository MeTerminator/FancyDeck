import { useRuntime } from '../../core/runtime'
import { themes } from '../../theme/tokens'
import { LivePreview } from '../components/LivePreview'
import { PageHeader } from '../components/Shell'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { Slider } from '../ui/slider'

/** 外观：摆件的主题与切换动画。改完立刻推给所有屏幕。 */
export function AppearancePage() {
  const { config, setConfig, orientation } = useRuntime()

  return (
    <>
      <PageHeader title="外观" description="展示页的主题与切换动效。这里的设置与后台自身的深浅色无关。" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">主题</CardTitle>
              <CardDescription>一份主题就是一套颜色、间隙与圆角，布局与卡片完全不动。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
              {themes.map((theme) => {
                const active = config.themeId === theme.id
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, themeId: theme.id }))}
                    aria-pressed={active}
                    className={cn(
                      'grid gap-2 rounded-xl border p-3 text-left transition-all',
                      active ? 'border-primary ring-primary/25 ring-2' : 'hover:border-primary/50',
                    )}
                  >
                    {/* 用主题自己的颜色画一个迷你面板 */}
                    <div
                      className="grid aspect-[4/3] gap-px overflow-hidden rounded-md p-px"
                      style={{ background: theme.colors.bg }}
                    >
                      <div className="grid grid-cols-3 gap-px" style={{ background: theme.colors.bg }}>
                        <div style={{ background: theme.colors.cell, borderRadius: theme.radius / 3 }} />
                        <div
                          className="grid place-items-center"
                          style={{ background: theme.colors.cell, borderRadius: theme.radius / 3 }}
                        >
                          <span
                            style={{
                              fontFamily: theme.fonts.display,
                              color: theme.colors.textPrimary,
                              fontSize: 18,
                            }}
                          >
                            09
                          </span>
                        </div>
                        <div style={{ background: theme.colors.cellActive, borderRadius: theme.radius / 3 }} />
                      </div>
                      <div className="grid grid-cols-[2fr_1fr] gap-px">
                        <div
                          className="flex items-end p-1"
                          style={{ background: theme.colors.cell, borderRadius: theme.radius / 3 }}
                        >
                          <span
                            className="block h-0.5 w-2/3 rounded-full"
                            style={{ background: theme.colors.accent }}
                          />
                        </div>
                        <div style={{ background: theme.colors.cell, borderRadius: theme.radius / 3 }} />
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium">{theme.name}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">{theme.code}</div>
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">布局切换动效</CardTitle>
              <CardDescription>
                音乐一响、日程临近，屏幕换布局时的过渡时长。设为 0 就是瞬切。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-0">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground text-xs font-normal">过渡时长</Label>
                <span className="font-mono text-sm">{config.transitionMs} ms</span>
              </div>
              <Slider
                value={[config.transitionMs]}
                min={0}
                max={1500}
                step={20}
                onValueChange={([v]) => setConfig((prev) => ({ ...prev, transitionMs: v }))}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">实时预览</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <LivePreview orientation={orientation} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
