import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { definePlugin } from '../../core/plugin'
import type { CardContext } from '../../core/types'
import { duration } from '../../data/format'
import { useTheme } from '../../theme/ThemeProvider'
import { AlbumCover, NextIcon, PauseIcon, PlayIcon, PrevIcon } from '../../ui/icons'
import { Tile } from '../../ui/Tile'
import { emptyMedia, livePosition, type MediaState } from './state'
import { lineText, parseLyrics, stageLines } from './lyrics'
import { LyricsView } from './LyricsView'

/**
 * 媒体插件。这是「一个插件提供多张卡片」的样板：
 * 封面、歌词、播放控制各是一张独立卡片，
 * 另外再打包两张组合卡（封面+控制、完整播放器），让后台不必自己拼。
 *
 * 所有卡片读同一份 state，所以拆开摆和合起来摆完全同步。
 */

type Ctx = CardContext<MediaState>

const hasTrack = (s: MediaState) => Boolean(s.title)

/** 没歌时统一的占位，免得每张卡各写一遍 */
function Idle({ label }: { label: string }) {
  return (
    <Tile label={label} fit>
      <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.6vmin, 18px)', letterSpacing: '0.2em' }}>
        没有正在播放的内容
      </div>
    </Tile>
  )
}

function NowPlayingLabel({ state }: { state: MediaState }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {state.playing && <span className="fd-dot" />}
      {state.playing ? '正在播放' : '已暂停'}
      {state.app && <span className="fd-muted">· {state.app}</span>}
    </span>
  )
}

function Cover({ state, radius = 0.6 }: { state: MediaState; radius?: number }) {
  const { theme } = useTheme()
  if (state.artwork) {
    return (
      <img
        src={state.artwork}
        alt={`${state.album || state.title} 封面`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: `calc(var(--fd-radius) * ${radius})`,
        }}
      />
    )
  }
  return <AlbumCover accent={theme.colors.accent} cell={theme.colors.cellActive} />
}

function Controls({ state, command, compact }: Ctx & { compact?: boolean }) {
  const size = compact ? 'clamp(14px, 1.8vmin, 22px)' : 'clamp(17px, 2.1vmin, 26px)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.4vmin, 18px)' }}>
      <button type="button" className="fd-control" onClick={() => command('prev')} aria-label="上一曲">
        <PrevIcon size={size} />
      </button>
      <button
        type="button"
        className="fd-control fd-control--primary"
        onClick={() => command('toggle')}
        aria-label={state.playing ? '暂停' : '播放'}
      >
        {state.playing ? <PauseIcon size={size} /> : <PlayIcon size={size} />}
      </button>
      <button type="button" className="fd-control" onClick={() => command('next')} aria-label="下一曲">
        <NextIcon size={size} />
      </button>
    </div>
  )
}

function Progress({ showTimes = true, ...ctx }: Ctx & { showTimes?: boolean }) {
  const { state, now, command } = ctx
  const position = livePosition(state, now.getTime())
  const ratio = state.durationSec > 0 ? position / state.durationSec : 0

  const seek = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const to = ((event.clientX - rect.left) / rect.width) * state.durationSec
    // 只发指令，不本地抢跑。进度条与歌词等播放器把新读数报回来才动，
    // 这样屏幕上永远是播放器的真实位置；播放器要是没执行，屏幕就该原地不动。
    command('seek', { positionSec: to })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px, 1vmin, 12px)', minWidth: 0 }}>
      {showTimes && (
        <span className="fd-display fd-secondary" style={{ fontSize: 'clamp(11px, 1.5vmin, 17px)' }}>
          {duration(position)}
        </span>
      )}
      <button
        type="button"
        className="fd-progress"
        style={{ flex: '1 1 auto', minWidth: 0 }}
        onClick={seek}
        aria-label="调整播放进度"
      >
        <span className="fd-progress__track">
          <span className="fd-progress__fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          <span className="fd-progress__knob" />
        </span>
      </button>
      {showTimes && (
        <span className="fd-display fd-muted" style={{ fontSize: 'clamp(11px, 1.5vmin, 17px)' }}>
          {duration(state.durationSec)}
        </span>
      )}
    </div>
  )
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

/**
 * 一行字放不下就让它滚起来，放得下就当无事发生。
 *
 * 循环要接得上，轨道必须是**两个完全相同的单元**，每个单元 = 内容 + 间隔：
 *
 *     [内容][间隔][内容][间隔]
 *      └── 一个周期 ──┘
 *
 * 位移到 -50% 正好走完一个周期，第二份的开头落在第一份原来的位置上，
 * 循环处看不出断点。以前把间隔只放在两份中间，-50% 就少走了半个间隔，
 * 每绕一圈都要跳一下——那正是「滚动时突然位移」的来源。
 *
 * 溢出与否只量第一份内容的宽度，和滚不滚没有关系，所以不会自己把自己量抖。
 */
