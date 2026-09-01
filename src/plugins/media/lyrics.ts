import { parseTTML } from '@applemusic-like-lyrics/lyric'
import type { LyricLine } from '@applemusic-like-lyrics/lyric'

/**
 * TTML 歌词的解析与取行。
 *
 * 解析交给 AMLL 的 parseTTML，它连逐字时间轴、背景和声（isBG）、
 * 对唱（isDuet）都给齐了。卡片每帧重绘，而同一首歌的 TTML 一整首都不会变，
 * 所以按原文缓存一份，避免每帧重跑一遍解析。
 */

export type { LyricLine }

let cache: { ttml: string; lines: LyricLine[] } | null = null

/** 解析 TTML。解析不出来时给空数组，不让一段坏歌词把整块屏幕带崩。 */
export function parseLyrics(ttml: string): LyricLine[] {
  if (!ttml) return []
  if (cache?.ttml === ttml) return cache.lines
  let lines: LyricLine[] = []
  try {
    lines = parseTTML(ttml).lines
  } catch (error) {
    console.warn('[media] TTML 解析失败：', error)
  }
  cache = { ttml, lines }
  return lines
}

/** 一行歌词的纯文本，给不需要逐字效果的地方用 */
export const lineText = (line: LyricLine | undefined) =>
  line ? line.words.map((word) => word.word).join('') : ''

// ────────────────────────────────────────────────────────────────────────────
// 当前在唱哪些行
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一行在屏幕上的三个阶段。
 *
 * 歌词卡片本身是交给 AMLL 的 <LyricPlayer> 画的，用不到这个；
 * 这套分镜留给 AMLL 起不来时的纯文本兜底。
 */
export type LinePhase = 'in' | 'singing' | 'out'

export type StagedLine = {
  /** 在完整歌词里的下标，拿来当 React key */
  index: number
  line: LyricLine
  phase: LinePhase
  /** 该阶段走了多少，0–1 */
  progress: number
}

/**
 * 挑出此刻该出现在屏幕上的行。
 *
 * 歌词里同一时刻可能有好几行并行——对唱的两个声部、主歌配着背景和声，
 * 所以这里返回的是**一组**而不是一行，谁在唱就出现谁。
 *
 *     startTime          +enterMs              endTime          +exitMs
 *          │  进场（占位，在格子里上浮） │      在唱          │  退场（离开排版，浮层里飘走）│
 *
 * 全部由时间算出来，不留组件状态：暂停时画面停在该停的地方，
 * 时间跳变时也不会残留上一处的动画。
 */
export function stageLines(
  lines: LyricLine[],
  timeMs: number,
  { enterMs = 380, exitMs = 620 } = {},
): StagedLine[] {
  const staged: StagedLine[] = []
  // 整首扫一遍。行数就几十条，每帧扫一次的开销可以忽略；
  // 不做「排好序就提前 break」那种优化，是因为并行的行本来就可能交错，
  // 顺序一旦不是严格递增，提前收工就会漏掉正在唱的行。
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (timeMs < line.startTime) continue
    if (timeMs >= line.endTime + exitMs) continue

    if (timeMs >= line.endTime) {
      staged.push({ index, line, phase: 'out', progress: (timeMs - line.endTime) / exitMs })
    } else if (timeMs < line.startTime + enterMs) {
      staged.push({ index, line, phase: 'in', progress: (timeMs - line.startTime) / enterMs })
    } else {
      staged.push({ index, line, phase: 'singing', progress: 1 })
    }
  }
  return staged
}

/** 某个词唱到了几成，0–1 */
export function wordProgress(start: number, end: number, timeMs: number): number {
  if (timeMs <= start) return 0
  if (timeMs >= end) return 1
  const span = end - start
  return span > 0 ? (timeMs - start) / span : 1
}
