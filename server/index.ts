import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  ClientMessage,
  DeckConfig,
  PluginId,
  ServerMessage,
} from '../src/core/types'
import { Hub } from './core/hub'
import type { ServerPlugin, ServerPluginContext } from './core/plugin'
import { ConfigStore } from './core/store'
import { serverPlugins } from './plugins'

const PORT = Number(process.env.PORT ?? 8787)
const DIST = resolve(process.cwd(), 'dist')

const store = new ConfigStore()
const hub = new Hub()

// ────────────────────────────────────────────────────────────────────────────
// 采集端注册表：macOS 助手之类的进程连上来，声明自己能伺候哪些插件
// ────────────────────────────────────────────────────────────────────────────

type Agent = { socket: WebSocket; plugins: Set<PluginId> }
const agents = new Set<Agent>()

function dispatchToAgents(plugin: PluginId, action: string, payload?: unknown): boolean {
  const message: ServerMessage = { type: 'command', plugin, action, payload }
  const text = JSON.stringify(message)
  let delivered = false
  for (const agent of agents) {
    if (!agent.plugins.has(plugin)) continue
    if (agent.socket.readyState !== agent.socket.OPEN) continue
    agent.socket.send(text)
    delivered = true
  }
  return delivered
}

// ────────────────────────────────────────────────────────────────────────────
// 挂载插件
// ────────────────────────────────────────────────────────────────────────────

const registry = new Map<PluginId, { plugin: ServerPlugin<any>; ctx: ServerPluginContext<any> }>()
const api = new Hono()

function makeContext(plugin: ServerPlugin<any>): ServerPluginContext<any> {
  return {
    id: plugin.id,
    getState: () => hub.get(plugin.id),
    setState: (next) =>
      hub.set(plugin.id, typeof next === 'function' ? (next as (p: unknown) => unknown)(hub.get(plugin.id)) : next),
    patchState: (patch) => hub.patch(plugin.id, patch as Record<string, unknown>),
    getSettings: () => store.get().plugins[plugin.id]?.settings ?? {},
    dispatchToAgents: (action, payload) => dispatchToAgents(plugin.id, action, payload),
    log: (...args) => console.log(`[${plugin.id}]`, ...args),
  }
}

const stopFns: (() => void)[] = []

for (const plugin of serverPlugins) {
  hub.init(plugin.id, plugin.initialState)
  const ctx = makeContext(plugin)
  registry.set(plugin.id, { plugin, ctx })

  if (plugin.routes) {
    const sub = new Hono()
    plugin.routes(sub, ctx)
    api.route(`/p/${plugin.id}`, sub)
  }

  const stop = plugin.start?.(ctx)
  if (stop) stopFns.push(stop)
}

/** 数据过期回收：助手挂了之后别让屏幕一直卡在旧状态 */
const staleTimer = setInterval(() => {
  const now = Date.now()
  for (const { plugin } of registry.values()) {
    if (!plugin.staleMs) continue
    const touched = hub.touchedAt(plugin.id)
    if (touched && now - touched > plugin.staleMs) hub.set(plugin.id, plugin.initialState)
  }
}, 5_000)

// ────────────────────────────────────────────────────────────────────────────
// 核心 API
// ────────────────────────────────────────────────────────────────────────────

/** 上一次落盘的插件设置，用来判断这次改动碰了谁 */
let lastSettings = new Map<PluginId, string>(
  [...registry.keys()].map((id) => [id, JSON.stringify(store.get().plugins[id]?.settings ?? {})]),
)

function applyConfig(next: DeckConfig) {
  const saved = store.set(next)
  hub.broadcast({ type: 'config', config: saved })

  // 谁的设置变了就通知谁：天气靠这个在改完城市的当场重新取数
  const current = new Map<PluginId, string>()
  for (const [id, entry] of registry) {
    const serialized = JSON.stringify(saved.plugins[id]?.settings ?? {})
    current.set(id, serialized)
    if (lastSettings.get(id) === serialized) continue
    try {
      entry.plugin.onSettingsChange?.(entry.ctx)
    } catch (error) {
      console.error(`[${id}] 设置变更回调出错：`, error)
    }
  }
  lastSettings = current
  return saved
}

api.get('/config', (c) => c.json(store.get()))

api.put('/config', async (c) => {
  const body = (await c.req.json().catch(() => null)) as DeckConfig | null
  if (!body) return c.json({ error: '请求体不是合法 JSON' }, 400)
  return c.json(applyConfig(body))
})

api.get('/states', (c) => c.json(hub.snapshot()))

/** 通用上报口：没写专属路由的插件也能被推数据 */
api.post('/p/:plugin/state', async (c) => {
  const id = c.req.param('plugin')
  if (!registry.has(id)) return c.json({ error: `未知插件 ${id}` }, 404)
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: '请求体不是合法 JSON' }, 400)
  if (c.req.query('merge') === '0') hub.set(id, body)
  else hub.patch(id, body as Record<string, unknown>)
  return c.json({ ok: true })
})

api.post('/p/:plugin/command/:action', async (c) => {
  const id = c.req.param('plugin')
  const action = c.req.param('action')
  const payload = await c.req.json().catch(() => undefined)
  return c.json({ ok: runCommand(id, action, payload) })
})

