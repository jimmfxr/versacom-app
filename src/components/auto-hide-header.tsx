'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHideProgress } from '@/lib/use-scroll-direction'

/**
 * Mobile-only auto-hiding wrapper. Same direction-driven pattern as
 * the BottomNav, but scroll-LINKED rather than snap-based: as the
 * user scrolls down the content translates up + collapses out of
 * layout proportionally to scroll distance. Slow scroll → slow
 * collapse; fast flick → fast collapse. Matches Google / Instagram
 * top-bar feel.
 *
 * How the layout shrinks: we apply BOTH `transform: translateY(-N)`
 * AND `margin-bottom: -N` where N = progress * measuredHeight. The
 * transform moves the chrome visually; the negative margin claws
 * back the same amount of layout space so the content below moves
 * up with it (rather than leaving a gap).
 *
 * Desktop (sm:) bypasses the hide entirely — chrome stays static.
 *
 * `useLayoutEffect` measures the content height after every render
 * so changes (loading state, route nav, content swaps) keep the
 * translation distance correct.
 */
export function AutoHideHeader({
  children,
  className = '',
}: {
  children: React.ReactNode
  /** Extra classes appended to the outer wrapper. Useful for edge-
   *  bleed via negative margins (e.g. Tasks search bar's
   *  `-mx-4 sm:-mx-6 lg:-mx-8`). */
  className?: string
}) {
  const progress = useHideProgress()
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  // Track whether we're on mobile — desktop bypasses the hide.
  const [isMobile, setIsMobile] = useState(false)

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    function check() {
      setIsMobile(window.matchMedia('(max-width: 639px)').matches)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Re-measure content height whenever it might change (layout, fonts,
  // dynamic content). ResizeObserver gives us pixel-accurate height
  // without needing to listen to every possible content-change event.
  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setHeight(el.offsetHeight)
    })
    ro.observe(el)
    setHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  const hidePx = isMobile ? progress * height : 0
  const style: React.CSSProperties = {
    transform: `translateY(${-hidePx}px)`,
    marginBottom: hidePx > 0 ? `${-hidePx}px` : undefined,
  }

  return (
    <div className={`flex-shrink-0 overflow-hidden ${className}`}>
      <div ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  )
}
