import { definePlugin } from '../../core/plugin'
import { Tile } from '../../ui/Tile'
import { Marquee } from '../../ui/Marquee'
import { emptyAgenda, minutesUntil, nextEvent, type AgendaEvent, type AgendaState } from './state'

/**
 * 日程插件。它的看点是触发条件：「日程临近」带一个「提前多少分钟」的参数，
 * 后台把这个参数配在布局预设上，同一个触发器就能同时服务
 * 「提前 30 分钟放大日程」和「提前 5 分钟整屏提醒」两套布局。
 */

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function eventTimeLabel(event: AgendaEvent, now: number): string {
  const start = new Date(event.start)
  const current = new Date(now)
  const days = Math.round(
    (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
      new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()) /
      86_400_000,
  )
  const time = event.allDay ? '全天' : hhmm(event.start)
  if (days === 0) return time
  if (days === 1) return `${time} 明日`
  if (days === 2) return `${time} 后天`
  return `${time} ${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}`
}

export default definePlugin<AgendaState>({
  id: 'agenda',
  name: '日程',
  description: '通过 ICS 订阅或手动上报获取日程，可按临近程度触发布局切换。',
  icon: 'CalendarClock',
  defaultState: emptyAgenda,

  routes: [
    { method: 'POST', path: '/api/p/agenda/events', description: '整批上报日程（覆盖式）' },
    { method: 'POST', path: '/api/p/agenda/refresh', description: '立即刷新 ICS 订阅' },
    { method: 'GET', path: '/api/p/agenda/state', description: '读当前日程' },
  ],

  settings: [
    {
      key: 'icsUrl',
      label: 'ICS 订阅链接',
      type: 'string',
      default: '',
      placeholder: 'https://example.com/calendar.ics',
      help: '支持 webcal://、http:// 和 https://。保存后会立即同步一次。',
    },
    {
      key: 'refreshMinutes',
      label: '自动更新间隔',
      type: 'number',
      default: 15,
      min: 5,
      max: 1440,
      step: 5,
      unit: '分钟',
    },
    {
      key: 'fetchDays',
      label: '拉取未来日程',
      type: 'number',
      default: 30,
      min: 1,
      max: 365,
      step: 1,
      unit: '天',
    },
    { key: 'lookaheadHours', label: '只看未来', type: 'number', default: 24, min: 1, max: 168, step: 1, unit: '小时' },
  ],

  cards: [
    {
      id: 'next',
      name: '下一件事',
      description: '标题、地点、时间依次展示，会随格子变大而变大',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ state, now, span }) => {
        const event = nextEvent(state, now.getTime())
        if (!event) {
          return (
            <Tile label="日程" fit>
              <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.8vmin, 20px)' }}>
                接下来没有安排
              </div>
            </Tile>
          )
        }
        const soon = (event.start - now.getTime()) / 60_000 <= 30
        const big = span.cols >= 2 && span.rows >= 2
        return (
          <Tile
            active={soon}
            fit
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4vmin', minWidth: 0 }}>
              <div className="fd-row">
                <div
                  className="fd-heading"
                  style={{
                    fontSize: big ? 'clamp(28px, 5vmin, 68px)' : 'clamp(18px, 3.4vmin, 42px)',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                  }}
                >
                  {event.title}
                </div>
                {soon && <div className="fd-dot" />}
              </div>
              <Marquee
                className="fd-secondary"
                style={{
                  fontSize: big ? 'clamp(18px, 3vmin, 40px)' : 'clamp(14px, 2.2vmin, 28px)',
                  whiteSpace: 'nowrap',
                }}
              >
                {event.location || '未设置地点'}
              </Marquee>
              <div className="fd-display" style={{ fontSize: big ? 'clamp(20px, 3.6vmin, 48px)' : 'clamp(16px, 2.6vmin, 32px)' }}>
                {eventTimeLabel(event, now.getTime())}
              </div>
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'list',
      name: '日程清单',
      description: '未来几件事排成一列',
      size: { minCols: 1, minRows: 2, defaultCols: 1, defaultRows: 2 },
      render: ({ state, now, settings, span }) => {
        const cutoff = now.getTime() + Number(settings.lookaheadHours ?? 24) * 3_600_000
        const items = state.events
          .filter((e) => (e.end ?? e.start) > now.getTime() && e.start < cutoff)
          .slice(0, Math.max(2, span.rows * 2))
        return (
          <Tile label="接下来" fit={items.length > 0}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.4vmin, 18px)' }}>
              {items.length === 0 && (
                <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.6vmin, 18px)' }}>
                  暂无日程
                </div>
              )}
              {items.map((event) => (
                <div key={event.id} style={{ display: 'flex', gap: '1.4vmin', alignItems: 'baseline', minWidth: 0 }}>
                  <span className="fd-display" style={{ fontSize: 'clamp(14px, 2vmin, 24px)', flexShrink: 0 }}>
                    {event.allDay ? '全天' : hhmm(event.start)}
                  </span>
                  <span
                    className="fd-heading fd-secondary"
                    style={{
                      fontSize: 'clamp(12px, 1.8vmin, 22px)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {event.title}
                  </span>
                </div>
              ))}
            </div>
          </Tile>
        )
      },
    },
  ],

  triggers: [
    {
      id: 'soon',
      name: '日程临近时',
      description: '下一件事在指定分钟内开始',
      params: [
        { key: 'withinMinutes', label: '提前', type: 'number', default: 30, min: 1, max: 240, step: 5, unit: '分钟' },
      ],
      evaluate: ({ state, params, now }) => {
        const event = nextEvent(state, now.getTime())
        if (!event) return false
        const minutes = minutesUntil(event, now.getTime())
        return minutes <= Number(params.withinMinutes) && minutes > -5
      },
    },
    {
      id: 'in-progress',
      name: '日程进行中',
      evaluate: ({ state, now }) =>
        state.events.some((e) => e.start <= now.getTime() && (e.end ?? e.start) > now.getTime()),
    },
  ],
})
