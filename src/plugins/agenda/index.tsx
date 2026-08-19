import { definePlugin } from '../../core/plugin'
import { Tile } from '../../ui/Tile'
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

function dayLabel(start: number, now: number): string {
  const a = new Date(start)
  const b = new Date(now)
  const days = Math.round(
    (new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
      new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) /
      86_400_000,
  )
  if (days === 0) return '今日'
  if (days === 1) return '明日'
  if (days === -1) return '昨日'
  return `${a.getMonth() + 1}月${a.getDate()}日`
}

function countdown(event: AgendaEvent, now: number): string {
  const minutes = minutesUntil(event, now)
  if (minutes < -1) return '进行中'
  if (minutes < 1) return '即将开始'
  if (minutes < 60) return `${Math.round(minutes)} 分钟后`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时后`
  return dayLabel(event.start, now)
}

export default definePlugin<AgendaState>({
  id: 'agenda',
  name: '日程',
  description: '来自系统日历的下一件事，可按临近程度触发布局切换。',
  icon: 'CalendarClock',
  defaultState: emptyAgenda,

  routes: [
    { method: 'POST', path: '/api/p/agenda/events', description: '整批上报日程（覆盖式）' },
    { method: 'GET', path: '/api/p/agenda/state', description: '读当前日程' },
  ],

  settings: [
    { key: 'lookaheadHours', label: '只看未来', type: 'number', default: 24, min: 1, max: 168, step: 1, unit: '小时' },
  ],

  cards: [
    {
      id: 'next',
      name: '下一件事',
      description: '时间 + 标题 + 地点，会随格子变大而变大',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ state, now, span }) => {
        const event = nextEvent(state, now.getTime())
        if (!event) {
          return (
            <Tile label="日程">
              <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.8vmin, 20px)' }}>
                接下来没有安排
              </div>
            </Tile>
          )
        }
        const soon = minutesUntil(event, now.getTime()) <= 30
        const big = span.cols >= 2 && span.rows >= 2
        return (
          <Tile
            label="日程"
            active={soon}
            foot={[dayLabel(event.start, now.getTime()), event.location].filter(Boolean).join(' · ')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4vmin', minWidth: 0 }}>
              <div className="fd-row">
                <div
                  className="fd-display"
                  style={{ fontSize: big ? 'clamp(48px, 11vmin, 150px)' : 'clamp(28px, 6vmin, 80px)' }}
                >
                  {event.allDay ? '全天' : hhmm(event.start)}
                </div>
                {soon && <div className="fd-dot" />}
              </div>
              <div
                className="fd-heading fd-secondary"
                style={{
                  fontSize: big ? 'clamp(18px, 3.4vmin, 44px)' : 'clamp(14px, 2.2vmin, 28px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {event.title}
              </div>
              {big && (
                <div className="fd-accent" style={{ fontSize: 'clamp(12px, 1.8vmin, 22px)', letterSpacing: '0.2em' }}>
                  {countdown(event, now.getTime())}
                </div>
              )}
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
          <Tile label="接下来">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 1.4vmin, 18px)' }}>
              {items.length === 0 && (
                <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.6vmin, 18px)' }}>
                  接下来没有安排
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
