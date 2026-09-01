import {
  defineServerPlugin,
  type ServerPluginContext,
} from '../core/plugin'
import { emptyMedia, type MediaState } from '../../src/plugins/media/state'

/**
 * 媒体插件（服务端）。
 *
 * 数据从外面推进来，服务端不主动去读系统——这样同一套接口既能接
 * macOS 助手（agent/macos-agent.mjs），也能接 iOS 快捷指令或任何 curl。
 * 两条路：
 *
 *   HTTP  POST /api/p/media/now-playing   一次一报，适合快捷指令、cron
 *   WS    ws://<host>/ws/p/media          长连接，适合播放器实时上报
 *
 * WebSocket 那条把「还在播吗」这件事交给连接本身：连上并上报 play
 * 就算在播，发 stop 或者连接一断就算停了。播放器崩了、网断了，
 * 屏幕上不会继续挂着一首根本没在响的歌。
 */

type PlayPayload = Partial<MediaState> & { positionSec?: number }

const num = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

/** 把上报的字段收成合法的 state 片段；缺的字段一律不动原值 */
function trackPatch(payload: PlayPayload): Partial<MediaState> {
  const patch: Partial<MediaState> = {}
  if (payload.title !== undefined) patch.title = str(payload.title)
  if (payload.artist !== undefined) patch.artist = str(payload.artist)
  if (payload.album !== undefined) patch.album = str(payload.album)
  if (payload.year !== undefined) patch.year = payload.year === null ? null : num(payload.year)
  if (payload.durationSec !== undefined) patch.durationSec = num(payload.durationSec)
  if (payload.positionSec !== undefined) patch.positionSec = num(payload.positionSec)
  if (payload.artwork !== undefined) patch.artwork = payload.artwork === null ? null : str(payload.artwork)
  if (payload.app !== undefined) patch.app = payload.app === null ? null : str(payload.app)
  if (payload.lyricsTtml !== undefined) patch.lyricsTtml = str(payload.lyricsTtml)
  return patch
}

/**
 * 「暂停」和「停止」在屏幕上是两件事：
 *
 *   暂停  还想接着听，画面留一会儿再退（media:playing 的宽限）
 *   停止  这次听完了，立刻退回主布局。断开连接也算停止
 *
 * 两者都是 playing=false，区别只在 pausedAt：打上时间戳的是暂停，
 * 归零的是停止——触发条件的宽限只认有时间戳的那种。
 */
const markPaused = (prev: MediaState, next: Partial<MediaState>): Partial<MediaState> => {
  if (next.playing === undefined || next.playing === prev.playing) return next
  return { ...next, pausedAt: next.playing ? 0 : Date.now() }
}

/** 停止：立刻退出，不走宽限 */
const STOPPED: Partial<MediaState> = { playing: false, pausedAt: 0 }

export default defineServerPlugin<MediaState>({
  id: 'media',
  initialState: emptyMedia,
  // HTTP 上报没有「断开」可言，所以还是要靠超时兜底；
  // WebSocket 那条不依赖它，断开就立刻停。
  staleMs: 60_000,

  routes(app, ctx) {
    /** 全量上报：助手每次把能读到的都发过来 */
    app.post('/now-playing', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as PlayPayload
      const now = Date.now()
      ctx.setState((prev) => ({
        ...prev,
        ...markPaused(prev, body),
        // 换歌了却没带新歌词，就把旧的清掉，免得张冠李戴
        lyricsTtml:
          body.lyricsTtml ?? (body.title && body.title !== prev.title ? '' : prev.lyricsTtml),
        positionAt: now,
        updatedAt: now,
      }))
      return c.json({ ok: true })
    })

    /** 歌词单独一条路，因为它通常来自另一个数据源 */
    app.post('/lyrics', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { ttml?: string }
      ctx.patchState({ lyricsTtml: str(body.ttml), updatedAt: Date.now() })
      return c.json({ ok: true })
    })

    app.post('/stopped', (c) => {
      ctx.setState((prev) => ({ ...prev, ...STOPPED, updatedAt: Date.now() }))
      return c.json({ ok: true })
    })

    app.get('/state', (c) => c.json(ctx.getState()))
  },

  /**
   * ws://<host>/ws/p/media
   *
   *   → { "type": "play",     ...歌曲字段 }   开始播放（也用来换歌）
   *   → { "type": "progress", "positionSec": 12.3 }  对齐进度，可选
   *   → { "type": "lyrics",   "ttml": "<tt>…" }      单独送歌词
   *   → { "type": "stop" }                            停止
   *
   * 断开连接等同于 stop。
   */
  socket(ctx) {
    // 同时接了好几个播放器时，以最后一个发 play 的为准；
    // 其余连接断开不该把正在播的那个也停掉。
    let owning = false
    // owning 表示「这条连接是当前在驱动播放的那个」。停止不交出所有权——
    // 上游随时可能又放起来，那时来的 progress 得认，不然会被当成野消息丢掉。
    // 真正交出去是在连接关闭的时候。
    const stop = () => {
      if (!owning) return
      ctx.setState((prev) => ({ ...prev, ...STOPPED, updatedAt: Date.now() }))
    }

    return {
      message(data) {
        if (typeof data !== 'object' || data === null) return
        const message = data as PlayPayload & { type?: string; ttml?: string; playing?: boolean }
        const now = Date.now()

        switch (message.type) {
          case 'play': {
            owning = true
            const patch = trackPatch(message)
            ctx.setState((prev) => ({
              ...prev,
              ...patch,
              lyricsTtml:
                patch.lyricsTtml ??
                (patch.title && patch.title !== prev.title ? '' : prev.lyricsTtml),
              positionSec: patch.positionSec ?? 0,
              playing: true,
              pausedAt: 0,
              positionAt: now,
              updatedAt: now,
            }))
            break
          }
          case 'progress': {
            if (!owning) break
            // 播放器可以借 progress 报「暂停在第几秒」——执行完 toggle 就是这么回报的。
            // 不带 playing 时按仍在播处理，免得每条心跳都要重复声明。
            ctx.setState((prev) => ({
              ...prev,
              ...markPaused(prev, {
                ...trackPatch(message),
                // progress 一到就算在播——除非它自己明说 playing:false（那是暂停）
                playing: typeof message.playing === 'boolean' ? message.playing : true,
              }),
              positionAt: now,
              updatedAt: now,
            }))
            break
          }
          case 'lyrics': {
            ctx.patchState({ lyricsTtml: str(message.ttml), updatedAt: now })
            break
          }
          case 'stop': {
            stop()
            break
          }
          default:
            return
        }
      },

      // 播放器掉线就当停了——这正是用长连接的理由
      close() {
        // 断开等同于停止：立刻退回主布局，不走暂停宽限
        stop()
        owning = false
      },
    }
  },
})
