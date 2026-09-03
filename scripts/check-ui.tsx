/**
 * 渲染冒烟检查：在 jsdom 里把展示页和管理后台的每一页都挂载一遍，
 * 确认没有渲染期就炸掉的东西（拼错的 import、少传的 prop、空数据没兜住）。
 *
 * 它不替代人眼看效果，只保证「页面能起来」这条底线，跑 `pnpm check:ui`。
 */

import { JSDOM } from 'jsdom'

/** 行级 LRC 夹具：同时间戳的第二条文本作为可选翻译。 */
const DEMO_LRC = `[ar:棱镜合唱团]
[00:00.00]占位第一行
[00:00.00]First placeholder line
[00:04.00]占位第二行
[00:10.00][00:20.00]复用时间戳
[00:30.00]已经唱过的歌词
[00:34.00]晚风经过信号灯
[00:34.00]The night breeze passes the light
[00:50.00]间奏后的下一行`

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:8787/console/',
  pretendToBeVisual: true,
})

const win = dom.window as unknown as Window & typeof globalThis

// jsdom 没有的几样东西，按最小可用补上
win.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

/** 假 WebSocket：不连网，但留了口子让测试往展示页里推消息 */
class FakeSocket {
  static OPEN = 1
  static latest: FakeSocket | null = null
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    FakeSocket.latest = this
    setTimeout(() => this.onopen?.(), 0)
  }

  send() {}
  close() {}

  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

// jsdom 的 window 上有几百个 DOM 构造函数，React 与 Radix 会零散地引用到，
// 与其一个个补，不如整体搬到 globalThis 上，再覆盖掉少数需要替身的。
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis) continue
  try {
    Object.defineProperty(globalThis, key, {
      get: () => (win as unknown as Record<string, unknown>)[key],
      configurable: true,
    })
  } catch {
    // 少数属性不让代理，跳过
  }
}

const globals: Record<string, unknown> = {
  window: win,
  document: win.document,
  navigator: win.navigator,
  location: win.location,
  localStorage: win.localStorage,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  WebSocket: FakeSocket,
  // 让 React 认这是测试环境，否则 act() 会一直告警
  IS_REACT_ACT_ENVIRONMENT: true,
}

// Node 24 里 navigator 这类是只读访问器，Object.assign 会直接抛，得逐个定义
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

