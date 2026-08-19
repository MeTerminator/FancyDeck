import {
  CalendarClock,
  CloudSun,
  Clock,
  Cable,
  ExternalLink,
  Lamp,
  LayoutGrid,
  Monitor,
  Moon,
  Music,
  Palette,
  Puzzle,
  ScrollText,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useRuntime } from '../../core/runtime'
import { cn } from '../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Tooltip } from '../ui/tooltip'

/** 插件 manifest 里写的是图标名，这里映射成组件；没登记的用拼图块兜底 */
const ICONS: Record<string, LucideIcon> = {
  Clock,
  Music,
  CalendarClock,
  CloudSun,
  ScrollText,
  Lamp,
}

export const pluginIcon = (name?: string): LucideIcon => ICONS[name ?? ''] ?? Puzzle

const NAV = [
  { to: '/', label: '概览', icon: Monitor, end: true },
  { to: '/layouts', label: '布局', icon: LayoutGrid },
  { to: '/plugins', label: '插件', icon: Puzzle },
  { to: '/appearance', label: '外观', icon: Palette },
  { to: '/data', label: '数据接入', icon: Cable },
]

/** 管理后台的骨架：顶部一条导航 + 左侧一列导航 */
export function Shell({ children }: { children: ReactNode }) {
  const { status, resolution, config } = useRuntime()
  const [dark, setDark] = useState(
    () => localStorage.getItem('fancydeck.console.dark') === '1',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fancydeck.console.dark', dark ? '1' : '0')
  }, [dark])

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="bg-background/85 sticky top-0 z-40 flex h-14 shrink-0 items-center gap-4 border-b px-5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-[13px] font-semibold">
            F
          </div>
          <span className="text-[15px] font-medium tracking-tight">FancyDeck</span>
          <Badge variant="muted" className="font-mono text-[10px]">
            控制台
          </Badge>
        </div>

        <div className="ml-2 flex items-center gap-2 text-sm">
          <span
            className={cn(
              'size-1.5 rounded-full',
              status === 'open' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse',
            )}
          />
          <span className="text-muted-foreground">
            {status === 'open' ? '已连接数据服务' : status === 'connecting' ? '连接中' : '已断开，重连中'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {resolution && (
            <Tooltip label={`当前生效的布局：${resolution.reason === 'pinned' ? '后台钉住' : resolution.reason === 'trigger' ? '由触发条件命中' : '兜底'}`}>
              <Badge variant={resolution.reason === 'pinned' ? 'default' : 'secondary'} className="gap-1.5">
                {config.pinnedPresetId && <span className="size-1.5 rounded-full bg-current" />}
                {resolution.preset.name}
              </Badge>
            </Tooltip>
          )}
          <Tooltip label={dark ? '切到浅色' : '切到深色'}>
            <Button variant="ghost" size="icon-sm" onClick={() => setDark((d) => !d)} aria-label="切换后台配色">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </Tooltip>
          <Button variant="outline" size="sm" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              打开展示页 <ExternalLink />
            </a>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 items-stretch">
        <nav className="bg-sidebar sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-52 shrink-0 flex-col gap-0.5 border-r p-3 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}

          <div className="text-muted-foreground mt-auto px-2.5 text-[11px] leading-relaxed">
            改动即时保存并广播，
            <br />
            展示页无需刷新。
          </div>
        </nav>

        <main className="min-w-0 flex-1 p-5 lg:p-7">{children}</main>
      </div>
    </div>
  )
}

/** 每个页面顶部的标题区，统一样式 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
