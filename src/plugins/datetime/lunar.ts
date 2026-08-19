import lunisolar from 'lunisolar'
import theGods from 'lunisolar/plugins/theGods.js'
import zhCn from 'lunisolar/locale/zh-cn.js'
import theGodsZhCn from 'lunisolar/plugins/theGods/locale/zh-cn.js'

/**
 * 农历换算。算法交给 lunisolar：
 *   https://lunisolar.js.org/
 *
 * 这里只是一层适配，把它的输出整理成卡片要的形状。自己实现的那版
 * （Meeus 定朔定气 + 建除十二神）已经撤掉——宜忌那部分尤其换得值：
 * 原来只有建除一层，现在是 theGods 插件的整套神煞，和纸质黄历同源。
 *
 * 两个 locale 都叫 zh-cn 但键不重叠：核心那份管「闰」「星期」这些字，
 * theGods 那份管神煞与宜忌的简体译名，得合起来喂进去，否则会冒出繁体。
 */
lunisolar.extend(theGods)
lunisolar.locale({ ...(zhCn as any), ...(theGodsZhCn as any) })

const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']

/**
 * 民用三十六个词条里，locale 表漏收了这几个，出来还是繁体。
 * 逐个扫过 1902–2099 的全部输出，就这四个，写死抹平。
 */
const SIMPLIFY: Record<string, string> = {
  諸事不宜: '诸事不宜',
  會親友: '会亲友',
  修造動土: '修造动土',
  破屋壞垣: '破屋坏垣',
}
const simplify = (word: string) => SIMPLIFY[word] ?? word

const DAY_MS = 86_400_000

/**
 * theGods 在闰月里会抛异常（2.6.0 实测：闰月的日子 100% 抛，平常月一天不抛，
 * 核心的农历、干支、节气都不受影响）。闰月大约三年来一次、一次一个月，
 * 总不能让屏幕上的宜忌空一个月，所以留一份建除十二神兜底。
 *
 * 建除的定法：月建那一支的日子为「建」，此后按日支顺推。它只用到干支，
 * 而干支在闰月里是好的，所以这份兜底一定算得出来。
 */
const OFFICERS = [
  { name: '建', good: ['出行', '上任', '见贵', '求财'], bad: ['动土', '开仓', '掘井', '安床'] },
  { name: '除', good: ['除服', '疗病', '出行', '拆卸'], bad: ['求财', '开市', '出货'] },
  { name: '满', good: ['祭祀', '祈福', '造仓', '嫁娶'], bad: ['服药', '栽种', '安葬'] },
  { name: '平', good: ['修墙', '铺路', '嫁娶', '安床'], bad: ['求医', '栽种', '开渠'] },
  { name: '定', good: ['祭祀', '祈福', '嫁娶', '修造'], bad: ['词讼', '出行', '交涉'] },
  { name: '执', good: ['捕捉', '结网', '造屋', '收敛'], bad: ['开市', '移徙', '出行'] },
  { name: '破', good: ['破屋', '坏垣', '求医', '治病'], bad: ['嫁娶', '开市', '动土', '签约'] },
  { name: '危', good: ['安床', '祭祀', '拆卸'], bad: ['登高', '行船', '出行'] },
  { name: '成', good: ['开市', '嫁娶', '交易', '入学'], bad: ['词讼', '争斗'] },
  { name: '收', good: ['纳财', '捕捉', '进人口'], bad: ['开仓', '出货', '安葬'] },
  { name: '开', good: ['祭祀', '祈福', '入学', '开市'], bad: ['安葬', '动土'] },
  { name: '闭', good: ['筑堤', '埋穴', '修补'], bad: ['出行', '开市', '手术'] },
]

type Almanac = { officer: string; suitable: string[]; avoid: string[] }

function almanacOf(ls: any, char8: any): Almanac {
  try {
    const gods = ls.theGods
    return {
      officer: String(gods.getDuty12God()),
      // actType 3 = 民用三十七事。不筛的话头几条常是「覃恩」「肆赦」
      // 这类朝廷事项，摆在桌面时钟上没什么用。
      suitable: (gods.getGoodActs(3) as string[]).map(simplify),
      avoid: (gods.getBadActs(3) as string[]).map(simplify),
    }
  } catch {
    const monthBranch = char8.month.branch.valueOf()
    const dayBranch = char8.day.branch.valueOf()
    const officer = OFFICERS[(((dayBranch - monthBranch) % 12) + 12) % 12]
    return { officer: officer.name, suitable: officer.good, avoid: officer.bad }
  }
}

