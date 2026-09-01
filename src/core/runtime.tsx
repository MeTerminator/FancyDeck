import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { connect, type Connection, type ConnectionStatus } from './connection'
import { defaultConfig } from './defaults'
import { resolveLayout, type EvalEnv, type Resolution } from './engine'
import { allPlugins, getTrigger, isPluginEnabled, resolveSettings } from './registry'
import type { DeckConfig, PluginId, PluginStates, ServerMessage } from './types'

/**
 * 运行时。展示页与管理后台共用同一个 Provider：
 *
 *   服务端 ──ws──▶ states ─┐
 *   本地数据源 ────────────┼─▶ 触发器求值 ─▶ 命中的布局预设 ─▶ 画面
 *   后台改配置 ──ws──▶ config ┘
 *
 * 「实时生效」就落在这条链上：任何一头变了都会重新走一遍，不需要刷新页面。
 */

export type Runtime = {
  status: ConnectionStatus
  config: DeckConfig
  states: PluginStates
  /** 每秒一跳，触发器与卡片共用同一个时间基准 */
  now: Date
  orientation: 'landscape' | 'portrait'
  resolution: Resolution | null
  /** 触发器求值环境，后台的条件编辑器用它实时显示每个条件真不真 */
  env: EvalEnv
  /** 后台改配置：本地立刻生效 + 推给服务端广播给其它端 */
  setConfig: (next: DeckConfig | ((prev: DeckConfig) => DeckConfig)) => void
  /** 卡片本地乐观更新 */
  patchState: (plugin: PluginId, patch: Record<string, unknown>) => void
  /** 后台预览用：忽略实际屏幕方向，按指定方向算布局 */
  previewOrientation: (orientation: 'landscape' | 'portrait' | null) => void
}

const RuntimeContext = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const ctx = useContext(RuntimeContext)
  if (!ctx) throw new Error('useRuntime 必须在 RuntimeProvider 内使用')
  return ctx
}

/** 初始 states：先用各插件自己的 defaultState 占位，等服务端 hello 覆盖 */
function seedStates(): PluginStates {
  const out: PluginStates = {}
  for (const plugin of allPlugins) out[plugin.id] = plugin.defaultState
  return out
}

export function RuntimeProvider({
  role,
  children,
}: {
  role: 'display' | 'console'
  children: ReactNode
}) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [config, setConfigState] = useState<DeckConfig>(() => defaultConfig())
  const [serverStates, setServerStates] = useState<PluginStates>(seedStates)
  const [localStates, setLocalStates] = useState<PluginStates>({})
  const [now, setNow] = useState(() => new Date())
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-aspect-ratio: 1/1)').matches
      ? 'portrait'
      : 'landscape',
  )
  const [preview, setPreview] = useState<'landscape' | 'portrait' | null>(null)
  const connectionRef = useRef<Connection | null>(null)
  /** 后台自己写的配置会被服务端原样广播回来，别拿它盖掉正在编辑的内容 */
  const pendingSelfWrite = useRef(0)

  // ── 连接 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'hello':
          setConfigState(message.config)
          setServerStates((prev) => ({ ...prev, ...message.states }))
          break
        case 'config':
          if (pendingSelfWrite.current > 0) pendingSelfWrite.current -= 1
          else setConfigState(message.config)
          break
        case 'state':
          setServerStates((prev) => ({ ...prev, [message.plugin]: message.state }))
          break
        case 'error':
          console.warn('[fancydeck]', message.message)
          break
      }
    }
    const connection = connect({ role, onMessage, onStatus: setStatus })
    connectionRef.current = connection
    return () => {
      connection.close()
      connectionRef.current = null
    }
  }, [role])

  // ── 时间基准与屏幕方向 ────────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-aspect-ratio: 1/1)')
    const onChange = () => setOrientation(mq.matches ? 'portrait' : 'landscape')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const settings = useMemo(() => resolveSettings(config), [config])

  // ── 纯客户端数据源（时钟这类不必过服务端的东西） ──────────────────────────
  useEffect(() => {
    const cleanups: (() => void)[] = []
    for (const plugin of allPlugins) {
      if (!plugin.clientSource) continue
      if (!isPluginEnabled(config, plugin.id)) continue
      const stop = plugin.clientSource({
        settings: settings[plugin.id] ?? {},
        push: (patch) =>
          setLocalStates((prev) => ({
            ...prev,
            [plugin.id]: { ...(prev[plugin.id] as object), ...patch },
          })),
      })
      if (stop) cleanups.push(stop)
    }
    return () => cleanups.forEach((stop) => stop())
  }, [config, settings])

  /** 服务端数据打底，本地源覆盖在上面 */
  const states = useMemo(() => {
    const merged: PluginStates = { ...serverStates }
    for (const [id, local] of Object.entries(localStates)) {
      merged[id] = { ...(merged[id] as object), ...(local as object) }
    }
    return merged
  }, [serverStates, localStates])

  // ── 布局判定 ──────────────────────────────────────────────────────────────
  const env: EvalEnv = useMemo(
    () => ({
      states,
      settings,
      enabled: (id) => isPluginEnabled(config, id),
      lookup: getTrigger,
      now,
    }),
    [states, settings, config, now],
  )

  const raw = useMemo(
    () => resolveLayout(config, env, preview ?? orientation),
    [config, env, preview, orientation],
  )

  // 条件在边界上抖动时（歌切换的一瞬间 playing 会闪一下 false）不该跟着闪布局，
  // 所以刚切进来的预设有一段最短停留时间。
  const [held, setHeld] = useState<Resolution | null>(raw)
  const switchedAt = useRef(0)

  useEffect(() => {
    if (!raw) return
    setHeld((current) => {
      if (!current) {
        switchedAt.current = Date.now()
        return raw
      }
      if (current.preset.id === raw.preset.id) return raw
      const hold = current.preset.holdMs ?? 0
      if (hold > 0 && Date.now() - switchedAt.current < hold) return current
      switchedAt.current = Date.now()
      return raw
    })
  }, [raw])

  // 处在保护期内时，等保护期一过要立刻复查一次，否则要等下一秒心跳
  useEffect(() => {
    if (!held || !raw || held.preset.id === raw.preset.id) return
    const remaining = (held.preset.holdMs ?? 0) - (Date.now() - switchedAt.current)
    if (remaining <= 0) return
    const id = window.setTimeout(() => setNow(new Date()), remaining + 20)
    return () => window.clearTimeout(id)
  }, [held, raw])

  // ── 对外动作 ──────────────────────────────────────────────────────────────
  const setConfig = useCallback((next: DeckConfig | ((prev: DeckConfig) => DeckConfig)) => {
    setConfigState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      pendingSelfWrite.current += 1
      connectionRef.current?.send({ type: 'set-config', config: value })
      return value
    })
  }, [])

  const patchState = useCallback((plugin: PluginId, patch: Record<string, unknown>) => {
    setServerStates((prev) => ({ ...prev, [plugin]: { ...(prev[plugin] as object), ...patch } }))
  }, [])

  const value: Runtime = useMemo(
    () => ({
      status,
      config,
      states,
      now,
      orientation: preview ?? orientation,
      resolution: held,
      env,
      setConfig,
      patchState,
      previewOrientation: setPreview,
    }),
    [status, config, states, now, orientation, preview, held, env, setConfig, patchState],
  )

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}
