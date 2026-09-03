# FancyDeck

一块放在桌上的信息屏。它的全部内容都由**插件**提供，落位由**布局预设**决定，
而用哪套布局，是插件自己报出来的**触发条件**说了算——音乐一响，屏幕自己就换成播放器。

```
pnpm install
pnpm dev            # 数据服务 :8787 + 前端 :5173
open http://localhost:5173          # 展示页
open http://localhost:5173/console  # 管理后台
```

生产模式下 `pnpm build && pnpm start`，服务端在 8787 上同时把两个页面发出去。

想看布局自动切换，不必先接数据源：管理后台的「数据接入」页有一组
「注入示例数据」按钮，点一下音乐就"响"了，屏幕当场换成播放器。
接真实数据的方式见第五节。

---

## 一、整体结构

三个进程，一条数据链：

```
  ┌───────────────┐    读系统 / 长连接     ┌──────────────────────────┐
  │   采集端       │ ────────────────────▶ │  数据服务 (Node + Hono)   │
  │  （自己写）    │ ◀──────────────────── │                          │
  └───────────────┘   指令：暂停/切歌       │  · 每个插件一份 state     │
                                          │  · 插件注册的路由          │
  curl / 快捷指令 / HA ──── POST ─────────▶ │  · config.json 持久化     │
                                          └───────┬──────────────────┘
                                                  │ WebSocket 广播
                            ┌─────────────────────┴──────────────────┐
                            ▼                                        ▼
                   ┌─────────────────┐                     ┌──────────────────┐
                   │  展示页  /       │                     │  管理后台 /console │
                   │  画卡片、发指令   │                     │  改配置、看实况     │
                   └─────────────────┘                     └──────────────────┘
```

**关键取舍：布局判定放在客户端。** 服务端只负责收数据、存配置、广播，
不参与「现在该显示哪套布局」的决策。判定引擎 `src/core/engine.ts` 是一组纯函数，
展示页与管理后台跑的是同一份代码——所以后台里看到的「此刻条件成立」，
和屏幕上正在发生的事一定是同一件事，不会两边实现出现偏差。

这样还有个好处：屏幕方向、本地时钟这类只有客户端知道的东西，
可以和服务端下发的数据平等地参与判定，不需要为它们再造一条回传通道。

### 目录

```
src/core/          框架本体：契约、判定引擎、运行时、连接
  types.ts           三端共用的类型。只有类型和纯函数，不 import React 或 node
  plugin.tsx         插件前端半边的定义（卡片、触发条件、本地数据源）
  engine.ts          条件求值 + 布局判定 + 网格几何。纯函数，可单独测
  runtime.tsx        React 运行时：连 WebSocket、合并数据、算出该显示哪套布局
  registry.ts        插件注册表，按 key 查卡片 / 查触发条件
  defaults.ts        出厂配置与内置布局
src/plugins/<id>/  插件的前端半边（+ 与服务端共用的 state.ts）
src/display/       展示页
src/console/       管理后台（shadcn/ui）
server/            数据服务
  core/plugin.ts     插件服务端半边的定义
  core/hub.ts        插件数据中枢，唯一的广播出口
  core/store.ts      config.json 读写
  plugins/<id>.ts    插件的服务端半边：路由、指令、定时任务
```

---

## 二、插件

一个插件把「卡片 + 数据 + 路由 + 触发条件」打成一个包。它分成两半：

| | 在哪 | 管什么 | 认不认识对方 |
|---|---|---|---|
| 前端半边 | `src/plugins/<id>/index.tsx` | 卡片长什么样、暴露哪些触发条件、有哪些设置 | 不 import 服务端 |
| 服务端半边 | `server/plugins/<id>.ts` | 注册路由、接收数据、维护状态 | 不 import React |
| 共用 | `src/plugins/<id>/state.ts` | 这个插件的数据长什么样 | 两边都 import 它 |

两半只靠 `id` 和 state 的形状对齐。插件可以只有前端半边（时间与日期几乎就是），
也可以只有服务端半边（纯采集）。

