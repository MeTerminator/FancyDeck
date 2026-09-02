/** 一条行级 LRC 歌词；同时间戳的第二条文本作为可选翻译。 */
export type LyricLine = {
  timeMs: number
  text: string
  translation?: string
}

type RawLine = {
  timeMs: number
  text: string
  order: number
}

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const OFFSET = /^\s*\[offset:([+-]?\d+)\]\s*$/im

let cache: { lrc: string; lines: LyricLine[] } | null = null

const fractionMs = (value = '') => Number(value.padEnd(3, '0').slice(0, 3))

/**
 * 解析标准 LRC。支持一行多个时间戳、毫秒 offset，以及常见的同步翻译写法：
 * 同一时间戳第一条是原文，紧随其后的第二条是翻译。
 */
export function parseLyrics(lrc: string): LyricLine[] {
  if (!lrc.trim()) return []
  if (cache?.lrc === lrc) return cache.lines

  const offset = Number(lrc.match(OFFSET)?.[1] ?? 0)
  const raw: RawLine[] = []
  let order = 0

  for (const sourceLine of lrc.split(/\r?\n/)) {
    const matches = [...sourceLine.matchAll(TIMESTAMP)]
    if (matches.length === 0) continue

    const text = sourceLine.replace(TIMESTAMP, '').trim()
    if (!text) continue

    for (const match of matches) {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) continue
      raw.push({
        timeMs: Math.max(0, minutes * 60_000 + seconds * 1000 + fractionMs(match[3]) + offset),
        text,
        order: order++,
      })
    }
  }

  raw.sort((a, b) => a.timeMs - b.timeMs || a.order - b.order)

  const lines: LyricLine[] = []
  for (const item of raw) {
    const previous = lines.at(-1)
    if (previous?.timeMs === item.timeMs) {
      if (!previous.translation && item.text !== previous.text) previous.translation = item.text
      continue
    }
    lines.push({ timeMs: item.timeMs, text: item.text })
  }

  cache = { lrc, lines }
  return lines
}

/** 当前时间只返回一个歌词条目；第一行开始前不提前显示。 */
export function activeLyric(lines: LyricLine[], timeMs: number): LyricLine | null {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (lines[middle].timeMs <= timeMs) low = middle + 1
    else high = middle
  }
  return low > 0 ? lines[low - 1] : null
}
