import { defineServerPlugin } from '../core/plugin'
import { defaultHome, type HomeState } from '../../src/plugins/home/state'

/** 智能家居插件（服务端）。设备状态从 Home Assistant / 助手推进来，开关指令转出去。 */

export default defineServerPlugin<HomeState>({
  id: 'home',
  initialState: defaultHome,

  routes(app, ctx) {
    app.post('/devices', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Partial<HomeState>
      ctx.setState((prev) => ({ ...prev, ...body, updatedAt: Date.now() }))
      return c.json({ ok: true })
    })
    app.get('/state', (c) => c.json(ctx.getState()))
  },

  commands: {
    /** 先本地翻转让屏幕立刻有反馈，同时把指令转给真正能控制设备的采集端 */
    toggleDevice: (ctx, payload) => {
      const id = (payload as { id?: string })?.id
      if (!id) return
      ctx.setState((prev) => ({
        ...prev,
        devices: prev.devices.map((d) => (d.id === id ? { ...d, on: !d.on } : d)),
      }))
      ctx.dispatchToAgents('toggleDevice', payload)
    },
  },
})