### 一个插件能提供多张卡片

这是「媒体展示」的样子——同一份数据，三种只读卡片，后台随便挑：

```
media:cover           封面
media:lyrics          歌词
media:info            歌曲信息
```

它们读的是同一个 `MediaState`，只展示播放器上报的数据，不提供播放、切歌或跳转进度控制。

### 歌词：LRC

歌词使用行级 **LRC**，`MediaState.lyricsLrc` 保存原文，服务端只负责搬运字符串，
展示端不依赖第三方歌词解析器。第一条歌词开始前，卡片第一行显示歌曲名、第二行
显示歌手；开唱后显示当前歌词正文及一条可选翻译。逐句切换时新旧内容同步交叉渐变，
过渡结束后仍只保留当前歌词条目。

同步翻译使用常见的同时间戳双行写法，第一条作为正文、紧随的第二条作为翻译：

```lrc
[ar:棱镜合唱团]
[ti:晚风与信号灯]
[00:16.00]把城市的边缘开成一条河
[00:34.00]晚风把信号灯吹成橘色的雨
[00:34.00]The evening wind turns the lights into orange rain
[00:52.00]我们在末班车里数完了海
```

解析器支持百分秒或毫秒时间戳、一行多个时间戳和 `[offset:+/-毫秒]`。歌词正文与
翻译一起交给通用 `AutoFit`，会按卡片真实宽高尽量放大，并在溢出前缩小。

### 农历

