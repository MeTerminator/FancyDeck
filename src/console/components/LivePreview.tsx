import { Maximize2, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { cn } from '../lib/utils'

/**
 * 实时预览。直接内嵌真正的展示页，而不是在后台里重画一遍——
 * 这样预览里看到的一定就是屏幕上的样子，不会两边实现出现偏差。
 * 展示页自己连着同一条 WebSocket，所以配置一改这里立刻跟着变。
 */
export function LivePreview({
  orientation = 'landscape',
  className,
}: {
  orientation?: 'landscape' | 'portrait'
  className?: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [nonce, setNonce] = useState(0)
  const [scale, setScale] = useState(1)
  const wrapRef = useRef<HTMLDivElement>(null)

  const base = orientation === 'portrait' ? { w: 720, h: 1280 } : { w: 1280, h: 720 }

  // iframe 里的 vmin / clamp 依赖真实像素尺寸，所以按整屏尺寸渲染再缩放，
  // 而不是直接把 iframe 做小——否则字号会失真。
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setScale(el.clientWidth / base.w))
    observer.observe(el)
    return () => observer.disconnect()
  }, [base.w])

  return (
    <div className={cn('grid gap-2', className)}>
      <div
        ref={wrapRef}
        className="bg-muted relative overflow-hidden rounded-xl border"
        style={{ aspectRatio: `${base.w} / ${base.h}` }}
      >
        <iframe
          ref={frameRef}
          key={nonce}
          src="/"
          title="展示页实时预览"
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{ width: base.w, height: base.h, transform: `scale(${scale})` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setNonce((n) => n + 1)}>
          <RotateCcw /> 重载预览
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="/" target="_blank" rel="noreferrer">
            <Maximize2 /> 全屏打开
          </a>
        </Button>
      </div>
    </div>
  )
}
