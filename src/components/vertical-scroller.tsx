'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Vertically scrollable region with up/down chevrons stacked on the
 * right edge that fade in only when the content overflows. Vertical
 * sibling of `ChipScroller` — same chevron styling, same disabled-when-
 * at-extreme behaviour, so it visually matches across the app.
 *
 * Use it any time a fixed-height column might hide rows below the fold
 * and you want a clearer cue than a thin browser scrollbar.
 */
export function VerticalScroller({
  children,
  className = '',
  scrollClassName = 'h-full overflow-y-auto pr-2',
  ariaLabel = 'list',
}: {
  children: React.ReactNode
  /** Classes on the outer wrapper (positioning context for chevrons). */
  className?: string
  /** Classes on the inner scroll container — defaults to a column with
   *  vertical scroll and a touch of right padding so chips don't sit
   *  underneath the chevron buttons. Override for custom layouts. */
  scrollClassName?: string
  /** Used in chevron aria-labels — "Scroll {ariaLabel} up/down". */
  ariaLabel?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canUp, setCanUp] = useState(false)
  const [canDown, setCanDown] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function update() {
      const node = scrollRef.current
      if (!node) return
      setCanUp(node.scrollTop > 0)
      // -1 absorbs sub-pixel rounding so we don't flash a chevron when
      // we're effectively at the bottom.
      setCanDown(node.scrollTop + node.clientHeight < node.scrollHeight - 1)
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

  function nudge(dy: number) {
    scrollRef.current?.scrollBy({ top: dy, behavior: 'smooth' })
  }

  const showChevrons = canUp || canDown

  return (
    <div className={`relative ${className}`}>
      <div ref={scrollRef} className={scrollClassName}>
        {children}
      </div>
      {showChevrons && (
        // Chevrons live on top of the scroll area in an absolute
        // overlay. pointer-events-none on the wrapper so the
        // scrollable region can still be wheel-scrolled where the
        // wrapper covers it; pointer-events-auto re-enabled on the
        // buttons themselves so they stay clickable.
        <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-between py-1">
          <button
            type="button"
            onClick={() => nudge(-160)}
            disabled={!canUp}
            aria-label={`Scroll ${ariaLabel} up`}
            className="pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#2a2a2a]/90 text-gray-300 backdrop-blur transition-colors hover:bg-[#313131] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => nudge(160)}
            disabled={!canDown}
            aria-label={`Scroll ${ariaLabel} down`}
            className="pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#2a2a2a]/90 text-gray-300 backdrop-blur transition-colors hover:bg-[#313131] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
