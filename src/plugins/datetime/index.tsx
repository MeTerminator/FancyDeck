import { definePlugin } from '../../core/plugin'
import { Tile } from '../../ui/Tile'
import { greeting, pad2, seconds, weekdayCN } from '../../data/format'
import { lunarOf, termLine, type LunarDate } from './lunar'
import { defaultDateTime, type DateTimeState } from './state'

/**
 * 时间与日期。由原来的「时钟」与「黄历」合并而来——它们本来就都在回答
 * 同一个问题：现在是什么时候。合成一个插件之后，公历与农历共用一份 now，
 * 不会出现两张卡片跨零点各说各话。
 *
 * 除了节日，这个插件不需要服务端：农历、干支、节气都由 lunar.ts 现算。
 */

const hourIn = (hour: number, from: number, to: number) =>
  from <= to ? hour >= from && hour < to : hour >= from || hour < to

/**
 * 农历一天才变一次，但 now 每秒一跳。缓存到「哪一天」这个粒度上，
 * 免得每秒把整套天文算法重跑一遍。
 */
let cache: { key: string; value: LunarDate } | null = null
function lunarFor(now: Date): LunarDate {
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  if (cache?.key !== key) cache = { key, value: lunarOf(now) }
  return cache.value
}

export default definePlugin<DateTimeState>({
  id: 'datetime',
  name: '时间与日期',
  description: '时间、日期、星期、农历与节气。农历本地换算，不依赖外部数据。',
  icon: 'CalendarClock',
  defaultState: defaultDateTime,

  routes: [{ method: 'POST', path: '/api/p/datetime/today', description: '上报今日节日' }],

  settings: [
    { key: 'showSeconds', label: '显示秒', type: 'boolean', default: true },
    {
      key: 'hourFormat',
      label: '时制',
      type: 'select',
      default: '24',
      options: [
        { value: '24', label: '24 小时' },
        { value: '12', label: '12 小时' },
      ],
    },
    {
      key: 'showLunar',
      label: '日期卡片带农历',
      type: 'boolean',
      default: true,
      help: '关掉之后「日期」只显示公历',
    },
  ],

  cards: [
    {
      id: 'time',
      name: '时间',
      description: '大号时间，带秒与问候语',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 2 },
      render: ({ now, settings, span }) => {
        const hours = Number(settings.hourFormat) === 12 ? ((now.getHours() + 11) % 12) + 1 : now.getHours()
        const text = `${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        // 占的格子越大字越大：跨 2 格以上时才放到最大号
        const scale = Math.min(span.cols, span.rows * 1.4)
        return (
          <Tile fit>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2vmin' }}>
              <div className="fd-row">
                <div
                  className="fd-display"
                  style={{
                    fontSize: `clamp(48px, ${8 + scale * 5.5}vmin, 300px)`,
                    letterSpacing: '-0.02em',
                    lineHeight: 0.95,
                  }}
                >
                  {text}
                </div>
                {settings.showSeconds !== false && (
                  <div className="fd-display fd-muted" style={{ fontSize: 'clamp(18px, 4.2vmin, 62px)' }}>
                    {seconds(now)}
                  </div>
                )}
              </div>
              {span.rows > 1 && (
                <>
                  <div className="fd-rule" style={{ width: 'clamp(80px, 13vmin, 180px)' }} />
                  <div
                    className="fd-muted"
                    style={{ fontSize: 'clamp(11px, 1.4vmin, 15px)', letterSpacing: '0.34em' }}
                  >
                    {greeting(now)}
                  </div>
                </>
              )}
            </div>
          </Tile>
        )
      },
    },
    {
      id: 'date-weekday',
      name: '日期与星期',
      description: '第一行 08/19，第二行星期几',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ now, span }) => (
        <Tile fit>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1vmin' }}>
            <div
              className="fd-display"
              style={{
                fontSize: `clamp(34px, ${4 + Math.min(span.cols, span.rows * 1.4) * 3.4}vmin, 160px)`,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {pad2(now.getMonth() + 1)}/{pad2(now.getDate())}
            </div>
            <div className="fd-heading fd-secondary" style={{ fontSize: 'clamp(14px, 2.4vmin, 32px)' }}>
              {weekdayCN(now)}
            </div>
          </div>
        </Tile>
      ),
    },
    {
      id: 'lunar',
      name: '农历',
      description: '农历、干支与节气。',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: ({ now, state, span }) => {
        const lunar = lunarFor(now)

        /** 最小 1×1 也用紧凑排版完整展示农历、干支与节气。 */
        const wide = span.cols >= 2
        const compact = !wide && span.rows < 2

        const scale = Math.min(span.cols, span.rows * 1.4)
        const footParts = [
          state.festival,
          termLine(lunar),
          `${lunar.nextTerm.name}还有 ${lunar.nextTerm.inDays} 天`,
        ].filter(Boolean)
        const detailFontSize = compact
          ? 'clamp(15px, 2.1vmin, 19px)'
          : `clamp(15px, ${1.8 + scale * 0.2}vmin, 24px)`
        const foot = (
          <div
            className="fd-heading fd-secondary"
            style={{
              display: 'flex',
              flexDirection: wide ? 'row' : 'column',
              flexWrap: 'wrap',
              gap: wide ? '0.3em 0.8em' : '0.08em',
              fontSize: detailFontSize,
              lineHeight: 1.2,
              letterSpacing: '0.04em',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7ch' }}>
              <div>
                {lunar.yearPillar}年{lunar.monthPillar}月
              </div>
              <div>{lunar.dayPillar}日</div>
            </div>
            {footParts.map((part) => (
              <div key={part}>{part}</div>
            ))}
          </div>
        )

        const lunarBlock = (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: compact ? '0.1vmin' : '0.25vmin',
              minWidth: 0,
            }}
          >
            <div
              className="fd-heading fd-muted"
              style={{
                position: 'absolute',
                top: compact ? 'clamp(10px, 1.35vmin, 18px)' : 'clamp(16px, 2.6vmin, 34px)',
                left: compact ? 'clamp(10px, 1.35vmin, 18px)' : 'clamp(16px, 2.6vmin, 34px)',
                fontSize: detailFontSize,
                letterSpacing: '0.04em',
                lineHeight: 1.2,
              }}
            >
              {lunar.zodiac}年
            </div>
            <div
              className="fd-heading"
              style={{
                fontSize: compact ? 'clamp(42px, 9.6vmin, 60px)' : `clamp(42px, ${4 + scale * 2.7}vmin, 92px)`,
                lineHeight: 1.02,
              }}
            >
              {lunar.date}
            </div>
          </div>
        )

        if (compact) {
          return (
            <Tile foot={foot} style={{ padding: 'clamp(10px, 1.35vmin, 18px)' }}>
              {lunarBlock}
            </Tile>
          )
        }

        return (
          <Tile foot={foot}>
            {lunarBlock}
          </Tile>
        )
      },
    },
  ],

  triggers: [
    {
      id: 'in-range',
      name: '在指定时段内',
      description: '例如 22 点到 7 点自动切到夜间布局',
      params: [
        { key: 'from', label: '起始小时', type: 'number', default: 22, min: 0, max: 23, step: 1, unit: '时' },
        { key: 'to', label: '结束小时', type: 'number', default: 7, min: 0, max: 23, step: 1, unit: '时' },
      ],
      evaluate: ({ now, params }) => hourIn(now.getHours(), Number(params.from), Number(params.to)),
    },
    {
      id: 'weekend',
      name: '在周末',
      evaluate: ({ now }) => now.getDay() === 0 || now.getDay() === 6,
    },
    {
      id: 'solar-term',
      name: '今天交节气',
      description: '立春、冬至这类日子，可以切到一套应景的布局',
      evaluate: ({ now }) => lunarFor(now).term !== null,
    },
    {
      id: 'lunar-day',
      name: '在农历某一天',
      description: '例如八月十五自动切到中秋布局',
      params: [
        { key: 'month', label: '农历月', type: 'number', default: 8, min: 1, max: 12, step: 1, unit: '月' },
        { key: 'day', label: '农历日', type: 'number', default: 15, min: 1, max: 30, step: 1, unit: '日' },
      ],
      evaluate: ({ now, params }) => {
        const lunar = lunarFor(now)
        return !lunar.leap && lunar.month === Number(params.month) && lunar.day === Number(params.day)
      },
    },
  ],
})