/** 公历 → 儒略日编号。检查脚本靠它逐日遍历，卡片用不到。 */
export function jdnFromYMD(y: number, m: number, d: number): number {
  // 一、二月算作上一年的第 13、14 月（原公式用的是截断除法，不是向下取整）
  const a = m <= 2 ? -1 : 0
  return (
    Math.floor((1461 * (y + 4800 + a)) / 4) +
    Math.floor((367 * (m - 2 - 12 * a)) / 12) -
    Math.floor((3 * Math.floor((y + 4900 + a) / 100)) / 4) +
    d -
    32075
  )
}

/** 儒略日编号 → 公历 */
export function ymdFromJdn(jdn: number): { y: number; m: number; d: number } {
  let l = jdn + 68569
  const n = Math.floor((4 * l) / 146097)
  l -= Math.floor((146097 * n + 3) / 4)
  const i = Math.floor((4000 * (l + 1)) / 1461001)
  l = l - Math.floor((1461 * i) / 4) + 31
  const j = Math.floor((80 * l) / 2447)
  const d = l - Math.floor((2447 * j) / 80)
  l = Math.floor(j / 11)
  return { y: 100 * (n - 49) + i + l, m: j + 2 - 12 * l, d }
}

export type LunarDate = {
  /** 农历年 */
  year: number
  /** 1–12 */
  month: number
  /** 1–30 */
  day: number
  leap: boolean
  /** 七月 / 闰六月 */
  monthName: string
  /** 初七 */
  dayName: string
  /** 七月初七 */
  date: string
  /** 丙午 */
  yearPillar: string
  /** 丙申 */
  monthPillar: string
  /** 乙丑 */
  dayPillar: string
  /** 马 */
  zodiac: string
  /** 当天正好交节气时的名字，否则为 null */
  term: string | null
  /** 当前所处的节气 */
  currentTerm: string
  /** 初候 / 次候 / 末候 */
  phase: string
  /** 下一个节气 */
  nextTerm: { name: string; day: number; inDays: number }
  /** 值日的建除十二神，如「执」 */
  officer: string
  /** 宜。神煞推出来的民用词条，可能有十几条，用的地方自己截。 */
  suitable: string[]
  /** 忌。约一成的日子确实没有忌，空数组是正常结果，不是没算出来。 */
  avoid: string[]
}

/** 把一个公历日期换算成农历 */
export function lunarOf(date: Date): LunarDate {
  return lunarOfYMD(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function lunarOfYMD(y: number, m: number, d: number): LunarDate {
  const pad = (n: number) => String(n).padStart(2, '0')
  // 固定取当天正午：避开零点前后被时区与交节时刻带偏
  const ls = lunisolar(`${y}-${pad(m)}-${pad(d)} 12:00:00`) as any

  const lunar = ls.lunar
  const char8 = ls.char8
  const almanac = almanacOf(ls, char8)

  const monthName = String(lunar.getMonthName())
  const dayName = String(lunar.getDayName())

  const [recentTerm, recentTermDate] = ls.recentSolarTerm() as [unknown, Date]
  const sinceTerm = Math.floor((ls.toDate().getTime() - recentTermDate.getTime()) / DAY_MS)

  return {
    year: lunar.year,
    // lunisolar 用 100+n 表示闰 n 月，对外只给月序，闰不闰看 leap
    month: lunar.month > 100 ? lunar.month - 100 : lunar.month,
    day: lunar.day,
    leap: Boolean(lunar.isLeapMonth),
    monthName,
    dayName,
    date: monthName + dayName,
    yearPillar: String(char8.year),
    monthPillar: String(char8.month),
    dayPillar: String(char8.day),
    zodiac: ZODIAC[char8.year.branch.valueOf()],
    term: ls.solarTerm ? String(ls.solarTerm) : null,
    currentTerm: String(recentTerm),
    phase: ['初候', '次候', '末候'][Math.min(2, Math.max(0, Math.floor(sinceTerm / 5)))],
    nextTerm: nextTermOf(ls, jdnFromYMD(y, m, d)),
    ...almanac,
  }
}

/** 往后找到下一个交节的日子。节气间隔最多 16 天，找不到就当没有。 */
function nextTermOf(ls: any, jdn: number): { name: string; day: number; inDays: number } {
  for (let i = 1; i <= 16; i += 1) {
    const ahead = ls.add(i, 'day')
    if (ahead.solarTerm) return { name: String(ahead.solarTerm), day: jdn + i, inDays: i }
  }
  return { name: '', day: jdn, inDays: 0 }
}

/** 农历 七月初七 丙午年丙申月 乙丑日 */
export const lunarLine = (l: LunarDate) =>
  `农历 ${l.date} ${l.yearPillar}年${l.monthPillar}月 ${l.dayPillar}日`

/** 立秋 · 末候 */
export const termLine = (l: LunarDate) => `${l.currentTerm} · ${l.phase}`
