import type { CSSProperties, ReactNode } from 'react'
import { AutoFit } from './AutoFit'

export type TileProps = {
  /** 左上角的格位标签 */
  label?: ReactNode
  /** 底部一行补充信息 */
  foot?: ReactNode
  /** 高亮态（提醒、设备已开启等） */
  active?: boolean
  /** 给出时整个格子可点击 */
  onClick?: () => void
  style?: CSSProperties
  /** 文字型卡片按实际可用空间整体放大，并在溢出前自动收缩 */
  fit?: boolean
  children?: ReactNode
}

/**
 * 所有格子的外壳：只负责底色、圆角、内边距与「标签 / 内容 / 脚注」三段结构。
 * 具体格子只关心自己的内容。
 */
export function Tile({ label, foot, active, onClick, style, fit = false, children }: TileProps) {
  const className = ['fd-tile', active ? 'fd-tile--active' : '', onClick ? 'fd-tile--button' : '']
    .filter(Boolean)
    .join(' ')

  const sections = (
    <>
      {label !== undefined && <div className="fd-tile__label">{label}</div>}
      <div className="fd-tile__body">{children}</div>
      {foot !== undefined && <div className="fd-tile__foot">{foot}</div>}
    </>
  )
  const content = fit ? <AutoFit><div className="fd-tile__fit">{sections}</div></AutoFit> : sections

  if (onClick) {
    return (
      <button type="button" className={className} style={style} onClick={onClick}>
        {content}
      </button>
    )
  }

  return (
    <div className={className} style={style}>
      {content}
    </div>
  )
}
