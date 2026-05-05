'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Horizontally scrollable chip row with prev/next chevrons that appear
 * only when the chips overflow the container width. Same UX as the
 * browse-mode user switcher in panel-studio. Used by FilterBar and the
 * project-detail tab strip so filter chips never wrap or hide behind a
 * "+N more" button.
 */
export function ChipScroller({
  children,
  containerClassName = 'flex flex-1 gap-2 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  ariaLabel = 'filters',
}: {
  children: React.ReactNode
  /** Override classes on the inner scroll container (e.g. to add bg/padding). */
  containerClassName?: string
  /** Used in chevron aria-labels — "Scroll {ariaLabel} left/right". */
  ariaLabel?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canL, setCanL] = useState(false)
  const [canR, setCanR] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function update() {
      const node = scrollRef.current
      if (!node) return
      setCanL(node.scrollLeft > 0)
      // -1 absorbs sub-pixel rounding so we don't flash a chevron when
      // we're effectively at the end.
      setCanR(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [children])

  function nudge(dx: number) {
    scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' })
  }

  const showChevrons = canL || canR

  return (
    <div className="flex items-center gap-1">
      {showChevrons && (
        <button
          type="button"
          onClick={() => nudge(-200)}
          disabled={!canL}
          aria-label={`Scroll ${ariaLabel} left`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/[0.10] bg-[#2a2a2a] text-gray-300 transition-colors hover:bg-[#313131] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      )}
      <div ref={scrollRef} className={containerClassName}>
        {children}
      </div>
      {showChevrons && (
        <button
          type="button"
          onClick={() => nudge(200)}
          disabled={!canR}
          aria-label={`Scroll ${ariaLabel} right`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/[0.10] bg-[#2a2a2a] text-gray-300 transition-colors hover:bg-[#313131] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      )}
    </div>
  )
}
