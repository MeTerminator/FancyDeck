import { LyricPlayer } from '@applemusic-like-lyrics/react'
import '@applemusic-like-lyrics/core/style.css'
import type { LyricLine } from './lyrics'

/**
 * AMLL 播放器本体。单独一个文件是为了让它能被拆成独立 chunk——
 * 这一坨压缩后一百多 KB，只有真的摆了歌词卡片才值得下载。
 * 外面的 LyricsView 用 React.lazy 引它。
 *
 * 这里把**整首歌词**都交给它，由它自己按 currentTime 决定显示哪些行。
 * 并行的对唱、背景和声、进退场的上浮与模糊，都是它本来就会做的事，
 * 自己拦着只喂一行反而把这些全关掉了。
 */
export default function LyricsPlayerImpl({
  lines,
  positionMs,
  playing,
}: {
  lines: LyricLine[]
  positionMs: number
  playing: boolean
}) {
  return (
    <LyricPlayer
      lyricLines={lines}
      currentTime={Math.max(0, Math.round(positionMs))}
      playing={playing}
      alignAnchor="center"
      alignPosition={0.5}
      // 唱过的行收起来，格子里只留正在唱的那几行
      hidePassedLines
      enableSpring
      enableBlur
      enableScale
      style={{
        width: '100%',
        height: '100%',
        // 歌词是这块卡片的主角，跟标题一样上 Bold
        fontWeight: 700,
        // AMLL 默认按 Apple Music 的深色背景配色，这里跟着摆件主题走
        ['--amll-lp-color' as string]: 'var(--fd-text-primary)',
        // 它默认用 plus-lighter 混合，压在摆件的格子底色上会发灰
        mixBlendMode: 'normal',
      }}
    />
  )
}
