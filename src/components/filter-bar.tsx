'use client'

import { ChipScroller } from '@/components/chip-scroller'

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
  /**
   * Legacy props kept for compatibility with existing callers — the
   * scroll-with-chevrons UX no longer needs a "+N more" cutoff so these
   * have no effect. Safe to remove from callers when convenient.
   */
  visibleMobile?: number
  visibleDesktop?: number
}

/**
 * Single horizontally-scrollable row of filter chips with prev/next
 * chevrons that appear when chips overflow the container. Replaces the
 * older "+N more" pattern so behavior matches the project-detail tabs.
 */
export function FilterBar({
  options,
  selected,
  onSelect,
  allLabel = 'All',
}: Props) {
  if (options.length === 0) return null

  return (
    <div className="pb-3">
      <ChipScroller>
        <Chip active={selected === null} onClick={() => onSelect(null)}>
          {allLabel}
        </Chip>
        {options.map((opt) => (
          <Chip
            key={opt.value}
            active={selected === opt.value}
            onClick={() => onSelect(opt.value)}
          >
            {opt.label}
          </Chip>
        ))}
      </ChipScroller>
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
