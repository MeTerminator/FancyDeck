import type { Hono } from 'hono'
import type { ParamValues, PluginId } from '../../src/core/types'

/**
 * 插件的「服务端半边」。只做三件事：
 *   1. 注册路由 —— 让 macOS 助手、快捷指令、curl 能把数据 POST 进来
 *   2. 持有数据 —— 每个插件一份 state，改了就自动广播给所有展示页
 *   3. 接收指令 —— 展示页点了「暂停」，这里决定怎么传出去
 *
 * 服务端不认识 React，也不认识卡片；它只认 id 和 state 的形状。
 */

export type ServerPluginContext<S> = {
  id: PluginId
  getState: () => S
  /** 整份替换 */
  setState: (next: S | ((prev: S) => S)) => void
  /** 浅合并 */
  patchState: (patch: Partial<S>) => void
  /** 该插件在管理后台里配的设置（未补默认值，插件自己兜底） */
  getSettings: () => ParamValues
  /** 把指令送给已注册的采集端；没有采集端时返回 false */
  dispatchToAgents: (action: string, payload?: unknown) => boolean
  log: (...args: unknown[]) => void
}

/**
 * 插件 WebSocket 端点的两个回调。返回给框架，由它在收到消息与断开时调用。
 * 「断开即停止」这类语义就落在 close 上——媒体插件用它把播放状态收掉。
 */
export type PluginSocketHandlers = {
  message?: (data: unknown, raw: string) => void
  close?: () => void
}

/** 插件拿到的那一端连接 */
export type PluginSocketConn = {
  send: (data: unknown) => void
  close: () => void
}

export type ServerPlugin<S = unknown> = {
  id: PluginId
  initialState: S
  /**
   * 注册在 /api/p/<id> 下的路由。
   * 传进来的 app 已经挂好前缀，插件里写 '/now-playing' 即为 /api/p/media/now-playing。
   */
  routes?: (app: Hono, ctx: ServerPluginContext<S>) => void
  /** 展示页发过来的指令。返回 true 表示已处理，否则回落到转发给采集端。 */
  commands?: Record<string, (ctx: ServerPluginContext<S>, payload: unknown) => void | boolean>
  /**
   * 注册在 /ws/p/<id> 上的 WebSocket 端点。每来一条连接调一次。
   * 与 routes 一样，框架只负责接线，协议内容全由插件自己定。
   */
  socket?: (ctx: ServerPluginContext<S>, conn: PluginSocketConn) => PluginSocketHandlers | void
  /** 服务起来时跑一次，可返回清理函数。用于定时拉取（天气）或本地轮询。 */
  start?: (ctx: ServerPluginContext<S>) => void | (() => void)
  /**
   * 本插件的设置在后台被改动时调用。
   * 定时拉取类的插件用它做到「改完当场生效」，不必等下一次心跳。
   */
  onSettingsChange?: (ctx: ServerPluginContext<S>) => void
  /** 超过这么久没收到上报就把数据判定为过期，自动清成 initialState。0 为不过期。 */
  staleMs?: number
}

export function defineServerPlugin<S>(plugin: ServerPlugin<S>): ServerPlugin<S> {
  return plugin
}