api.get('/status', (c) =>
  c.json({
    plugins: [...registry.keys()].map((id) => ({
      id,
      lastPushAt: hub.touchedAt(id) ?? null,
      agents: [...agents].filter((a) => a.plugins.has(id)).length,
    })),
    displays: displayCount,
    agents: agents.size,
    uptimeSec: Math.round(process.uptime()),
  }),
)

function runCommand(plugin: PluginId, action: string, payload: unknown): boolean {
  const entry = registry.get(plugin)
  if (!entry) return false
  const handler = entry.plugin.commands?.[action]
  if (handler) {
    handler(entry.ctx, payload)
    return true
  }
  // 插件没声明这个指令就直接透传给采集端
  return dispatchToAgents(plugin, action, payload)
}

// ────────────────────────────────────────────────────────────────────────────
// 静态资源：生产模式下同一个端口顺带把前端发出去
// ────────────────────────────────────────────────────────────────────────────

const app = new Hono()
app.route('/api', api)

if (existsSync(DIST)) {
  app.use('/assets/*', serveStatic({ root: 'dist' }))
  // public/ 里的东西构建时原样拷到 dist 根下（字体就在这儿）。
  // 不单独放行的话会掉进下面那条 '*' 里，字体请求拿回一份 HTML。
  app.use('/fonts/*', serveStatic({ root: 'dist' }))
  const page = (file: string) => () => {
    const html = readFileSync(resolve(DIST, file), 'utf8')
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  app.get('/console', page('console.html'))
  app.get('/console/*', page('console.html'))
  app.get('/', page('index.html'))
  app.get('*', page('index.html'))
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[fancydeck] 服务端 http://localhost:${info.port}`)
  console.log(`[fancydeck] 展示页 /   管理后台 /console`)
})

// ────────────────────────────────────────────────────────────────────────────
// WebSocket：展示页/后台订阅，采集端上报
// ────────────────────────────────────────────────────────────────────────────

let displayCount = 0
const wss = new WebSocketServer({ noServer: true })

/** 插件自己的 WebSocket 端点：/ws/p/<插件id> */
const pluginSocketId = (url: string): PluginId | null => {
  const match = /^\/ws\/p\/([a-z0-9-]+)/.exec(url)
  return match ? match[1] : null
}

server.on('upgrade', (request, socket, head) => {
  const url = request.url ?? ''
  if (!url.startsWith('/ws')) {
    socket.destroy()
    return
  }

  const pluginId = pluginSocketId(url)
  if (pluginId) {
    const entry = registry.get(pluginId)
    if (!entry?.plugin.socket) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => attachPluginSocket(entry, ws))
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
})

/** 把一条连接交给插件，框架只做 JSON 解析与生命周期转发 */
function attachPluginSocket(
  entry: { plugin: ServerPlugin<any>; ctx: ServerPluginContext<any> },
  ws: WebSocket,
) {
  const conn = {
    send: (data: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data))
    },
    close: () => ws.close(),
  }

  let handlers
  try {
    handlers = entry.plugin.socket?.(entry.ctx, conn) ?? {}
  } catch (error) {
    console.error(`[${entry.plugin.id}] socket 接入出错：`, error)
    ws.close()
    return
  }

  console.log(`[fancydeck] 插件端点接入：${entry.plugin.id}`)

  ws.on('message', (payload) => {
    const raw = String(payload)
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      data = undefined
    }
    try {
      handlers.message?.(data, raw)
    } catch (error) {
      console.error(`[${entry.plugin.id}] socket 消息处理出错：`, error)
    }
  })

  ws.on('close', () => {
    try {
      handlers.close?.()
    } catch (error) {
      console.error(`[${entry.plugin.id}] socket 断开处理出错：`, error)
    }
  })
}

wss.on('connection', (socket) => {
  let unsubscribe: (() => void) | null = null
  let agent: Agent | null = null
  let counted = false

  const send = (message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }

  send({ type: 'hello', config: store.get(), states: hub.snapshot(), serverTime: Date.now() })

  socket.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw)) as ClientMessage
    } catch {
      send({ type: 'error', message: '消息不是合法 JSON' })
      return
    }

    switch (message.type) {
      case 'subscribe': {
        unsubscribe?.()
        unsubscribe = hub.subscribe(send)
        if (message.role === 'display' && !counted) {
          counted = true
          displayCount += 1
        }
        break
      }
      case 'register-agent': {
        agent = { socket, plugins: new Set(message.plugins ?? []) }
        agents.add(agent)
        console.log(`[fancydeck] 采集端接入：${[...agent.plugins].join(', ') || '(未声明)'}`)
        break
      }
      case 'push-state': {
        if (!registry.has(message.plugin)) return
        if (message.merge === false) hub.set(message.plugin, message.state)
        else hub.patch(message.plugin, message.state as Record<string, unknown>)
        break
      }
      case 'set-config': {
        applyConfig(message.config)
        break
      }
      case 'command': {
        runCommand(message.plugin, message.action, message.payload)
        break
      }
      case 'ping':
        break
    }
  })

  socket.on('close', () => {
    unsubscribe?.()
    if (agent) agents.delete(agent)
    if (counted) displayCount -= 1
  })
})

// ────────────────────────────────────────────────────────────────────────────

const shutdown = () => {
  clearInterval(staleTimer)
  for (const stop of stopFns) stop()
  store.flush()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
