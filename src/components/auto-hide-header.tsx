'use client'

import { useScrollDirection } from '@/lib/use-scroll-direction'

/**
 * Mobile-only auto-hiding wrapper. Same direction-driven pattern as
 * the BottomNav (Instagram / Facebook top bar): scroll-down collapses
 * the wrapped block, scroll-up restores it. Desktop is unaffected
 * (grid-rows-[1fr] stays fixed at the sm: breakpoint).
 *
 * Uses the modern `grid-template-rows: 1fr → 0fr` trick instead of
 * max-height because it doesn't need to know the content size up
 * front — works equally well for the single-row page header and for
 * the multi-row Radios toolbar (search + stats + filters). Inner
 * `overflow-hidden` clips content during the collapse so it doesn't
 * spill out before the row shrinks.
 *
 * Browser support: Chrome 117+, Safari 17.4+, iOS Safari 17.4+ —
 * fine for the iOS/Android PWA audience this app ships to. Older
 * browsers gracefully degrade to instant show/hide (no animation).
 */
export function AutoHideHeader({
  children,
  className = '',
}: {
  children: React.ReactNode
  /** Extra classes appended to the outer wrapper. Useful when the
   *  wrapped block needs edge-bleed via negative margins (e.g. the
   *  Tasks search bar's `-mx-4 sm:-mx-6 lg:-mx-8`) — those classes
   *  must live on the outermost element, not on the inner
   *  `overflow-hidden` clipper. */
  className?: string
}) {
  const direction = useScrollDirection()
  const hidden = direction === 'down'
  return (
    <div
      className={`grid flex-shrink-0 transition-[grid-template-rows,opacity] duration-300 sm:grid-rows-[1fr] sm:opacity-100 ${
        hidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      } ${className}`}
      // Material-style "standard" easing — smoother than tailwind's
      // ease-out for hide-on-scroll chrome (matches the curve Google's
      // mobile search bar uses).
      style={{ transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}
