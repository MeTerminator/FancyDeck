import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * 根据容器的真实宽高，把内容整体放到尽可能大。
 * 宽度会随候选倍率反算，因此换行也会参与是否放得下的判断。
 */
export function AutoFit({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const content = contentRef.current
    if (!frame || !content) return

    let animationFrame = 0
    const fit = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
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
      })
    }

    const resizeObserver = new ResizeObserver(fit)
    const mutationObserver = new MutationObserver(fit)
    resizeObserver.observe(frame)
    mutationObserver.observe(content, { childList: true, characterData: true, subtree: true })
    fit()

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  return (
    <div className="fd-autofit" ref={frameRef}>
      <div className="fd-autofit__content" ref={contentRef}>
        {children}
      </div>
    </div>
  )
}
