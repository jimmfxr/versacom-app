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
export function useScrollDirection(
  threshold = 16,
  topAt = 4,
  /** Milliseconds to lock the direction after a flip — damps the
   *  oscillation that AutoHideHeader's collapse can introduce when
   *  the parent layout reflows mid-scroll (was causing the Radios
   *  Zones tab chrome to rapidly open/close). 150ms is enough to
   *  outlast the 200ms transition AND any scroll-anchor jitter. */
  cooldownMs = 150,
): 'up' | 'down' {
  const [direction, setDirection] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastY = readScroll()
    let lastFlipAt = 0
    let lastDirection: 'up' | 'down' = 'up'
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
        if (lastDirection !== 'up') {
          lastDirection = 'up'
          lastFlipAt = performance.now()
          setDirection('up')
        }
        lastY = y
        return
      }
      const delta = y - lastY
      if (Math.abs(delta) < threshold) return
      const next: 'up' | 'down' = delta > 0 ? 'down' : 'up'
      // Hysteresis — don't allow a direction flip within the cooldown
      // window of the previous flip. Prevents oscillation when the
      // parent layout reflows during the auto-hide transition.
      if (next !== lastDirection && performance.now() - lastFlipAt < cooldownMs) {
        return
      }
      if (next !== lastDirection) {
        lastDirection = next
        lastFlipAt = performance.now()
        setDirection(next)
      }
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
  }, [threshold, topAt, cooldownMs])

  return direction
}
