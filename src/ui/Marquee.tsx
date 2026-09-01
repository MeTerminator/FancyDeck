import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** 一行内容超出容器宽度时才开始无缝滚动。 */
export function Marquee({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null)
  const unit = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const outer = box.current
    const inner = unit.current
    if (!outer || !inner) return
    const measure = () => setOverflow(Math.max(0, inner.offsetWidth - outer.clientWidth))
    measure()
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
