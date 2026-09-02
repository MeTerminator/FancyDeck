import { useEffect, useState } from 'react'
import { AutoFit } from '../../ui/AutoFit'
import { activeLyric, type LyricLine } from './lyrics'

/** 行级 LRC 卡片：任意时刻只渲染一条正文及其可选同步翻译。 */
export function LyricsView({
  lines,
  positionMs,
  playing,
}: {
  lines: LyricLine[]
  positionMs: number
  playing: boolean
}) {
  const target = useActiveLyric(lines, positionMs, playing)
  const { line, phase } = useFadedLyric(target)

  return (
    <div className="fd-lrc" data-lyric-lines={line ? 1 : 0}>
      {line && (
        <AutoFit>
          <div
            className={`fd-lrc__content fd-lrc__content--${phase}`}
          >
            <div className="fd-lrc__main">{line.text}</div>
            {line.translation && <div className="fd-lrc__translation">{line.translation}</div>}
          </div>
        </AutoFit>
      )}
    </div>
  )
}

const lyricKey = (line: LyricLine | null) => line ? `${line.timeMs}:${line.text}` : ''

/** 旧行先淡出，替换后新行再淡入；过渡期间 DOM 中也始终只有一条主歌词。 */
function useFadedLyric(target: LyricLine | null) {
  const [line, setLine] = useState(target)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const targetKey = lyricKey(target)
  const lineKey = lyricKey(line)

  useEffect(() => {
    if (targetKey === lineKey) return
    if (!line) {
      setLine(target)
      setPhase('in')
      return
    }

    setPhase('out')
    const timer = window.setTimeout(() => {
      setLine(target)
      setPhase('in')
    }, 160)
    return () => window.clearTimeout(timer)
  }, [line, lineKey, target, targetKey])

  return { line, phase }
}

/** 只在下一条时间戳到来时唤醒，避免行级歌词在播放期间持续重渲染。 */
function useActiveLyric(lines: LyricLine[], positionMs: number, playing: boolean) {
  const [current, setCurrent] = useState(() => activeLyric(lines, positionMs))

  useEffect(() => {
    const anchoredAt = performance.now()
    let timer = 0

    const refresh = () => {
      const estimated = positionMs + (playing ? performance.now() - anchoredAt : 0)
      setCurrent(activeLyric(lines, estimated))
      if (!playing) return

      const next = lines.find((line) => line.timeMs > estimated)
      if (next) {
        timer = window.setTimeout(refresh, Math.max(16, next.timeMs - estimated + 1))
      }
    }

    refresh()
    return () => window.clearTimeout(timer)
  }, [lines, playing, positionMs])

  return current
}
