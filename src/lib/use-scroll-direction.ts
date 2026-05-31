'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks vertical scroll direction across the window scroll AND any
 * inner scroll regions tagged with `data-scroll-container` (the
 * kiosk-style pages put their scrolling region inside one of those).
 *
 * Returns `'up'` or `'down'`. Hysteresis-based: only flips when the
 * cumulative delta in one direction crosses `threshold` so jittery
 * single-pixel scroll events don't toggle the nav.
 *
 * Always resolves to `'up'` when the active scroll source is within
 * `topAt` pixels of the top — so the bottom nav is visible the
 * moment the user reaches the top of a list, even if they got there
 * mid-downward-scroll inertia.
 *
 * Used by BottomNav (and any future hide-on-scroll chrome) so the
 * bar slides out of view when the operator is reading down a long
 * list and slides back the moment they nudge upward.
 */
export function useScrollDirection(threshold = 8, topAt = 4): 'up' | 'down' {
  const [direction, setDirection] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastY = readScroll()
    let ticking = false

    function readScroll(): number {
      // Prefer the topmost scrolled `[data-scroll-container]` (kiosk
      // pages own their own internal scroll region). Fall back to
      // window scroll for non-kiosk pages.
      const containers = document.querySelectorAll<HTMLElement>('[data-scroll-container]')
      for (const c of containers) {
        if (c.scrollTop > 0) return c.scrollTop
      }
      return window.scrollY
    }

    function update() {
      ticking = false
      const y = readScroll()
      if (y <= topAt) {
        if (direction !== 'up') setDirection('up')
        lastY = y
        return
      }
      const delta = y - lastY
      if (Math.abs(delta) < threshold) return
      setDirection(delta > 0 ? 'down' : 'up')
      lastY = y
    }

    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    // capture: true catches scroll events from descendant scroll
    // containers (regular bubbling doesn't fire `scroll`).
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll)
    }
    // direction intentionally omitted from deps — we read+write it
    // inside the listener, re-subscribing on every change would
    // thrash the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, topAt])

  return direction
}
