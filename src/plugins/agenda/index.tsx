import { useLayoutEffect, useRef, useState } from 'react'
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

const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000

const durationLabel = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

function eventDateTimeLabel(event: AgendaEvent, now: number): string {
  const start = new Date(event.start)
  const current = new Date(now)
  const days = dayNumber(start) - dayNumber(current)
  const time = event.allDay ? '全天' : hhmm(event.start)
  if (days === 0) return `今天 ${time}`
  if (days === 1) return `明天 ${time}`
  if (days === 2) return `后天 ${time}`
  return `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())} ${time}`
}

export function eventTimeStatus(event: AgendaEvent, now: number) {
  const end = event.end ?? event.start + 30 * 60_000
  const inProgress = event.start <= now && end > now
  const dateTime = eventDateTimeLabel(event, now)

  if (inProgress) {
    const duration = Math.max(1, end - event.start)
    return {
      label: `离结束 ${durationLabel(end - now)} · ${dateTime}`,
      progress: Math.min(1, Math.max(0, (now - event.start) / duration)),
    }
  }

  if (dayNumber(new Date(event.start)) === dayNumber(new Date(now)) && event.start > now) {
    return { label: `离开始 ${durationLabel(event.start - now)} · ${dateTime}`, progress: null }
  }

  return { label: dateTime, progress: null }
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 8
  return (
    <svg className="fd-agenda-progress" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="fd-agenda-progress__track" cx="10" cy="10" r={radius} />
      <circle
        className="fd-agenda-progress__value"
        cx="10"
        cy="10"
        r={radius}
        pathLength="1"
        strokeDasharray="1"
        strokeDashoffset={1 - progress}
      />
    </svg>
  )
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function agendaDayLabel(ms: number, now: number) {
  const date = new Date(ms)
  const days = dayNumber(date) - dayNumber(new Date(now))
  const relative = days === 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天' : ''
  const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`
  return [relative, dateLabel, weekdays[date.getDay()]].filter(Boolean).join(' · ')
}

function AgendaListEvent({ event, now }: { event: AgendaEvent; now: number }) {
  const end = event.end ?? event.start + 30 * 60_000
  const inProgress = event.start <= now && end > now
  return (
    <div className={`fd-agenda-list__event${inProgress ? ' fd-agenda-list__event--active' : ''}`}>
      <div className="fd-agenda-list__detail">
        <div className="fd-agenda-list__title">{event.title}</div>
        {event.location && <div className="fd-agenda-list__location">{event.location}</div>}
        <div className="fd-agenda-list__times">
          {event.allDay ? '全天' : `${hhmm(event.start)} - ${hhmm(end)}`}
        </div>
      </div>
    </div>
  )
}

type AgendaGroup = { day: number; label: string; events: AgendaEvent[] }

function groupAgendaEvents(items: AgendaEvent[], now: number): AgendaGroup[] {
  return items.reduce<AgendaGroup[]>((result, event) => {
    const day = dayNumber(new Date(event.start))
    const current = result.at(-1)
    if (current?.day === day) current.events.push(event)
    else result.push({ day, label: agendaDayLabel(event.start, now), events: [event] })
    return result
  }, [])
}

function AgendaListGroups({ groups, now, measuring = false }: { groups: AgendaGroup[]; now: number; measuring?: boolean }) {
  return groups.map((group) => (
    <div className="fd-agenda-list__group" key={group.day}>
      <div className="fd-agenda-list__day">{group.label}</div>
      <div className="fd-agenda-list__events">
        {group.events.map((event) => (
          <div data-agenda-measure={measuring ? '' : undefined} key={event.id}>
            <AgendaListEvent event={event} now={now} />
          </div>
        ))}
      </div>
    </div>
  ))
}

function AgendaList({ items, now }: { items: AgendaEvent[]; now: number }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(items.length)
  const itemKey = items.map((event) => `${event.id}:${event.start}:${event.end ?? ''}:${event.title}:${event.location ?? ''}`).join('|')

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const fit = () => {
      const frameBottom = frame.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(frame).paddingBottom)
      const measured = [...frame.querySelectorAll<HTMLElement>('[data-agenda-measure]')]
      const nextCount = measured.filter((element) => element.getBoundingClientRect().bottom <= frameBottom + 0.5).length
      setVisibleCount(nextCount)
    }

    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    fit()
    return () => observer.disconnect()
  }, [itemKey])

  const visibleGroups = groupAgendaEvents(items.slice(0, visibleCount), now)
  const allGroups = groupAgendaEvents(items, now)
  return (
    <div className="fd-agenda-list" ref={frameRef}>
      <div className="fd-agenda-list__visible">
        <AgendaListGroups groups={visibleGroups} now={now} />
      </div>
      <div className="fd-agenda-list__measure" aria-hidden="true">
        <AgendaListGroups groups={allGroups} now={now} measuring />
      </div>
    </div>
  )
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
        const timeStatus = eventTimeStatus(event, now.getTime())
        const detailStyle = {
          fontSize: big ? 'clamp(20px, 3.6vmin, 48px)' : 'clamp(16px, 2.6vmin, 32px)',
        }
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
                className="fd-display"
                style={{
                  ...detailStyle,
                  whiteSpace: 'nowrap',
                }}
              >
                {event.location || '未设置地点'}
              </Marquee>
              <div className="fd-agenda-time fd-display" style={detailStyle}>
                {timeStatus.progress !== null && <ProgressRing progress={timeStatus.progress} />}
                <span>{timeStatus.label}</span>
              </div>
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'list',
      name: '日程清单',
      description: '按日期分组展示未来日程、地点和起止时间',
      size: { minCols: 1, minRows: 2, defaultCols: 1, defaultRows: 2 },
      render: ({ state, now }) => {
        const items = state.events
          .filter((e) => (e.end ?? e.start) > now.getTime())
          .sort((a, b) => a.start - b.start)
        return (
          <Tile label="接下来">
            {items.length > 0 ? (
              <AgendaList items={items} now={now.getTime()} />
            ) : (
              <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.6vmin, 18px)' }}>暂无日程</div>
            )}
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
