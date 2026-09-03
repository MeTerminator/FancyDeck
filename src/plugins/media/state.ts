/** 媒体插件的数据形状。服务端与前端共用这一份，避免两头各写一遍。 */

export type MediaState = {
  playing: boolean
  title: string
  artist: string
  album: string
  year: number | null
  durationSec: number
  positionSec: number
  /** positionSec 是哪一刻的读数（epoch ms）；展示页据此在本地把进度补齐 */
  positionAt: number
  /** 封面图 URL，可以是 data: */
  artwork: string | null
  /**
   * 歌词，LRC 原文（行级时间轴）。空串表示这首歌没有歌词。
   * 同时间戳的第一条是正文、第二条是可选翻译；服务端只负责搬运。
   */
  lyricsLrc: string
  /** 来源应用，例如 Music / Spotify */
  app: string | null
  /**
   * 最近一次从「在播」变成「不在播」的时刻（epoch ms），0 表示没暂停过。
   * 布局用它做暂停宽限：按了暂停不该立刻跳走，缓一会儿再退出。
   */
  pausedAt: number
  /** 最近一次上报时间；0 表示还没接到真实数据 */
  updatedAt: number
}

export const emptyMedia: MediaState = {
  playing: false,
  title: '',
  artist: '',
  album: '',
  year: null,
  durationSec: 0,
  positionSec: 0,
  positionAt: 0,
  artwork: null,
  lyricsLrc: '',
  app: null,
  pausedAt: 0,
  updatedAt: 0,
}

/** 上报的是某一刻的读数，屏幕上要连续走字，所以本地补上流逝的时间 */
export function livePosition(state: MediaState, now: number): number {
  if (!state.playing || !state.positionAt) return state.positionSec
  // 新状态可能恰好到在页面时钟两次 tick 之间；此时 now 会短暂早于
  // positionAt。不能用负的流逝时间把刚收到的进度倒推回上一句歌词。
  const elapsedMs = Math.max(0, now - state.positionAt)
  const drifted = state.positionSec + elapsedMs / 1000
  return state.durationSec > 0 ? Math.min(state.durationSec, drifted) : drifted
}
