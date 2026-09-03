import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * 根据容器的真实宽高，把内容整体放到尽可能大。
 * 宽度会随候选倍率反算，因此换行也会参与是否放得下的判断。
 */
export function AutoFit({
  children,
  contentKey,
}: {
  children: ReactNode
  /** 内容发生离散切换时传入；新内容会在浏览器绘制前完成一次同步适配。 */
  contentKey?: string | number
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const fitNowRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const frame = frameRef.current
    const content = contentRef.current
    if (!frame || !content) return

    let animationFrame = 0
    const fitNow = () => {
      const availableWidth = frame.clientWidth
      const availableHeight = frame.clientHeight
      if (availableWidth <= 0 || availableHeight <= 0) return

      let low = 0.25
      let high = 8
      for (let index = 0; index < 14; index += 1) {
        const candidate = (low + high) / 2
        content.style.width = `${availableWidth / candidate}px`
        const fits =
          content.scrollWidth * candidate <= availableWidth + 0.5 &&
          content.scrollHeight * candidate <= availableHeight + 0.5
        if (fits) low = candidate
        else high = candidate
      }

      // 给字体像素取整留一点余量，避免刚好贴边时出现裁切或叠字。
      const fitted = Math.max(0.25, low * 0.985)
      content.style.width = `${availableWidth / fitted}px`
      content.style.transform = `translateY(-50%) scale(${fitted})`
    }
    fitNowRef.current = fitNow

    const scheduleFit = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(fitNow)
    }

    const resizeObserver = new ResizeObserver(scheduleFit)
    const mutationObserver = new MutationObserver(scheduleFit)
    resizeObserver.observe(frame)
    mutationObserver.observe(content, { childList: true, characterData: true, subtree: true })
    fitNow()

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      fitNowRef.current = () => {}
    }
  }, [])

  useLayoutEffect(() => {
    fitNowRef.current()
  }, [contentKey])

  return (
    <div className="fd-autofit" ref={frameRef}>
      <div className="fd-autofit__content" ref={contentRef}>
        {children}
      </div>
    </div>
  )
}
