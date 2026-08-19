import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { lineText, stageLines, type LyricLine } from './lyrics'

/**
 * 歌词显示。解析用 AMLL 的 parseTTML，渲染用它的 <LyricPlayer>。
 *
 * 这一层只做三件外围的事，播放器本身的行为一概不拦：
 *
 *   1. 懒加载——AMLL 压缩后一百多 KB，没摆歌词卡片就不下载
 *   2. 量格子定字号——它默认按视口算字号（5vh/2.5vw），和这块格子有多大无关，
 *      摆件上格子往往只占屏幕一小块，得按实际尺寸把字放到尽可能大
 *   3. 兜底——它加载中、或在无头环境里起不来时，退回纯文本，歌词照样看得见
 */

const LyricsPlayerImpl = lazy(() => import('./LyricsPlayerImpl'))

export function LyricsView({
  lines,
  positionMs,
  playing,
}: {
  lines: LyricLine[]
  positionMs: number
  playing: boolean
}) {
  const [broken, setBroken] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * 字号按**一行能放下几个字**来定，而不是照搬时钟那条式子。
   *
   * 时钟只有四个数字，字号再大也就占一行；歌词是整句，同样的字号会被折成
   * 一行一个词，读起来反而更费劲。所以这里直接从格子尺寸倒推：
   *
   *   宽 / 9     一行大约九个汉字，长句折两行也还看得出是一句话
   *   高 / 3.5   当前这行之外留得下下一行
   *
   * 这两个数就是这块卡片的观感旋钮，嫌小改大、嫌大改小，别的都不用动。
   */
  const fontSize = `min(${Math.max(1, size.width / 9)}px, ${Math.max(1, size.height / 3.5)}px, 300px)`
  const ready = size.width > 0 && size.height > 0

  // 兜底文案：把此刻正在唱的几行拼出来，AMLL 不可用时至少还是歌词
  const plain = (
    <PlainLines texts={stageLines(lines, positionMs).map((item) => lineText(item.line))} />
  )

  return (
    <div
      ref={box}
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}
    >
      {ready && !broken ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            ['--amll-lp-font-size' as string]: fontSize,
          }}
        >
          <Fence onBroken={() => setBroken(true)} fallback={plain}>
            <Suspense fallback={plain}>
              <LyricsPlayerImpl lines={lines} positionMs={positionMs} playing={playing} />
            </Suspense>
          </Fence>
        </div>
      ) : (
        plain
      )}
    </div>
  )
}

/** 纯文本歌词，AMLL 还没到位或起不来时顶上 */
function PlainLines({ texts }: { texts: string[] }) {
  return (
    <div
      className="fd-heading"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.3em',
        width: '100%',
        height: '100%',
        textAlign: 'center',
        overflow: 'hidden',
      }}
    >
      {texts.map((text, i) => (
        <div key={i}>{text}</div>
      ))}
    </div>
  )
}

/**
 * AMLL 直接操作 DOM，某些环境（无头浏览器、尺寸为 0 的容器）会在渲染期抛错。
 * 它塌了不该把整块屏幕带走，所以圈一道错误边界。
 */
class Fence extends Component<
  { children: ReactNode; fallback: ReactNode; onBroken: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[media] 歌词组件渲染失败，退回纯文本：', error)
    this.props.onBroken()
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