function Marquee({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null)
  const unit = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const outer = box.current
    const inner = unit.current
    if (!outer || !inner) return
    const measure = () => setOverflow(Math.max(0, inner.offsetWidth - outer.clientWidth))
    measure()
    // 格子改大小、换歌换成更长的曲名，都要重新判断一次
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  const scrolling = overflow > 1
  const content = <span className="fd-marquee__unit">{children}</span>

  return (
    <div
      ref={box}
      className={['fd-marquee', scrolling ? 'fd-marquee--scroll' : '', className].filter(Boolean).join(' ')}
      // 长的走得久一点，不然短的一晃而过、长的拖半天
      style={{ ...style, ['--fd-marquee-duration' as string]: `${Math.max(8, overflow / 26)}s` }}
    >
      <div className="fd-marquee__track">
        <span ref={unit} className="fd-marquee__unit">
          {children}
        </span>
        {scrolling && (
          <>
            <span className="fd-marquee__gap" />
            <span aria-hidden>{content}</span>
            <span className="fd-marquee__gap" />
          </>
        )}
      </div>
    </div>
  )
}

function TrackTitle({
  state,
  size = 2.6,
  showArtist = true,
}: {
  state: MediaState
  size?: number
  showArtist?: boolean
}) {
  return (
    <Marquee>
      <span className="fd-row" style={{ display: 'inline-flex' }}>
        <span className="fd-heading" style={{ fontSize: `clamp(16px, ${size}vmin, 34px)` }}>
          {state.title}
        </span>
        {showArtist && (
          <span className="fd-secondary" style={{ fontSize: 'clamp(11px, 1.6vmin, 19px)' }}>
            {state.artist}
          </span>
        )}
      </span>
    </Marquee>
  )
}

