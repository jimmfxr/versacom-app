'use client'

import { useState } from 'react'

export type FilterOption = {
  value: string
  label: string
}

type Props = {
  options: ReadonlyArray<FilterOption>
  selected: string | null
  onSelect: (value: string | null) => void
  /** Label for the catch-all "All" chip (default: "All"). */
  allLabel?: string
  /** How many chips to show before collapsing into "+N more" on mobile. */
  visibleMobile?: number
  /** How many chips to show before collapsing into "+N more" on desktop. */
  visibleDesktop?: number
}

/**
 * Square-cornered chip row used as a filter underneath a search bar.
 * Style matches the rest of the app's button language (rounded-md, not pill).
 */
export function FilterBar({
  options,
  selected,
  onSelect,
  allLabel = 'All',
  visibleMobile = 4,
  visibleDesktop = 8,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  if (options.length === 0) return null

  const overflowMobile = options.length > visibleMobile
  const overflowDesktop = options.length > visibleDesktop

  const renderRow = (visible: number, overflow: boolean) => (
    <>
      <Chip active={selected === null} onClick={() => onSelect(null)}>
        {allLabel}
      </Chip>
      {(expanded ? options : options.slice(0, visible)).map((opt) => (
        <Chip
          key={opt.value}
          active={selected === opt.value}
          onClick={() => onSelect(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-white/[0.10] bg-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-[#313131]"
        >
          {expanded ? 'Show less' : `+${options.length - visible} more`}
        </button>
      )}
    </>
  )

  return (
    <div className="pb-3">
      <div className="flex flex-wrap gap-2 sm:hidden">{renderRow(visibleMobile, overflowMobile)}</div>
      <div className="hidden flex-wrap gap-2 sm:flex">{renderRow(visibleDesktop, overflowDesktop)}</div>
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-[#0178a3] text-white'
          : 'border border-white/[0.10] bg-[#2a2a2a] text-gray-300 hover:bg-[#313131]'
      }`}
    >
      {children}
    </button>
  )
}
