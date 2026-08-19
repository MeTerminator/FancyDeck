import type { ServerPlugin } from '../core/plugin'
import agenda from './agenda'
import datetime from './datetime'
import home from './home'
import media from './media'
import weather from './weather'

/** 服务端插件清单。加一个插件 = 在这里多一行。 */
export const serverPlugins: ServerPlugin<any>[] = [media, agenda, weather, home, datetime]