// 这些模块在导入期就会摸 window，必须等 shim 装好再加载
const { createElement, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router')
const { RuntimeProvider } = await import('../src/core/runtime')
const { Display } = await import('../src/display/Display')
const { ConsoleApp } = await import('../src/console/App')

let failures = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `  期望 ${expected}，实际 ${actual}`}`)
}

const errors: string[] = []
const realError = console.error
console.error = (...args: unknown[]) => {
  errors.push(String(args[0]))
  realError(...args)
}

async function mount(label: string, node: React.ReactNode, expect: string[]) {
  const host = win.document.createElement('div')
  win.document.body.append(host)
  const root = createRoot(host)
  const before = errors.length

  try {
    await act(async () => {
      root.render(createElement(StrictMode, null, node))
    })
    const text = host.textContent ?? ''
    const missing = expect.filter((needle) => !text.includes(needle))
    const blew = errors.length > before
    if (missing.length > 0 || blew) {
      failures += 1
      console.log(`  ✗ ${label}${missing.length ? `  没找到：${missing.join('、')}` : ''}`)
    } else {
      console.log(`  ✓ ${label}`)
    }
  } catch (error) {
    failures += 1
    {
      const err = error as AggregateError
      const inner = Array.isArray(err.errors) ? err.errors : [error]
      console.log(`  ✗ ${label}  抛错：`)
      for (const e of inner) console.log('     ', (e as Error).stack?.split('\n').slice(0, 4).join('\n      '))
    }
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}

const withRuntime = (role: 'display' | 'console', children: React.ReactNode) =>
  createElement(RuntimeProvider, { role, children })

console.log('展示页：')
await mount('展示页挂载并画出默认布局', withRuntime('display', createElement(Display)), ['星期'])

console.log('\n管理后台：')
for (const [path, label, expect] of [
  ['/', '概览', ['当前生效', '触发条件实况']],
  ['/layouts', '布局', ['列', '实时预览', '什么时候用这套布局']],
  ['/plugins', '插件', ['媒体展示', '提供的卡片', '注册的接口']],
  ['/appearance', '外观', ['主题', '布局切换动效']],
  ['/data', '数据接入', ['注入示例数据', '当前数据快照']],
] as const) {
  await mount(
    label,
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      withRuntime('console', createElement(ConsoleApp)),
    ),
    [...expect],
  )
}

// ── 数据一变，画面跟着换 ───────────────────────────────────────────────────
console.log('\n实时切换：')

{
  const { defaultConfig } = await import('../src/core/defaults')
  const { emptyMedia } = await import('../src/plugins/media/state')

  const host = win.document.createElement('div')
  win.document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(createElement(RuntimeProvider, { role: 'display', children: createElement(Display) }))
  })

  const socket = FakeSocket.latest!
  /** 当前布局里的文字。退场替身是过渡期的临时元素，不该被算进来。 */
  const liveText = () =>
    [...host.querySelectorAll('.fd-cell:not(.fd-ghost)')].map((n) => n.textContent ?? '').join(' ')

  const push = async (message: unknown) => {
    await act(async () => {
      socket.deliver(message)
      // 布局判定挂在每秒心跳上，等一拍让它跑完
      await new Promise((r) => setTimeout(r, 1100))
    })
  }

  await push({
    type: 'hello',
    config: defaultConfig(),
    states: { media: emptyMedia, agenda: { events: [], updatedAt: 0 } },
    serverTime: Date.now(),
  })
  const deskText = liveText()
  check('起手是「桌面」布局（有星期格）', deskText.includes('星期'), true)

  await push({
    type: 'state',
    plugin: 'media',
    state: {
      ...emptyMedia,
      playing: true,
      title: '晚风与信号灯',
      artist: '棱镜合唱团',
      durationSec: 304,
      positionSec: 34,
      positionAt: Date.now(),
      lyricsLrc: DEMO_LRC,
    },
  })
  const playingText = liveText()
  check('推入播放数据后切到「正在播放」（出现歌词格）', playingText.includes('歌词'), true)
  check('「正在播放」里没有星期格', playingText.includes('星期'), false)
  check('LRC 解析并渲染当前歌词', playingText.includes('晚风经过信号灯'), true)
  check('切行后不再显示上一行', playingText.includes('已经唱过的歌词'), false)
  check('同一时刻只显示一条主歌词', host.querySelector('.fd-lrc')?.getAttribute('data-lyric-lines'), '1')
  check('同时间戳的第二条文本显示为翻译', playingText.includes('The night breeze passes the light'), true)
  const lyricNodeBeforeStep = host.querySelector('.fd-lrc__content')

  await act(async () => {
    socket.deliver({
      type: 'state',
      plugin: 'media',
      state: {
        ...emptyMedia,
        playing: true,
        title: '晚风与信号灯',
        durationSec: 304,
        positionSec: 50,
        positionAt: Date.now(),
        lyricsLrc: DEMO_LRC,
      },
    })
    await new Promise((r) => setTimeout(r, 20))
  })
  check('换行立即挂上下一行', host.querySelector('.fd-lrc__layer--entering')?.textContent?.includes('间奏后的下一行'), true)
  check('旧歌词同时进入淡出层', host.querySelector('.fd-lrc__layer--leaving')?.textContent?.includes('晚风经过信号灯'), true)
  check('交叉渐变期间新旧两层同时存在', host.querySelectorAll('.fd-lrc__main').length, 2)
  check('新旧层使用相反的同步动画', Boolean(host.querySelector('.fd-lrc__layer--entering') && host.querySelector('.fd-lrc__layer--leaving')), true)
  check('交叉渐变会建立独立歌词节点', host.querySelector('.fd-lrc__layer--entering .fd-lrc__content') === lyricNodeBeforeStep, false)

  await act(async () => {
    await new Promise((r) => setTimeout(r, 300))
  })
  check('渐变结束后只保留当前歌词', host.querySelectorAll('.fd-lrc__main').length, 1)
  check('渐变结束后移除旧歌词层', host.querySelector('.fd-lrc__layer--leaving'), null)

  const REPLACED_LRC = `[00:00.00]新曲目的第一句
