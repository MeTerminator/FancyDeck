import { defineServerPlugin } from '../core/plugin'
import { emptyAgenda, type AgendaEvent, type AgendaState } from '../../src/plugins/agenda/state'

/**
 * 日程插件（服务端）。macOS 助手用 osascript 读 Calendar.app，整批 POST 过来。
 *
 *   curl -X POST localhost:8787/api/p/agenda/events -H 'content-type: application/json' \
 *        -d '{"events":[{"id":"1","title":"设计评审","start":1755600000000,"location":"会议室 3B"}]}'
 */

export default defineServerPlugin<AgendaState>({
  id: 'agenda',
  initialState: emptyAgenda,

  routes(app, ctx) {
    app.post('/events', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { events?: AgendaEvent[] }
      const events = (Array.isArray(body.events) ? body.events : [])
        .filter((e) => e && typeof e.title === 'string' && Number.isFinite(e.start))
        .sort((a, b) => a.start - b.start)
      ctx.setState({ events, updatedAt: Date.now() })
      return c.json({ ok: true, count: events.length })
    })

    app.get('/state', (c) => c.json(ctx.getState()))
  },

  start(ctx) {
    // 过期事件本地就能清掉，不必等助手下一次上报
    const timer = setInterval(() => {
      const { events } = ctx.getState()
      const cutoff = Date.now() - 60 * 60 * 1000
      const alive = events.filter((e) => (e.end ?? e.start) > cutoff)
      if (alive.length !== events.length) ctx.patchState({ events: alive })
    }, 60_000)
    return () => clearInterval(timer)
  },
})
