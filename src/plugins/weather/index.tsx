import { definePlugin } from '../../core/plugin'
import { SunIcon } from '../../ui/icons'
import { Tile } from '../../ui/Tile'
import { defaultWeather, type WeatherState } from './state'

/** 天气插件。服务端按设置里的城市定时去小米天气取数，这边只负责怎么画和怎么触发。 */
export default definePlugin<WeatherState>({
  id: 'weather',
  name: '天气',
  description: '当前天气、体感、湿度与空气质量。数据取自小米天气，内置全国市县可直接选。',
  icon: 'CloudSun',
  defaultState: defaultWeather,

  routes: [
    { method: 'POST', path: '/api/p/weather/current', description: '手动上报当前天气（会被下次自动拉取覆盖）' },
    { method: 'GET', path: '/api/p/weather/state', description: '读当前天气' },
  ],

  settings: [
    {
      key: 'cityCode',
      label: '城市',
      type: 'lookup',
      default: '101210101',
      source: '/api/p/weather/cities',
      groupLabel: '省份',
      placeholder: '先选省份，再选市县（可输入关键词过滤）',
      help: '内置全国 2566 个市县，选完当场重新取数',
    },
    {
      key: 'cityName',
      label: '显示名',
      type: 'string',
      default: '',
      placeholder: '留空则用所选城市的名字',
      help: '只影响屏幕上那行字，想写「家」「公司」都行',
    },
    {
      key: 'refreshMinutes',
      label: '刷新间隔',
      type: 'number',
      default: 15,
      min: 5,
      max: 180,
      step: 5,
      unit: '分钟',
    },
  ],

  cards: [
    {
      id: 'current',
      name: '当前天气',
      description: '温度、天气状况与湿度',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ state: w }) => (
        <Tile
          label="天气"
          fit
          foot={[`${w.city} · ${w.low}° / ${w.high}°`, w.aqi > 0 ? `AQI ${w.aqi} ${w.aqiLevel}` : '']
            .filter(Boolean)
            .join(' · ')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vmin' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.4vmin, 18px)' }}>
              <SunIcon size="clamp(20px, 3vmin, 38px)" color="var(--fd-accent)" />
              <span className="fd-heading" style={{ fontSize: 'clamp(15px, 2.3vmin, 28px)' }}>
                {w.condition}
              </span>
            </div>
            <div className="fd-row">
              <span className="fd-display" style={{ fontSize: 'clamp(40px, 8.6vmin, 116px)' }}>
                {Math.round(w.temperature)}
              </span>
              <span className="fd-display fd-secondary" style={{ fontSize: 'clamp(18px, 3.8vmin, 52px)' }}>
                °
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1vmin' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span className="fd-muted" style={{ fontSize: 'clamp(10px, 1.3vmin, 14px)' }}>
                  湿度
                </span>
                <span className="fd-display" style={{ fontSize: 'clamp(15px, 2.2vmin, 28px)' }}>
                  {w.humidity}%
                </span>
              </div>
              <div className="fd-bar">
                <div className="fd-bar__fill" style={{ width: `${w.humidity}%` }} />
              </div>
              <div className="fd-secondary" style={{ fontSize: 'clamp(10px, 1.3vmin, 14px)' }}>
                体感 {Math.round(w.feelsLike)}°
              </div>
            </div>
          </div>
        </Tile>
      ),
    },
    {
      id: 'compact',
      name: '天气（紧凑）',
      description: '只有温度和状况，适合塞进 1×1 的角落',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ state: w }) => (
        <Tile label={w.city} fit>
          <div className="fd-row">
            <span className="fd-display" style={{ fontSize: 'clamp(32px, 7vmin, 92px)' }}>
              {Math.round(w.temperature)}°
            </span>
            <span className="fd-heading fd-secondary" style={{ fontSize: 'clamp(13px, 2vmin, 24px)' }}>
              {w.condition}
            </span>
          </div>
        </Tile>
      ),
    },
  ],

  triggers: [
    {
      id: 'hot',
      name: '气温高于',
      params: [{ key: 'above', label: '阈值', type: 'number', default: 32, min: -20, max: 50, step: 1, unit: '°C' }],
      evaluate: ({ state, params }) => state.temperature > Number(params.above),
    },
    {
      id: 'cold',
      name: '气温低于',
      params: [{ key: 'below', label: '阈值', type: 'number', default: 5, min: -20, max: 50, step: 1, unit: '°C' }],
      evaluate: ({ state, params }) => state.temperature < Number(params.below),
    },
  ],
})
