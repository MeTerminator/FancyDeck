import { definePlugin } from '../../core/plugin'
import { useTheme } from '../../theme/ThemeProvider'
import { AlbumCover } from '../../ui/icons'
import { Tile } from '../../ui/Tile'
import { Marquee } from '../../ui/Marquee'
import { emptyMedia, livePosition, type MediaState } from './state'
import { parseLyrics } from './lyrics'
import { LyricsView } from './LyricsView'

/**
 * 媒体插件。这是「一个插件提供多张卡片」的样板：
 * 封面、歌词、歌曲信息各是一张只读卡片。
 *
 * 所有卡片读同一份 state，所以拆开摆和合起来摆完全同步。
 */

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

export default definePlugin<MediaState>({
  id: 'media',
  name: '媒体展示',
  description: '正在播放的歌曲：封面、歌词与歌曲信息，只展示不控制。',
  icon: 'Music',
  defaultState: emptyMedia,

  routes: [
    { method: 'POST', path: '/api/p/media/now-playing', description: '上报当前曲目与播放状态' },
    { method: 'POST', path: '/api/p/media/lyrics', description: '上报歌词（LRC 原文）' },
    { method: 'POST', path: '/api/p/media/stopped', description: '标记为已停止' },
    { method: 'GET', path: '/api/p/media/state', description: '读当前状态' },
    {
      method: 'WS',
      path: '/ws/p/media',
      description: '长连接上报：连上发 play 即开始，发 stop 或断开即停止',
    },
  ],

  settings: [
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
      description: '只显示一条当前 LRC 歌词及其可选翻译',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 2 },
      render: ({ state, now }) => {
        if (!hasTrack(state)) return <Idle label="歌词" />
        const lines = parseLyrics(state.lyricsLrc)
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
      id: 'info',
      name: '歌曲信息',
      description: '曲名与歌手两行展示，超出时自动滚动',
      size: { minCols: 1, minRows: 1, defaultCols: 2, defaultRows: 1 },
      render: ({ state }) => {
        if (!hasTrack(state)) return <Idle label="歌曲信息" />
        return (
          <Tile fit>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 'clamp(6px, 1vmin, 14px)',
                height: '100%',
                minWidth: 0,
              }}
            >
              <Marquee className="fd-heading" style={{ fontSize: 'clamp(16px, 2.2vmin, 34px)' }}>
                {state.title}
              </Marquee>
              <Marquee className="fd-secondary" style={{ fontSize: 'clamp(13px, 1.8vmin, 24px)' }}>
                {state.artist}
              </Marquee>
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