[00:00.00]First line of the new track`
  await push({
    type: 'state',
    plugin: 'media',
    state: {
      ...emptyMedia,
      playing: true,
      title: '另一首歌',
      durationSec: 200,
      positionSec: 0,
      positionAt: Date.now(),
      lyricsLrc: REPLACED_LRC,
    },
  })
  check('整份 LRC 替换后不会闪现旧歌词', liveText().includes('间奏后的下一行'), false)
  check('整份 LRC 替换立即显示新歌词', liveText().includes('新曲目的第一句'), true)

  const INTRO_LRC = `[00:08.00]前奏后的第一句`
  await push({
    type: 'state',
    plugin: 'media',
    state: {
      ...emptyMedia,
      playing: true,
      title: '前奏中的歌曲',
      artist: '前奏中的歌手',
      durationSec: 180,
      positionSec: 2,
      positionAt: Date.now(),
      lyricsLrc: INTRO_LRC,
    },
  })
  check('前奏第一行显示歌曲名', host.querySelector('.fd-lrc__main')?.textContent, '前奏中的歌曲')
  check('前奏第二行显示歌手', host.querySelector('.fd-lrc__translation')?.textContent, '前奏中的歌手')
  check('首句未开始时不提前显示歌词', liveText().includes('前奏后的第一句'), false)

  await act(async () => {
    socket.deliver({
      type: 'state',
      plugin: 'media',
      state: {
        ...emptyMedia,
        playing: true,
        title: '前奏中的歌曲',
        artist: '前奏中的歌手',
        durationSec: 180,
        positionSec: 8,
        positionAt: Date.now(),
        lyricsLrc: INTRO_LRC,
      },
    })
    await new Promise((r) => setTimeout(r, 20))
  })
  check('首句到点时歌词开始淡入', host.querySelector('.fd-lrc__layer--entering')?.textContent, '前奏后的第一句')
  check('首句到点时曲名歌手同时淡出', host.querySelector('.fd-lrc__layer--leaving')?.textContent, '前奏中的歌曲前奏中的歌手')

  // ── 停止后要回到主布局 ────────────────────────────────────────────────
  // pausedAt 故意放在 10 秒前，5 秒宽限早就过了，下一拍心跳就该退出。
  await push({
    type: 'state',
    plugin: 'media',
    state: {
      ...emptyMedia,
      playing: false,
      title: '晚风与信号灯',
      artist: '棱镜合唱团',
      durationSec: 304,
      positionSec: 34,
      positionAt: Date.now() - 10_000,
      pausedAt: Date.now() - 10_000,
      lyricsLrc: DEMO_LRC,
    },
  })
  // 宽限已经过了，就该在下一拍心跳里退出。这里最多再等两拍——
  // 一旦「正在播放」又被加回 holdMs，两层防抖叠起来就会超时，这条断言会拦住。
  let ticks = 0
  for (; ticks < 2; ticks += 1) {
    if (liveText().includes('星期')) break
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100))
    })
  }
  const stoppedText = liveText()
  check('退出耗时不超过两拍心跳', ticks <= 1, true)
  check('停止且过了宽限 → 退回「桌面」（星期格回来）', stoppedText.includes('星期'), true)
  check('停止后不再有歌词格', stoppedText.includes('歌词'), false)

  // ── 布局切换的过渡 ────────────────────────────────────────────────────
  // 两套布局共用的卡片必须是**同一个 DOM 节点**——节点被销毁重建的话，
  // FLIP 就没有起点，只能瞬移。这条断言盯的就是这件事。
  console.log('\n布局过渡：')
  const cellOf = (card: string) => host.querySelector(`.fd-cell[data-card="${card}"]:not(.fd-ghost)`)

  await push({ type: 'state', plugin: 'media', state: { ...emptyMedia } })
  const deskTime = cellOf('datetime:time')
  check('「桌面」里有时间卡', Boolean(deskTime), true)

  await push({
    type: 'state',
    plugin: 'media',
    state: { ...emptyMedia, playing: true, title: '晚风与信号灯', durationSec: 304,
      positionSec: 34, positionAt: Date.now(), lyricsLrc: DEMO_LRC },
  })
  check('已切到「正在播放」', Boolean(host.querySelector('.fd-cell[data-card="media:lyrics"]')), true)
  check('两套共用的时间卡是同一个节点（能做位移动画）', cellOf('datetime:time') === deskTime, true)
  check('只有旧布局才有的卡片留下了退场替身', Boolean(host.querySelector('.fd-ghost')), true)

  await act(async () => root.unmount())
  host.remove()
}

// ── LRC 解析与步进（纯逻辑，不碰 DOM）──────────────────────────────────────
{
  console.log('\nLRC 步进：')
  const { activeLyric, parseLyrics } = await import('../src/plugins/media/lyrics')
  const { emptyMedia, livePosition } = await import('../src/plugins/media/state')
  const lines = parseLyrics(DEMO_LRC)

  check('同时间戳文本合并为正文和翻译', lines[0].translation, 'First placeholder line')
  check('一行多个时间戳展开为两个歌词条目', lines.filter((line) => line.text === '复用时间戳').length, 2)
  check('首行开唱前不显示歌词', activeLyric(lines, -1), null)
  check('34 秒只返回当前歌词正文', activeLyric(lines, 34_000)?.text, '晚风经过信号灯')
  check('当前歌词携带可选翻译', activeLyric(lines, 34_000)?.translation, 'The night breeze passes the light')
  check('下一时间戳前保持当前歌词', activeLyric(lines, 49_999)?.text, '晚风经过信号灯')

  const offsetLines = parseLyrics('[offset:+250]\n[00:01.00]延后出现')
  check('支持 LRC 全局毫秒偏移', offsetLines[0].timeMs, 1250)

  const positionAt = 10_000
  const freshProgress = {
    ...emptyMedia,
    playing: true,
    durationSec: 100,
    positionSec: 34.2,
    positionAt,
  }
  check('新进度包不会被旧页面时钟倒推', livePosition(freshProgress, positionAt - 800), 34.2)
  check('页面时钟向前时会正常补齐进度', livePosition(freshProgress, positionAt + 800), 35)
}

console.error = realError
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`)
process.exit(failures === 0 ? 0 : 1)