export default definePlugin<MediaState>({
  id: 'media',
  name: '媒体控制',
  description: '正在播放的歌曲：封面、歌词、播放控制，可拆开摆也可合起来摆。',
  icon: 'Music',
  defaultState: emptyMedia,

  routes: [
    { method: 'POST', path: '/api/p/media/now-playing', description: '上报当前曲目与播放状态' },
    { method: 'POST', path: '/api/p/media/lyrics', description: '上报歌词（TTML 原文）' },
    { method: 'POST', path: '/api/p/media/stopped', description: '标记为已停止' },
    { method: 'GET', path: '/api/p/media/state', description: '读当前状态' },
    {
      method: 'WS',
      path: '/ws/p/media',
      description: '长连接上报：连上发 play 即开始，发 stop 或断开即停止',
    },
  ],

  settings: [
    { key: 'showLyrics', label: '在完整播放器里显示歌词', type: 'boolean', default: true },
    {
      key: 'idleHide',
      label: '没有播放内容时',
      type: 'select',
      default: 'placeholder',
      options: [
        { value: 'placeholder', label: '显示占位文字' },
        { value: 'blank', label: '留空' },
      ],
    },
  ],

  cards: [
    {
      id: 'cover',
      name: '封面',
      description: '只有专辑封面，铺满整格',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 2 },
      render: (ctx) => {
        const { state } = ctx
        if (!hasTrack(state) && ctx.settings.idleHide === 'blank') return <Tile />
        return (
          <Tile>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                height: '100%',
                width: '100%',
                minHeight: 0,
              }}
            >
              <div style={{ aspectRatio: '1', height: '100%', maxWidth: '100%', overflow: 'hidden' }}>
                <Cover state={state} radius={0.5} />
              </div>
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'lyrics',
      name: '歌词',
      description: '只显示当前这一行，随播放逐字点亮',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 2 },
      render: ({ state, now }) => {
        if (!hasTrack(state)) return <Idle label="歌词" />
        const lines = parseLyrics(state.lyricsTtml)
        if (lines.length === 0) {
          return (
            <Tile label="歌词" fit>
              <div className="fd-muted" style={{ fontSize: 'clamp(12px, 1.8vmin, 20px)' }}>
                暂无歌词
              </div>
            </Tile>
          )
        }
        const positionMs = livePosition(state, now.getTime()) * 1000
        return (
          <Tile label="歌词" foot={state.title}>
            <div style={{ width: '100%', height: '100%', minHeight: 0 }}>
              <LyricsView lines={lines} positionMs={positionMs} playing={state.playing} />
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'controls',
      name: '播放控制',
      description: '曲名 + 上一首/播放/下一首 + 进度条',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: (ctx) => {
        if (!hasTrack(ctx.state)) return <Idle label="播放控制" />
        const { span } = ctx
        // 一行高的格子（小屏上就七八十像素）挤不下「顶栏 + 曲名 + 控制」三层，
        // 顶栏那句「正在播放」是三者里信息量最小的——播放键的图标已经说明了状态，
        // 所以矮的时候把它收掉，把高度让给下面两层。
        const short = span.rows < 2
        // 一列宽时控制键和进度条并排会互相挤，索性让它换行；
        // 进度条两端的时间读数也一并收起来，免得和控制键叠在一起。
        const narrow = span.cols < 2
        return (
          <Tile label={short ? undefined : <NowPlayingLabel state={ctx.state} />}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 'clamp(4px, 1vmin, 14px)',
                height: '100%',
                minWidth: 0,
              }}
            >
              <TrackTitle state={ctx.state} size={2.2} showArtist={!narrow} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  // 挤不下换行时，独占一行的控制键要居中；
                  // 不换行时进度条会把剩余宽度吃满，这里就不起作用
                  justifyContent: 'center',
                  gap: 'clamp(6px, 1.4vmin, 22px)',
                }}
              >
                <Controls {...ctx} compact />
                {/* 剩余宽度不到 140px 就自己换到下一行去 */}
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <Progress {...ctx} showTimes={!narrow} />
                </div>
              </div>
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'cover-controls',
      name: '封面 + 控制',
      description: '左封面右控制，适合放在一条横向格子里',
      size: { minCols: 2, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: (ctx) => {
        if (!hasTrack(ctx.state)) return <Idle label="正在播放" />
        return (
          <Tile label={<NowPlayingLabel state={ctx.state} />}>
            <div style={{ display: 'flex', gap: 'clamp(14px, 2.4vmin, 32px)', height: '100%', minHeight: 0 }}>
              <div style={{ flexShrink: 0, aspectRatio: '1', height: '100%', overflow: 'hidden' }}>
                <Cover state={ctx.state} />
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: '1 1 auto',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minWidth: 0,
                }}
              >
                <TrackTitle state={ctx.state} />
                <Controls {...ctx} />
                <Progress {...ctx} />
              </div>
            </div>
          </Tile>
        )
      },
    },

    {
      id: 'full',
      name: '完整播放器',
      description: '封面 + 曲名 + 当前歌词 + 控制 + 进度，一格搞定',
      size: { minCols: 2, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: (ctx) => {
        const { state, now, settings } = ctx
        if (!hasTrack(state)) return <Idle label="正在播放" />
        const position = livePosition(state, now.getTime())
        // 完整播放器那格只放一行纯文本，取正在唱的主歌行（背景和声不占这一行）
        const lines = parseLyrics(state.lyricsTtml)
        const line = stageLines(lines, position * 1000).find(
          (item) => item.phase === 'singing' && !item.line.isBG,
        )?.line
        return (
          <Tile label={<NowPlayingLabel state={state} />}>
            <div style={{ display: 'flex', gap: 'clamp(14px, 2.4vmin, 32px)', height: '100%', minHeight: 0 }}>
              <div
                style={{
                  flexShrink: 0,
                  aspectRatio: '1',
                  height: '100%',
                  maxWidth: '34%',
                  overflow: 'hidden',
                  borderRadius: 'calc(var(--fd-radius) * 0.6)',
                }}
              >
                <Cover state={state} />
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: '1 1 auto',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 'clamp(8px, 1.4vmin, 18px)',
                  minWidth: 0,
                }}
              >
                <TrackTitle state={state} />
                {settings.showLyrics !== false && line && (
                  <div
                    className="fd-heading fd-accent"
                    style={{ fontSize: 'clamp(14px, 2.2vmin, 28px)', ...ellipsis }}
                  >
                    {lineText(line)}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.4vmin, 18px)' }}>
                  <Controls {...ctx} />
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <Progress {...ctx} />
                  </div>
                </div>
              </div>
            </div>
          </Tile>
        )
      },
    },
  ],

  triggers: [
    {
      id: 'playing',
      name: '在音乐播放时',
      description: '暂停后会再多留一会儿再退；停止或播放器断开则立刻退出',
      params: [
        {
          key: 'graceSeconds',
          label: '暂停后仍停留',
          type: 'number',
          default: 5,
          min: 0,
          max: 120,
          step: 1,
          unit: '秒',
          help: '只对「暂停」生效。停止与断开连接一律立刻退出，不受这里影响',
        },
      ],
      evaluate: ({ state, params, now }) => {
        if (!state.title) return false
        if (state.playing) return true
        // 暂停宽限：切歌、缓冲这类短暂的 playing=false 不该让布局来回抖。
        // 停止与断开连接不打 pausedAt，所以走不到这一步，当场就退。
        const grace = Number(params.graceSeconds ?? 5) * 1000
        return grace > 0 && state.pausedAt > 0 && now.getTime() - state.pausedAt < grace
      },
    },
    {
      id: 'has-track',
      name: '有曲目时（含暂停）',
      evaluate: ({ state }) => Boolean(state.title),
    },
    {
      id: 'song-start',
      name: '在换歌后的一小段时间内',
      description: '用来做「刚切歌时短暂放大封面」这种效果',
      params: [
        { key: 'seconds', label: '持续', type: 'number', default: 20, min: 5, max: 120, step: 5, unit: '秒' },
      ],
      evaluate: ({ state, params, now }) =>
        state.playing && livePosition(state, now.getTime()) < Number(params.seconds),
    },
  ],
})
