import { readFileSync } from 'node:fs'
import { defineServerPlugin, type ServerPluginContext } from '../core/plugin'
import { defaultWeather, type WeatherState } from '../../src/plugins/weather/state'

/**
 * 天气插件（服务端）。数据取自小米天气的公开接口：
 *   https://github.com/huanghui0906/API/blob/master/XiaomiWeather.md
 *
 * 它不需要注册账号也不要 key（sign 是接口自带的固定值），所以不像和风、
 * OpenWeather 那样得先让用户去申请——填个城市编号就能出数。
 * 采集端仍然可以用 POST /current 覆盖，两条路互不干扰。
 */

const ENDPOINT = 'https://weatherapi.market.xiaomi.com/wtr-v3/weather/all'
/** 接口自带的固定签名，不是密钥 */
const SIGN = 'zUFJoAR2ZVrDy1vF3D07'

/** 天气状况码 → 中文，见接口文档附带的 xiaomi_weather_status.json */
const CONDITIONS: Record<string, string> = {
  '0': '晴', '1': '多云', '2': '阴', '3': '阵雨', '4': '雷阵雨', '5': '雷阵雨伴冰雹',
  '6': '雨夹雪', '7': '小雨', '8': '中雨', '9': '大雨', '10': '暴雨', '11': '大暴雨',
  '12': '特大暴雨', '13': '阵雪', '14': '小雪', '15': '中雪', '16': '大雪', '17': '暴雪',
  '18': '雾', '19': '冻雨', '20': '沙尘暴', '21': '小到中雨', '22': '中到大雨',
  '23': '大到暴雨', '24': '暴雨到大暴雨', '25': '大到特大暴雨', '26': '小到中雪',
  '27': '中到大雪', '28': '大到暴雪', '29': '浮尘', '30': '扬沙', '31': '强沙尘暴',
  '32': '飑', '33': '龙卷风', '34': '轻微高吹雪', '35': '轻雾', '53': '霾',
}

// ────────────────────────────────────────────────────────────────────────────
// 城市表
// ────────────────────────────────────────────────────────────────────────────

/**
 * 两千多个城市，只放在服务端。
 * 打包进浏览器要多背 20 多 KB（gzip），而展示页一个字都用不上；
 * 后台需要时按关键词来问，一次最多给 50 条。
 */
type City = { code: string; name: string; province: string }

