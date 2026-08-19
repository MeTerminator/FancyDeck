import type { AnyPlugin } from '../core/plugin'
import agenda from './agenda'
import datetime from './datetime'
import home from './home'
import media from './media'
import weather from './weather'

/**
 * 前端插件清单。装一个插件 = 在这里多一行 import。
 * 卡片、触发条件、设置项会自动出现在管理后台里，不需要改后台的任何代码。
 */
export const plugins: AnyPlugin[] = [datetime, media, agenda, weather, home]
