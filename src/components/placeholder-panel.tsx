import { useId } from 'react'

export type PlaceholderPanelProps = {
  readonly height?: string
}

export function PlaceholderPanel({ height = 'h-96' }: PlaceholderPanelProps) {
  const patternId = useId()

  return (
    <div
      className={`relative ${height} overflow-hidden rounded-xl border border-dashed border-white/20 opacity-75`}
    >
      <svg fill="none" className="absolute inset-0 size-full stroke-white/10">
        <defs>
          <pattern
            id={patternId}
            width="10"
            height="10"
            x="0"
            y="0"
            patternUnits="userSpaceOnUse"
          >
            <path d="M-3 13 15-5M-5 5l18-18M-1 21 17 3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} stroke="none" />
      </svg>
    </div>
  )
}
