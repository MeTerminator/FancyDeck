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
 * 除了宜忌，这个插件不需要服务端：农历、干支、节气都由 lunar.ts 现算。
 */

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

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

  routes: [{ method: 'POST', path: '/api/p/datetime/today', description: '上报今日宜忌与节日' }],

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
          <Tile>
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
      id: 'date',
      name: '日期',
      description: '几月几号与年份，可带农历',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ now, state, settings }) => {
        const lunar = lunarFor(now)
        const foot = settings.showLunar !== false ? state.festival || lunar.date : now.getFullYear()
        return (
          <Tile label="日期" foot={foot}>
            <div className="fd-row">
              <div className="fd-display" style={{ fontSize: 'clamp(46px, 10vmin, 150px)' }}>
                {now.getDate()}
              </div>
              <div className="fd-heading fd-secondary" style={{ fontSize: 'clamp(14px, 2.1vmin, 26px)' }}>
                {MONTHS[now.getMonth()]}月
              </div>
            </div>
          </Tile>
        )
      },
    },
    {
      id: 'weekday',
      name: '星期',
      description: '只显示星期几',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ now }) => (
        <Tile label="星期">
          <div className="fd-heading" style={{ fontSize: 'clamp(26px, 5.6vmin, 70px)' }}>
            {weekdayCN(now)}
          </div>
        </Tile>
      ),
    },
    {
      id: 'date-weekday',
      name: '日期与星期',
      description: '第一行 08/19，第二行星期几',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ now, span }) => (
        <Tile>
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
      id: 'almanac',
      name: '星期与农历',
      description: '星期为主，底下一行农历与干支',
      size: { minCols: 1, minRows: 1, defaultCols: 1, defaultRows: 1 },
      render: ({ now, state }) => {
        const lunar = lunarFor(now)
        return (
          <Tile label="星期" foot={state.festival || termLine(lunar)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6vmin' }}>
              <div className="fd-heading" style={{ fontSize: 'clamp(26px, 5vmin, 62px)' }}>
                {weekdayCN(now)}
              </div>
              <div className="fd-row">
                <div className="fd-dot" />
                <div className="fd-heading fd-secondary" style={{ fontSize: 'clamp(13px, 2vmin, 24px)' }}>
                  {lunar.yearPillar}年 {lunar.date}
                </div>
              </div>
            </div>
          </Tile>
        )
      },
    },
    {
      id: 'lunar',
      name: '农历',
      description: '农历、干支、节气与宜忌。格子越大露得越多。',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: ({ now, state, span }) => {
        const lunar = lunarFor(now)

        /**
         * 一块四档，最小 1×1 就把农历该说的都说完了：
         *   1×1    农历日期 + 生肖 + 干支
         *   1×2    + 宜忌（往下堆）+ 下一个节气（脚注折成两行）
         *   2×1    + 宜忌（宽而矮，堆不下，改放右边那块空白）+ 下一个节气
         *   2×2 起 全都有
         *
         * 长句一律靠 flexWrap 兜底：格子被压窄时自己折行，不会顶出边界。
         */
        const wide = span.cols >= 2
        const tall = span.rows >= 2
        const sideBySide = wide && !tall
        const showYiJi = wide || tall
        // 比 1×1 大就放得下：一列宽时脚注会折成两行，两行高的格子有这个余量
        const showNextTerm = wide || tall

        const scale = Math.min(span.cols, span.rows * 1.4)
        const footParts = [
          state.festival,
          termLine(lunar),
          showNextTerm ? `${lunar.nextTerm.name}还有 ${lunar.nextTerm.inDays} 天` : '',
        ].filter(Boolean)
        // 一列宽时一行放不下，与其让它在句子中间折断，不如自己分行
        const foot = wide ? (
          footParts.join(' · ')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25em' }}>
            {footParts.map((part) => (
              <div key={part}>{part}</div>
            ))}
          </div>
        )

        const lunarBlock = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vmin', minWidth: 0 }}>
            <div className="fd-row" style={{ flexWrap: 'wrap', rowGap: '0.4vmin' }}>
              <div className="fd-heading" style={{ fontSize: `clamp(22px, ${3 + scale * 2.2}vmin, 84px)` }}>
                {lunar.date}
              </div>
              <div
                className="fd-heading fd-muted"
                style={{ fontSize: 'clamp(12px, 1.7vmin, 20px)', letterSpacing: '0.18em' }}
              >
                {lunar.zodiac}年
              </div>
            </div>
            <div
              className="fd-heading fd-secondary"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.3vmin 0.7ch',
                fontSize: `clamp(12px, ${1.7 + scale * 0.2}vmin, 24px)`,
                letterSpacing: '0.06em',
              }}
            >
              <div>
                {lunar.yearPillar}年{lunar.monthPillar}月
              </div>
              <div>{lunar.dayPillar}日</div>
            </div>
          </div>
        )

        const yiJiLine = (title: string, items: string[]) => (
          <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.3vmin 1.2vmin' }}>
            <div className="fd-heading fd-accent" style={{ fontSize: 'clamp(13px, 1.9vmin, 22px)' }}>
              {title}
            </div>
            <div className="fd-heading fd-secondary" style={{ fontSize: 'clamp(12px, 1.7vmin, 20px)' }}>
              {items.length > 0 ? items.join(' ') : '无'}
            </div>
          </div>
        )

        // 宜忌本地算，上报了就以上报的为准。
        // 一天能给出十几条，格子放不下就截；只有一行高时留得更少，
        // 否则「宜」一折行就把「忌」挤出可视区，看起来像没显示。
        const maxActs = span.rows >= 2 ? 6 : 3
        const suitable = (state.suitable.length > 0 ? state.suitable : lunar.suitable).slice(0, maxActs)
        const avoid = (state.avoid.length > 0 ? state.avoid : lunar.avoid).slice(0, maxActs)

        const yiJiBlock = (
          <div
            style={{
              display: 'flex',
              flex: '1 1 0',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '1vmin',
              minWidth: 0,
            }}
          >
            {yiJiLine('宜', suitable)}
            {yiJiLine('忌', avoid)}
          </div>
        )

        // 分隔线：竖排时是横的，左右分栏时是竖的
        const divider = sideBySide ? (
          <div style={{ flexShrink: 0, alignSelf: 'stretch', width: 1, background: 'var(--fd-line)' }} />
        ) : (
          <div className="fd-rule" style={{ width: '100%' }} />
        )

        return (
          <Tile foot={foot}>
            <div
              style={{
                display: 'flex',
                flexDirection: sideBySide ? 'row' : 'column',
                alignItems: sideBySide ? 'stretch' : undefined,
                gap: sideBySide ? '2.4vmin' : '1.4vmin',
                minWidth: 0,
              }}
            >
              {lunarBlock}
              {showYiJi && (
                <>
                  {divider}
                  {yiJiBlock}
                </>
              )}
            </div>
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
