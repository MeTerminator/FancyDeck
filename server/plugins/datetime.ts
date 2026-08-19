import { defineServerPlugin } from '../core/plugin'
import { defaultDateTime, type DateTimeState } from '../../src/plugins/datetime/state'

/**
 * 时间与日期（服务端）。农历、干支、节气都在前端本地算，服务端不掺和；
 * 这里只收「宜忌」与节日——那是通书里的东西，算不出来，只能报进来。
 */

export default defineServerPlugin<DateTimeState>({
  id: 'datetime',
  initialState: defaultDateTime,

  routes(app, ctx) {
    app.post('/today', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Partial<DateTimeState>
      ctx.setState((prev) => ({ ...prev, ...body, updatedAt: Date.now() }))
      return c.json({ ok: true })
    })
    app.get('/state', (c) => c.json(ctx.getState()))
  },
})