const cities: City[] = (() => {
  try {
    const raw = readFileSync(new URL('./weather-cities.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { cities: [string, string, string][] }
    return parsed.cities.map(([code, name, province]) => ({ code, name, province }))
  } catch (error) {
    console.error('[weather] 城市表读不出来，只能靠手填编号：', error)
    return []
  }
})()

const byCode = new Map(cities.map((city) => [city.code, city]))

/** 省份按城市表里的出现顺序排，和小米自己的顺序一致 */
const provinces = [...new Set(cities.map((city) => city.province))]

/** 杭州 萧山；市名本身已带省名时不重复前缀 */
const cityLabel = (city: City) => city.name.replace(/\./g, ' ')

/** 屏幕上显示的名字：取最后一级，「杭州.萧山」显示「萧山」 */
const cityDisplayName = (code: string) => byCode.get(code)?.name.split('.').pop() ?? ''

const inProvince = (province: string, q: string, limit = 400) => {
  const keyword = q.trim()
  const out: City[] = []
  for (const city of cities) {
    if (city.province !== province) continue
    if (keyword && !city.name.includes(keyword) && !city.code.startsWith(keyword)) continue
    out.push(city)
    if (out.length >= limit) break
  }
  return out
}

/** AQI 分级，国标 HJ 633 */
const aqiLevel = (aqi: number) => {
  if (aqi <= 0) return ''
  if (aqi <= 50) return '优'
  if (aqi <= 100) return '良'
  if (aqi <= 150) return '轻度污染'
  if (aqi <= 200) return '中度污染'
  if (aqi <= 300) return '重度污染'
  return '严重污染'
}

/** 接口把数字也用字符串装着，而且偶尔给空串 */
const num = (value: unknown, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

type Settings = { cityCode: string; cityName: string; refreshMs: number }

const readSettings = (raw: Record<string, unknown>): Settings => {
  const cityCode = String(raw.cityCode ?? '').trim() || '101210101'
  return {
    cityCode,
    // 城市名默认查表得来，填了就按填的显示（想让屏幕上写「家」而不是「杭州」）
    cityName: String(raw.cityName ?? '').trim() || cityDisplayName(cityCode) || cityCode,
    refreshMs: Math.max(5, num(raw.refreshMinutes, 15)) * 60_000,
  }
}

/** 拉一次，映射成 WeatherState 里天气自己的那几项（city 由设置决定，不在这里填） */
async function fetchWeather(cityCode: string): Promise<Omit<WeatherState, 'city' | 'updatedAt'>> {
  const url = new URL(ENDPOINT)
  url.search = new URLSearchParams({
    latitude: '0',
    longitude: '0',
    locationKey: `weathercn:${cityCode}`,
    days: '5',
    appKey: 'weather20151024',
    sign: SIGN,
    isGlobal: 'false',
    locale: 'zh_cn',
  }).toString()

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as any

  const current = data?.current
  if (!current) throw new Error('响应里没有 current，城市编号可能不对')

  // forecastDaily.temperature.value[0] 的 from 是最高温、to 是最低温，
  // 但别指望它永远这么排，取个 min/max 稳妥些
  const today = data?.forecastDaily?.temperature?.value?.[0]
  const a = num(today?.from, NaN)
  const b = num(today?.to, NaN)
  const temperature = num(current.temperature?.value)
  const high = Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : temperature
  const low = Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b) : temperature

  const aqi = num(data?.aqi?.aqi)

  return {
    condition: CONDITIONS[String(current.weather)] ?? '未知',
    temperature,
    feelsLike: num(current.feelsLike?.value, temperature),
    humidity: num(current.humidity?.value),
    low,
    high,
    aqi,
    aqiLevel: aqiLevel(aqi),
  }
}

// 插件在一个进程里只有一份，这几个游标就放模块级——
// start() 的定时器和 onSettingsChange() 都要碰它们。
let nextAt = 0
let inFlight = false

async function tick(ctx: ServerPluginContext<WeatherState>) {
  const { cityCode, cityName, refreshMs } = readSettings(ctx.getSettings())

  // 显示名只是一行字，改了立刻生效，不必等拉取
  if (ctx.getState().city !== cityName) ctx.patchState({ city: cityName })
  if (Date.now() < nextAt || inFlight) return

  inFlight = true
  try {
    const observed = await fetchWeather(cityCode)
    ctx.setState((prev) => ({ ...prev, ...observed, city: cityName, updatedAt: Date.now() }))
    nextAt = Date.now() + refreshMs
  } catch (error) {
    // 取不到就留着上一次的数据——屏幕上挂着十分钟前的天气，
    // 也好过回落到出厂那份假数据。一分钟后再试。
    ctx.log('取天气失败：', error instanceof Error ? error.message : error)
    nextAt = Date.now() + 60_000
  } finally {
    inFlight = false
  }
}

export default defineServerPlugin<WeatherState>({
  id: 'weather',
  initialState: defaultWeather,

  routes(app, ctx) {
    // 留着手动上报这条路：调试时不必等轮询，也方便接自己的数据源
    app.post('/current', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Partial<WeatherState>
      ctx.setState((prev) => ({ ...prev, ...body, updatedAt: Date.now() }))
      return c.json({ ok: true })
    })
    app.get('/state', (c) => c.json(ctx.getState()))

    /**
     * 后台那个「先选省、再选市」的选择器的候选来源。三种问法：
     *   ?groups=1        → 34 个省
     *   ?group=浙江&q=杭  → 该省的市县，q 可选
     *   ?value=101210102 → 回显当前选中项，附带它属于哪个省
     */
    app.get('/cities', (c) => {
      const value = c.req.query('value')
      if (value !== undefined) {
        const city = byCode.get(value)
        return c.json(city ? [{ value: city.code, label: cityLabel(city), group: city.province }] : [])
      }
      if (c.req.query('groups') !== undefined) {
        return c.json(provinces.map((name) => ({ value: name, label: name })))
      }
      const group = c.req.query('group') ?? provinces[0] ?? ''
      return c.json(
        inProvince(group, c.req.query('q') ?? '').map((city) => ({
          value: city.code,
          label: cityLabel(city),
          group: city.province,
        })),
      )
    })
  },

  start(ctx) {
    void tick(ctx)
    const timer = setInterval(() => void tick(ctx), 30_000)
    return () => clearInterval(timer)
  },

  onSettingsChange(ctx) {
    // 后台刚选完城市：作废退避，当场重取，不等下一次心跳
    nextAt = 0
    void tick(ctx)
  },
})