农历、干支、节气、宜忌全部交给 [lunisolar](https://lunisolar.js.org/)，
`src/plugins/datetime/lunar.ts` 只是一层适配，把它的输出整理成卡片要的形状。
宜忌用它的 [theGods](https://lunisolar.js.org/guide/plugins/thegods.html) 插件，
是整套神煞推演，和纸质黄历同源。

接的时候踩到三处，都在 `lunar.ts` 里处理掉了：

- **闰月编号**：lunisolar 用 `100 + n` 表示闰 n 月，`lunar.month` 直接拿会得到 105
- **繁简混排**：核心与 theGods 各有一份 `zh-cn`，键不重叠，得合并后再喂。
  另有四个词条 locale 表漏收（`諸事不宜` `會親友` `修造動土` `破屋壞垣`），
  扫过 1902–2099 的全部输出确认就这四个，写死抹平
- **闰月里 theGods 必抛**（2.6.0 实测：闰月的日子 100% 抛，平常月一天不抛，
  核心的农历干支节气都不受影响）。闰月三年来一次、一次一个月，
  总不能让宜忌空一个月，所以留了一份建除十二神兜底——它只用干支，一定算得出来

宜忌取的是 `getGoodActs(3)` / `getBadActs(3)`——`3` 是它内置的**民用三十七事**筛选。
不筛的话头几条常是「覃恩」「肆赦」这类朝廷事项，摆在桌面时钟上没什么用。
卡片再按格子大小截几条显示。

**约一成的日子确实没有忌**（吉神把凶煞压住了），这时显示「无」，不是没算出来。

可用区间 **1902–2099**，出了这个范围 lunisolar 自己会抛。

想接更权威的一份，或者加自定义节日，POST 上来覆盖即可
（`suitable`/`avoid` 留空就用算出来的）：

```bash
curl -X POST localhost:8787/api/p/datetime/today \
  -H 'content-type: application/json' \
  -d '{"suitable":["祈福","嫁娶"],"avoid":["动土"],"festival":"七夕"}'
```

准确性核对过：已知的春节、闰月、节气与干支逐个对，
再与 ICU 自带的 chinese 历法逐日比对 1902–2099（七万多天）。
两者在 12 个年份上有出入，每一处经查都是 ICU 把某个临界的朔判早/判晚了一天
（1954、1987、2012、2018、2027、2030 的春节与初一都以 lunisolar 为准）。

### 写一个插件

```tsx
// src/plugins/hello/index.tsx
import { definePlugin } from '../../core/plugin'
import { Tile } from '../../ui/Tile'

type HelloState = { greeting: string; updatedAt: number }

export default definePlugin<HelloState>({
  id: 'hello',
  name: '打招呼',
  icon: 'Hand',                                  // lucide 图标名
  defaultState: { greeting: '你好', updatedAt: 0 },

  settings: [
    { key: 'loud', label: '大声一点', type: 'boolean', default: false },
  ],

  cards: [
    {
      id: 'hello',
      name: '问候',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 1 },
      // span 是这张卡当前占几格，卡片可以据此切换紧凑/完整排版
      render: ({ state, settings, span, command }) => (
        <Tile label="问候">
          <div className="fd-heading" style={{ fontSize: settings.loud ? '8vmin' : '3vmin' }}>
            {state.greeting}
          </div>
        </Tile>
      ),
    },
  ],

  triggers: [
    {
      id: 'shouting',
      name: '在打招呼时',
      params: [
        { key: 'within', label: '最近', type: 'number', default: 60, unit: '秒' },
      ],
      evaluate: ({ state, params, now }) =>
        now.getTime() - state.updatedAt < Number(params.within) * 1000,
    },
  ],
})
```

```ts
// server/plugins/hello.ts
import { defineServerPlugin } from '../core/plugin'

export default defineServerPlugin({
  id: 'hello',
  initialState: { greeting: '你好', updatedAt: 0 },
  routes(app, ctx) {
    // 挂在 /api/p/hello 下面
    app.post('/say', async (c) => {
      const { greeting } = await c.req.json()
      ctx.setState({ greeting, updatedAt: Date.now() })   // setState 即广播
      return c.json({ ok: true })
    })
  },
})
```

最后各加一行注册：`src/plugins/index.ts` 和 `server/plugins/index.ts`。

**到此为止就完事了。** 管理后台不需要改任何代码——
新卡片会出现在卡片库里，新触发条件会出现在条件下拉里，
`settings` 与 `params` 会被自动渲染成表单，`routes` 会出现在「数据接入」页并带上可复制的 curl。

### 候选项太多的设置项

`ParamSpec` 有五种：`boolean` / `number` / `string` / `select` / `lookup`。
前四种是自解释的，`lookup` 是给「选项多到不该打包进浏览器」的场景准备的——
天气那两千多个城市就是：

```ts
{
  key: 'cityCode',
  label: '城市',
  type: 'lookup',
  default: '101210101',
  source: '/api/p/weather/cities',   // 后台按需去问
  groupLabel: '省份',                 // 给了就是两级：先选省，再选市
}
```

后台把它渲染成选择器，插件只要在自己的服务端半边支持这几种查询：

```
GET <source>?groups=1              → 一级候选（省份），返回 { value, label }[]
GET <source>?group=<组>&q=<关键词>  → 组内候选（市县），返回 { value, label }[]
GET <source>?value=<值>            → 回显，返回 [{ value, label, group }]
```

两个好处。一是选项集留在服务端：展示页一个字都不用背，后台也不用一次拉全量。
二是**存下来的始终只有二级那一个值**——省份是从 `?value=` 的回显里反推的，
不占设置项，也就不存在「改了省、市却还指着老省」这种对不上的中间态。

### 卡片能拿到什么

```ts
type CardContext<S> = {
  state: S                          // 服务端数据 + 本地数据源合并后的快照
  settings: ParamValues             // 后台里配的，已补默认值
  span: { cols: number; rows: number }   // 当前占几格
  presetId: string                  // 当前是哪套布局
  now: Date                         // 每秒一跳，全屏共用一个时间基准
  command(action, payload?): void   // 发指令，服务端处理或转给采集端
  patchState(patch): void           // 本地乐观更新
}
```

`command` 的路径是：卡片 → 服务端插件的 `commands[action]` → 若没声明就透传给采集端。
所以「点暂停」这件事，服务端自己做不了，但它知道该找谁做。

---

## 三、布局与触发条件

一套布局预设长这样：

```ts
{
  id: 'now-playing',
  name: '正在播放',
  cols: 4, rows: 3,
  colRatio: [1, 2, 2, 1],           // 可选，缺省等分
  slots: [
    { id: 's1', card: 'media:cover',    col: 1, row: 1, colSpan: 2, rowSpan: 2 },
    { id: 's2', card: 'media:lyrics',   col: 3, row: 1, colSpan: 2, rowSpan: 2 },
    { id: 's3', card: 'datetime:time',  col: 1, row: 3, colSpan: 2, rowSpan: 1 },
    { id: 's4', card: 'media:info',     col: 3, row: 3, colSpan: 2, rowSpan: 1 },
  ],
  orientation: 'landscape',
  when: { kind: 'trigger', ref: 'media:playing' },
  priority: 10,
  holdMs: 4000,
  enabled: true,
}
```

`when` 是一棵可以嵌套的条件树，插件提供叶子，后台负责组合：

```ts
{ kind: 'all', of: [
  { kind: 'trigger', ref: 'media:playing' },
  { kind: 'not', of: { kind: 'trigger', ref: 'agenda:soon', params: { withinMinutes: 10 } } },
]}
```

判定顺序：

1. 后台**钉住**了某套 → 用它（用来对着屏幕调布局）
2. 否则在「已启用 + 方向匹配 + 条件成立」的预设里挑 `priority` 最大的
3. 都不成立 → 兜底预设

两个细节值得说一下：

- **`holdMs` 最短停留。** 切歌的一瞬间 `playing` 会闪一下 false，如果照直判定，
  屏幕会跟着抖。所以刚切进来的布局有一段保护期，期内不让走。
- **插件关掉后，它的触发条件恒为 false，它的卡片直接不渲染。**
  关掉媒体插件，「正在播放」这套布局就永远不会命中，屏幕上也不会留下空洞的播放器格子。

---

## 四、管理后台 `/console`

顶部导航 + 侧边导航，五个页面：

| 页面 | 干什么 |
|---|---|
| **概览** | 现在显示的是哪套布局、**为什么**是它；每个触发条件此刻的真假；各插件最近一次收到数据的时间 |
| **布局** | 可视化编辑网格：在空白处**拖出一片区域**放卡片，拖卡片搬家，拖右下角改大小；改列数行数与列宽行高比例；配触发条件、优先级、方向 |
| **插件** | 一键开关；插件自带的设置表单；它提供了哪些卡片/触发条件/接口；被多少处布局用到 |
| **外观** | 摆件主题（四套）、布局切换动效时长 |
| **数据接入** | 每个插件注册的路由 + 可复制的 curl；当前数据快照；一组示例数据注入按钮 |

后台里的「实时预览」是把真正的展示页 `<iframe>` 进来，而不是在后台里重画一遍——
预览里看到的就一定是屏幕上的样子。

**改动实时生效**：后台每次改动都立刻走 WebSocket 发给服务端，服务端落盘并广播，
所有展示页当场重画，不需要刷新。

---

## 五、往屏幕里喂数据

任何能发 HTTP 的东西都行。每个插件的路由挂在 `/api/p/<插件id>/` 下：

```bash
curl -X POST localhost:8787/api/p/media/now-playing \
  -H 'content-type: application/json' \
  -d '{"playing":true,"title":"晚风与信号灯","artist":"棱镜合唱团",
       "durationSec":304,"positionSec":34}'
```

没写专属路由的插件也能用通用口：`POST /api/p/<id>/state`（加 `?merge=0` 整份替换）。

### 插件自己的 WebSocket 端点

插件可以实现 `socket()`，框架就会把 `/ws/p/<插件id>` 上的连接交给它——
和 `routes()` 一样，框架只负责接线，协议内容由插件自己定。

媒体插件用它把「还在播吗」这件事交给连接本身：

```
ws://<host>/ws/p/media

  → { "type": "play",     "title": "…", "artist": "…", "durationSec": 260 }
  → { "type": "lyrics",   "lrc": "[00:12.30]歌词…" }
  → { "type": "progress", "positionSec": 12.3, "playing": true }
  → { "type": "stop" }

连上并发过 play 即视为在播；发 stop、或者连接一断，即视为停止。
```

「断开即停止」是用长连接的理由：播放器崩了、网断了、进程被 kill 了，
屏幕不会继续挂着一首根本没在响的歌。HTTP 那条没有「断开」可言，
所以仍然靠 `staleMs` 超时兜底。

`progress` 一到就算「在播」（`playing` 可省），停止之后再来一条也能把播放接回来；
要报暂停就显式带上 `playing: false`。客户端对 `progress` 做了 **0.3 秒防抖**——
屏幕自己会补齐两次上报之间的进度，发太密既不更准也不更快。

### 停止立刻退，暂停才有宽限

「暂停」和「停止」在屏幕上是两件事：

| | 意思 | 画面 |
|---|---|---|
| 暂停 | 还想接着听 | 留一会儿再退（`graceSeconds`，默认 **5 秒**） |
| 停止 | 这次听完了 | **立刻**退回主布局 |
| 断开连接 | 播放器没了 | 同停止，**立刻**退 |

两者都是 `playing=false`，区别只在 `pausedAt`：打上时间戳的是暂停，
归零的是停止——`media:playing` 的宽限只认有时间戳的那种。
这样按一下暂停、切歌时短暂的 `playing=false`、缓冲卡一下，画面都不会来回抖；
真的停了或者播放器掉线，则当场就退。

**所以「正在播放」这套预设不再设 `holdMs`。** 两者都是防抖：`holdMs` 管
「切进来之后至少停留多久」，暂停宽限管「条件消失后再等多久」。叠在一起的话，
停止后要等满「宽限 + holdMs」才退出——短暂播放几秒就停的时候能拖到九秒，
看着像卡住不动。防抖交给宽限一家做就够了。

### 歌词从哪来

播放器直接上报 LRC，服务端不解析，只搬运字符串。仓库本地的
`agent/ws-media-client.py` 会把 MeT-Music `/api/lyrics` 返回的 YRC/LRC 统一降为
行级 LRC；`line.tran` 会写成同时间戳的第二行，供卡片显示翻译。它会监测发往
FancyDeck 的长连接，连接失效后每 3 秒重试，并在重连成功时重新发送当前曲目、
进度和整份 LRC，避免进程仍在运行但同步已经静默停止。


### 也有自己去取数的插件

不是所有数据都得等人喂。插件服务端半边的 `start()` 会在服务起来时跑一次，
天气就用它开了个定时器，自己去小米天气取数：

```
https://weatherapi.market.xiaomi.com/wtr-v3/weather/all
```

接口说明见 [XiaomiWeather.md](https://github.com/huanghui0906/API/blob/master/XiaomiWeather.md)。
它不用注册也不用申请 key（`sign` 是接口自带的固定值），在后台「插件 → 天气」里
搜一下城市就能出数：

| 设置 | 说明 |
|---|---|
| 城市 | 先选省份，再选市县；市县那栏还能输关键词过滤。全国 34 省 2566 个市县 |
| 显示名 | 留空则用所选城市的名字；想让屏幕上写「家」「公司」就填这里 |
| 刷新间隔 | 默认 15 分钟 |

城市表来自接口作者提供的 `xiaomi_weather.db`，导出成 `server/plugins/weather-cities.json`，
只在服务端读，不进浏览器的包。

**选完当场生效。** 服务端插件可以声明 `onSettingsChange`，后台一保存就会被调到；
天气用它作废退避、立刻重新取数，实测 0.6 秒屏幕上就换了城市，不用等下一次心跳。

取数失败**不会**把数据清空——
屏幕上挂着十分钟前的天气，也好过回落到出厂那份假数据；一分钟后自动重试。
`POST /api/p/weather/current` 那条手动上报的路也留着，调试时不必等轮询。

---

## 六、配置文件

一切持久化都在 `data/config.json`（可用 `FANCYDECK_CONFIG` 改路径）。
它就是后台里那些开关的全部内容：主题、插件开关与设置、所有布局预设、兜底与钉住。
删掉它，下次启动会写回出厂配置。
