'use client'

import { useEffect, useState } from 'react'

/**
 * Scroll-linked "hide progress" tracker. Returns a number in [0, 1]
 * where 0 = chrome fully visible, 1 = chrome fully hidden. The value
 * follows the user's finger 1:1 — every pixel of scroll-down advances
 * hide progress, every pixel of scroll-up rewinds it — until the
 * cumulative offset hits `maxScrollPx`. Net scroll back to the top
 * forces 0 so the chrome always re-anchors at page top.
 *
 * Behaves like the Google / Instagram / Chrome top bars: slow scroll
 * → slow reveal, fast flick → fast reveal. AutoHideHeader and
 * BottomNav consume this via `transform: translateY(${progress * h}px)`
 * so they collapse / un-collapse in step with the gesture rather
 * than snapping over a fixed transition.
 *
 * Reads from both `window.scrollY` AND any element tagged
 * `[data-scroll-container]` (kiosk pages own their internal scroll
 * region). Whichever is currently scrolled wins.
 *
 * @param maxScrollPx Pixels of net downward scroll required to reach
 *   fully-hidden (progress = 1). Default 120 = roughly two slow
 *   thumb-flicks on mobile.
 * @param topAt Pixels from the top where progress is forced to 0 so
 *   the chrome always re-anchors at the page top.
 */
export function useHideProgress(maxScrollPx = 120, topAt = 4): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let offset = 0
    let lastY = readScroll()
    let ticking = false

    function readScroll(): number {
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
        if (offset !== 0) {
          offset = 0
          setProgress(0)
        }
        lastY = y
        return
      }
      const delta = y - lastY
      lastY = y
      const next = Math.max(0, Math.min(maxScrollPx, offset + delta))
      if (next === offset) return
      offset = next
      setProgress(offset / maxScrollPx)
    }

    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll)
    }
  }, [maxScrollPx, topAt])

  return progress
}

/**
 * Back-compat shim — the old direction-only consumers can keep
 * calling this name and get `'up' | 'down'` derived from progress.
 * New code should use useHideProgress directly.
 */
export function useScrollDirection(): 'up' | 'down' {
  const p = useHideProgress()
  return p > 0.5 ? 'down' : 'up'
}
