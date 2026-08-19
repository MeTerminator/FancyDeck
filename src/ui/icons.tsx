type IconProps = { size?: number | string; color?: string; strokeWidth?: number }

const base = (size: number | string) => ({
  style: { width: size, height: size, flexShrink: 0 },
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function SunIcon({ size = 24, color, strokeWidth = 1.2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7M18.6 18.6l-1.7-1.7M7.1 7.1L5.4 5.4" />
    </svg>
  )
}

export function DropletIcon({ size = 24, color, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}>
      <path d="M12 3.4c3.4 4 5.4 6.8 5.4 9.4a5.4 5.4 0 11-10.8 0c0-2.6 2-5.4 5.4-9.4z" />
    </svg>
  )
}

export function BulbIcon({ size = 24, color, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}>
      <path d="M9.2 17.4h5.6M10 20.6h4" />
      <path d="M12 3.2a6 6 0 00-3.6 10.8v3.4h7.2V14A6 6 0 0012 3.2z" />
    </svg>
  )
}

export function CalendarIcon({ size = 24, color, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}>
      <rect x="3.4" y="5" width="17.2" height="15.6" />
      <path d="M3.4 9.8h17.2M8.4 3v4M15.6 3v4" />
    </svg>
  )
}

export function PrevIcon({ size = 24, color }: IconProps) {
  return (
    <svg
      style={{ width: size, height: size, flexShrink: 0 }}
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
    >
      <path d="M20 5.5v13L10 12z" />
      <rect x="5" y="5.5" width="2.4" height="13" />
    </svg>
  )
}

export function NextIcon({ size = 24, color }: IconProps) {
  return (
    <svg
      style={{ width: size, height: size, flexShrink: 0 }}
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
    >
      <path d="M4 5.5v13L14 12z" />
      <rect x="16.6" y="5.5" width="2.4" height="13" />
    </svg>
  )
}

export function PlayIcon({ size = 24, color }: IconProps) {
  return (
    <svg
      style={{ width: size, height: size, flexShrink: 0 }}
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
    >
      <path d="M7 4.5v15L20 12z" />
    </svg>
  )
}

export function PauseIcon({ size = 24, color }: IconProps) {
  return (
    <svg
      style={{ width: size, height: size, flexShrink: 0 }}
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
    >
      <rect x="6.5" y="4.5" width="3.6" height="15" />
      <rect x="14" y="4.5" width="3.6" height="15" />
    </svg>
  )
}

/** 没有真实封面时的占位画面，跟随主题点缀色 */
export function AlbumCover({ accent, cell }: { accent: string; cell: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <rect x="0" y="0" width="200" height="200" fill={cell} />
      <circle cx="100" cy="82" r="42" fill={accent} />
      <g stroke={cell} strokeWidth="2.6">
        <path d="M58 68h84M58 80h84M58 92h84" />
      </g>
      <path d="M0 118h200" stroke={accent} strokeWidth="1" opacity="0.45" />
      <path d="M76 200L96 120M124 200L104 120" stroke={accent} strokeWidth="1.6" opacity="0.75" />
    </svg>
  )
}

export function SnowflakeIcon({ size = 24, color, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}>
      <path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4L4 16.6" />
      <path d="M12 6.4l2.2-2.2M12 6.4L9.8 4.2M12 17.6l2.2 2.2M12 17.6l-2.2 2.2" />
    </svg>
  )
}
