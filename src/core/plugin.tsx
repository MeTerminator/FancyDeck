import type { ComponentType } from 'react'
import type {
  CardContext,
  CardDefinition,
  ParamSpec,
  ParamValues,
  PluginId,
  TriggerDefinition,
} from './types'

/**
 * 插件的「前端半边」：卡片长什么样、暴露哪些触发条件、本地数据怎么来。
 * 「后端半边」在 server/plugins/<id>.ts，只管路由与数据采集。
 * 两边靠 id 与 state 的形状对齐，互不 import。
 */

export type CardComponent<S> = ComponentType<CardContext<S>>

export type ClientCard<S> = CardDefinition & { render: CardComponent<S> }

/**
 * 纯客户端数据源：不经过服务端的数据（时钟、屏幕方向……）。
 * 返回清理函数。push 会与服务端下发的数据浅合并，客户端优先。
 */
export type ClientSource<S> = (api: {
  push: (patch: Partial<S>) => void
  settings: ParamValues
}) => void | (() => void)

export type PluginDefinition<S = unknown> = {
  id: PluginId
  name: string
  /** 后台插件列表里的一句话说明 */
  description?: string
  /** lucide 图标名，后台用 */
  icon?: string
  version?: string
  /** 首次运行时是否默认开启 */
  defaultEnabled?: boolean
  /** 服务端还没下发数据时卡片拿到的东西 */
  defaultState: S
  /** 插件级设置，后台自动渲染成表单 */
  settings?: ParamSpec[]
  cards: ClientCard<S>[]
  triggers?: TriggerDefinition<S>[]
  /**
   * 声明本插件在服务端注册了哪些接口，纯展示用，让后台能告诉用户往哪发数据。
   * WS 对应 socket()，path 写成 /ws/p/<id>。
   */
  routes?: { method: 'GET' | 'POST' | 'WS'; path: string; description: string }[]
  clientSource?: ClientSource<S>
}

/** 只是把类型钉住，顺便补默认值。 */
export function definePlugin<S>(def: PluginDefinition<S>): PluginDefinition<S> {
  return { defaultEnabled: true, version: '1.0.0', ...def }
}

/** 运行时用的、擦掉泛型的插件视图 */
export type AnyPlugin = PluginDefinition<any>
