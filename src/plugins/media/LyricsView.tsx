import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AutoFit } from '../../ui/AutoFit'
import { activeLyric, type LyricLine } from './lyrics'

const CROSSFADE_MS = 280

type LyricTransition = {
  current: LyricLine | null
  previous: LyricLine | null
  sequence: number
  source: LyricLine[]
}

const sameLine = (left: LyricLine | null, right: LyricLine | null) =>
  left?.timeMs === right?.timeMs &&
  left?.text === right?.text &&
  left?.translation === right?.translation

/** 行级 LRC 卡片：常态只显示当前一句，切换时让新旧两句短暂交叉渐变。 */
export function LyricsView({
  lines,
  positionMs,
  playing,
  title,
  artist,
}: {
  lines: LyricLine[]
  positionMs: number
  playing: boolean
  title: string
  artist: string
}) {
  const activeLine = useActiveLyric(lines, positionMs, playing)
  const introLine = useMemo<LyricLine>(() => ({
    timeMs: -1,
    text: title,
    translation: artist || undefined,
  }), [artist, title])
  const line = activeLine ?? introLine
  const [transition, setTransition] = useState<LyricTransition>(() => ({
    current: line,
    previous: null,
    sequence: 0,
    source: lines,
  }))

  // 同一次提交里挂上新旧两层，确保淡出与淡入从同一帧开始。
  useLayoutEffect(() => {
    setTransition((existing) => {
      // 整份 LRC 已更换时直接替换，不能让上一首歌的歌词参与交叉渐变。
      if (existing.source !== lines) {
        return {
          current: line,
          previous: null,
          sequence: existing.sequence + 1,
          source: lines,
        }
      }
      if (sameLine(existing.current, line)) return existing
      return {
        current: line,
        previous: existing.current,
        sequence: existing.sequence + 1,
        source: lines,
      }
    })
  }, [line, lines])

  useEffect(() => {
    if (!transition.previous) return
    const sequence = transition.sequence
    const timer = window.setTimeout(() => {
      setTransition((existing) =>
        existing.sequence === sequence ? { ...existing, previous: null } : existing,
      )
    }, CROSSFADE_MS)
    return () => window.clearTimeout(timer)
  }, [transition.previous, transition.sequence])

  const crossfading = Boolean(transition.previous)

  return (
    <div className="fd-lrc" data-lyric-lines={transition.current ? 1 : 0} aria-live="polite">
      {transition.previous && (
        <LyricLayer
          key={`previous-${transition.sequence}`}
          line={transition.previous}
          phase="leaving"
        />
      )}
      {transition.current && (
        <LyricLayer
          key={`current-${transition.sequence}`}
          line={transition.current}
          phase={crossfading ? 'entering' : 'current'}
        />
      )}
    </div>
  )
}

function LyricLayer({ line, phase }: { line: LyricLine; phase: 'current' | 'entering' | 'leaving' }) {
  const leaving = phase === 'leaving'
  return (
    <div
      className={`fd-lrc__layer fd-lrc__layer--${phase}`}
      data-lyric-phase={phase}
      aria-hidden={leaving || undefined}
    >
      <AutoFit contentKey={`${line.timeMs}:${line.text}:${line.translation ?? ''}`}>
        <div className="fd-lrc__content">
          <div className="fd-lrc__main">{line.text}</div>
          {line.translation && <div className="fd-lrc__translation">{line.translation}</div>}
        </div>
      </AutoFit>
    </div>
  )
}

/** 只在下一条时间戳到来时唤醒，避免行级歌词在播放期间持续重渲染。 */
function useActiveLyric(lines: LyricLine[], positionMs: number, playing: boolean) {
  const [snapshot, setSnapshot] = useState(() => ({
    lines,
    current: activeLyric(lines, positionMs),
  }))
  // 新 LRC 到达的这一帧就使用新时间轴，不能等 effect 后才丢掉旧歌词。
  const current = snapshot.lines === lines ? snapshot.current : activeLyric(lines, positionMs)

  // 在浏览器绘制前同步进度跳变，避免旧歌词短暂闪现一帧。
  useLayoutEffect(() => {
    const anchoredAt = performance.now()
    let timer = 0

    const refresh = () => {
      const estimated = positionMs + (playing ? performance.now() - anchoredAt : 0)
      setSnapshot({ lines, current: activeLyric(lines, estimated) })
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
