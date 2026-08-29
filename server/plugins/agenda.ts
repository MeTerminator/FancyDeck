import { defineServerPlugin } from '../core/plugin'
import type { ServerPluginContext } from '../core/plugin'
import { emptyAgenda, type AgendaEvent, type AgendaState } from '../../src/plugins/agenda/state'
import ical, { type ParameterValue, type VEvent } from 'node-ical'

/**
 * 日程插件（服务端）。既能定时拉取 ICS 订阅，也保留采集端整批 POST 的入口。
 *
 *   curl -X POST localhost:8787/api/p/agenda/events -H 'content-type: application/json' \
 *        -d '{"events":[{"id":"1","title":"设计评审","start":1755600000000,"location":"会议室 3B"}]}'
 */

type Settings = { url: string; refreshMs: number; fetchDays: number }

const numberIn = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const readSettings = (raw: Record<string, unknown>): Settings => ({
  url: String(raw.icsUrl ?? '').trim().replace(/^webcal:/i, 'https:'),
  refreshMs: numberIn(raw.refreshMinutes, 5, 1440, 15) * 60_000,
  fetchDays: numberIn(raw.fetchDays, 1, 365, 30),
})

const text = (value: ParameterValue | undefined): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'val' in value) return String(value.val)
  return ''
}

const toAgendaEvent = (
  event: VEvent,
  start: Date,
  end: Date | undefined,
  allDay: boolean,
  suffix = '',
): AgendaEvent => ({
  id: `${event.uid}${suffix}`,
  title: text(event.summary).trim() || '未命名日程',
  start: start.getTime(),
  end: end?.getTime(),
  location: text(event.location).trim() || undefined,
  allDay,
})

function parseEvents(source: string, from: Date, to: Date): AgendaEvent[] {
  const calendar = ical.sync.parseICS(source)
  const events: AgendaEvent[] = []

  for (const component of Object.values(calendar)) {
    if (!component || component.type !== 'VEVENT') continue
    const event = component as VEvent
    if (event.status === 'CANCELLED' || event.recurrenceid) continue

    if (event.rrule) {
      for (const instance of ical.expandRecurringEvent(event, {
        from,
        to,
        includeOverrides: true,
        excludeExdates: true,
        expandOngoing: true,
      })) {
        if (instance.event.status === 'CANCELLED') continue
        events.push(
          toAgendaEvent(
            instance.event,
            instance.start,
            instance.end,
            instance.isFullDay,
            `:${instance.start.toISOString()}`,
          ),
        )
      }
      continue
    }

    const start = event.start
    const end = event.end
    if (start && start <= to && (end ?? start) >= from) {
      events.push(toAgendaEvent(event, start, end, Boolean(start.dateOnly)))
    }
  }

  return events.sort((a, b) => a.start - b.start)
}

let nextAt = 0
let inFlight: Promise<{ ok: boolean; count?: number; error?: string }> | null = null

async function refresh(ctx: ServerPluginContext<AgendaState>, force = false) {
  if (inFlight) return inFlight
  const settings = readSettings(ctx.getSettings())
  if (!settings.url) {
    nextAt = 0
    return { ok: false, error: '尚未设置 ICS 订阅链接' }
  }
  if (!force && Date.now() < nextAt) return { ok: true, count: ctx.getState().events.length }

  inFlight = (async () => {
    try {
      const url = new URL(settings.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('ICS 链接必须使用 http 或 https')
      const response = await fetch(url, {
        headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const source = await response.text()
      if (source.length > 10 * 1024 * 1024) throw new Error('ICS 文件超过 10 MB')
      if (!source.includes('BEGIN:VCALENDAR')) throw new Error('响应不是有效的 ICS 日历')

      const now = new Date()
      const from = new Date(now.getTime() - 24 * 60 * 60_000)
      const to = new Date(now.getTime() + settings.fetchDays * 24 * 60 * 60_000)
      const events = parseEvents(source, from, to)
      ctx.setState({ events, updatedAt: Date.now(), syncError: undefined })
      nextAt = Date.now() + settings.refreshMs
      ctx.log(`ICS 同步完成：${events.length} 个日程`)
      return { ok: true, count: events.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.patchState({ syncError: message })
      nextAt = Date.now() + Math.min(settings.refreshMs, 60_000)
      ctx.log('ICS 同步失败：', message)
      return { ok: false, error: message }
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export default defineServerPlugin<AgendaState>({
  id: 'agenda',
  initialState: emptyAgenda,

  routes(app, ctx) {
    app.post('/events', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { events?: AgendaEvent[] }
      const events = (Array.isArray(body.events) ? body.events : [])
        .filter((e) => e && typeof e.title === 'string' && Number.isFinite(e.start))
        .sort((a, b) => a.start - b.start)
      ctx.setState({ events, updatedAt: Date.now(), syncError: undefined })
      return c.json({ ok: true, count: events.length })
    })

    app.post('/refresh', async (c) => {
      const result = await refresh(ctx, true)
      return c.json(result, result.ok ? 200 : 502)
    })

    app.get('/state', (c) => c.json(ctx.getState()))
  },

  start(ctx) {
    void refresh(ctx)
    const timer = setInterval(() => {
      const { events } = ctx.getState()
      const cutoff = Date.now() - 60 * 60 * 1000
      const alive = events.filter((e) => (e.end ?? e.start) > cutoff)
      if (alive.length !== events.length) ctx.patchState({ events: alive })
      void refresh(ctx)
    }, 30_000)
    return () => clearInterval(timer)
  },

  onSettingsChange(ctx) {
    nextAt = 0
    void refresh(ctx, true)
  },
})
