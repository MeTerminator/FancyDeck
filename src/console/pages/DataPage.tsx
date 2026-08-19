import { Check, Copy, Play, Square, CalendarPlus, Eraser } from 'lucide-react'
import { useState } from 'react'
import { allPlugins } from '../../core/registry'
import { useRuntime } from '../../core/runtime'
import { PageHeader, pluginIcon } from '../components/Shell'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Separator } from '../ui/separator'

/**
 * 数据接入。插件在服务端注册的路由都列在这里，
 * 配上一组「注入示例数据」的按钮——没有 macOS 助手也能把整条链路跑通看效果。
 */

const post = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const DEMO_TRACK = {
  playing: true,
  title: '晚风与信号灯',
  artist: '棱镜合唱团',
  album: '夜行公路',
  year: 2024,
  durationSec: 304,
  positionSec: 34,
  app: 'Music',
  lyrics: [
    { at: 0, text: '收音机在讲明天的雨' },
    { at: 16, text: '把城市的边缘开成一条河' },
    { at: 34, text: '晚风把信号灯吹成橘色的雨' },
    { at: 52, text: '我们在末班车里数完了海' },
    { at: 70, text: '你说别急，天亮还有很久' },
    { at: 92, text: '路灯一盏一盏地退回去' },
    { at: 114, text: '剩下的路我记得怎么走' },
  ],
}

export function DataPage() {
  const { states } = useRuntime()
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  const origin = location.origin

  return (
    <>
      <PageHeader
        title="数据接入"
        description="插件在服务端注册的路由。任何能发 HTTP 的东西都可以给屏幕喂数据：macOS 助手、快捷指令、curl。"
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">注入示例数据</CardTitle>
            <CardDescription>
              没接助手也能验证整条链路：点「开始播放」，展示页会在几百毫秒内切到「正在播放」布局。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            <Button size="sm" onClick={() => post('/api/p/media/now-playing', DEMO_TRACK)}>
              <Play /> 开始播放示例曲目
            </Button>
            <Button size="sm" variant="outline" onClick={() => post('/api/p/media/stopped', {})}>
              <Square /> 停止播放
            </Button>
            <Separator orientation="vertical" className="h-8" />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                post('/api/p/agenda/events', {
                  events: [
                    {
                      id: 'demo-1',
                      title: '设计评审',
                      start: Date.now() + 18 * 60_000,
                      end: Date.now() + 78 * 60_000,
                      location: '会议室 3B',
                      calendar: '工作',
                    },
                    {
                      id: 'demo-2',
                      title: '和 Ada 过一遍插件方案',
                      start: Date.now() + 4 * 3_600_000,
                      location: '线上',
                    },
                  ],
                })
              }
            >
              <CalendarPlus /> 塞两条日程（18 分钟后）
            </Button>
            <Button size="sm" variant="outline" onClick={() => post('/api/p/agenda/events', { events: [] })}>
              <Eraser /> 清空日程
            </Button>
          </CardContent>
        </Card>

        {allPlugins.map((plugin) => {
          const Icon = pluginIcon(plugin.icon)
          const state = states[plugin.id]
          return (
            <Card key={plugin.id}>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <Icon className="text-muted-foreground size-4" />
                  <CardTitle className="text-sm">{plugin.name}</CardTitle>
                  <Badge variant="muted" className="font-mono text-[10px]">
                    {plugin.id}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                {plugin.routes?.length ? (
                  <div className="grid gap-1">
                    {plugin.routes.map((route) => {
                      // WebSocket 没法用 curl 演示，复制地址本身更有用
                      const curl =
                        route.method === 'WS'
                          ? `${origin.replace(/^http/, 'ws')}${route.path}`
                          : route.method === 'GET'
                            ? `curl ${origin}${route.path}`
                            : `curl -X POST ${origin}${route.path} -H 'content-type: application/json' -d '{}'`
                      return (
                        <div key={route.path} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="w-12 shrink-0 justify-center font-mono text-[10px]">
                            {route.method}
                          </Badge>
                          <span className="truncate font-mono">{route.path}</span>
                          <span className="text-muted-foreground min-w-0 flex-1 truncate">
                            {route.description}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={route.method === 'WS' ? '复制 WebSocket 地址' : '复制 curl 命令'}
                            onClick={() => copy(curl)}
                          >
                            {copied === curl ? <Check className="text-emerald-500" /> : <Copy />}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">这个插件的数据在浏览器本地产生，不走服务端。</p>
                )}

                <details className="group">
                  <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                    当前数据快照
                  </summary>
                  <pre className="bg-muted mt-2 max-h-56 overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(state, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
