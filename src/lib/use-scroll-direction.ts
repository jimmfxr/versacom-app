'use client'

import { useEffect, useState } from 'react'

/**
 * Direction-snapping "hide progress" tracker. Returns 0 (chrome
 * visible) or 1 (chrome hidden). Snaps to 1 after the user scrolls
 * OR swipes down past `downThreshold` of cumulative same-direction
 * movement, and snaps back to 0 after up-direction movement past
 * `upThreshold` or reaching the top of the page.
 *
 * Listens to BOTH scroll events AND raw touch events. Scroll events
 * cover the normal case (page overflows, finger drag triggers scroll).
 * Touch events cover the case where content fits the viewport — no
 * scroll event ever fires there, but the user's swipe intent should
 * still hide the chrome so they can see content overlapped by the
 * fixed footer / bottom nav.
 *
 * Snap (vs scroll-linked) keeps the chrome predictable: progress is
 * always 0 or 1, the consumer's CSS transition (~180ms ease-out)
 * carries the visual smoothness, and the direction thresholds give
 * iOS rubber-band overshoot a generous dead-zone before it can flip
 * state.
 *
 * @param _maxScrollPx Unused — kept for source-compatibility with
 *   call sites that pass an explicit pixel budget.
 * @param topAt Pixels from the top where progress is forced to 0
 *   (applies only when the page has measurable scroll position).
 * @param downThreshold Cumulative downward-swipe / scroll-down delta
 *   required to commit to hidden. Small (8px) so a deliberate swipe
 *   registers right away.
 * @param upThreshold Cumulative upward-swipe / scroll-up delta to
 *   commit back to visible. Larger (30px) so rubber-band / momentum
 *   settling doesn't reveal the chrome.
 */
export function useHideProgress(
  _maxScrollPx = 120,
  topAt = 4,
  downThreshold = 8,
  upThreshold = 30,
): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let hidden = false
    let lastY = readScroll()
    let dirAccum = 0 // signed accumulator
    let ticking = false
    // Touch tracking — separate from scroll because touch on a non-
    // overflowing element never produces scroll events.
    let touchLastY: number | null = null
    // Cooldown after each commit. When chrome hides the AutoHideHeader
    // collapses layout, which fires a scroll event whose delta would
    // otherwise be read as "scroll-up" and immediately flip the state
    // back — causing rapid open/close loops on real touch devices.
    // 220ms ≈ the CSS transition (180ms) plus a small buffer so any
    // layout-driven scroll events have settled before we re-listen.
    let commitCooldownUntil = 0

    function readScroll(): number {
      const containers = document.querySelectorAll<HTMLElement>('[data-scroll-container]')
      for (const c of containers) {
        if (c.scrollTop > 0) return c.scrollTop
      }
      return window.scrollY
    }

    function commit(next: boolean) {
      if (hidden === next) return
      hidden = next
      setProgress(next ? 1 : 0)
      dirAccum = 0
      commitCooldownUntil = performance.now() + 220
    }

    /** Apply a movement delta (positive = "wants to scroll down" =
     *  swipe finger up; negative = "wants to scroll up" = swipe finger
     *  down) toward the hide state. */
    function applyDelta(delta: number) {
      if (delta === 0) return
      // During cooldown, ignore further input — prevents the layout-
      // settling scroll events from immediately flipping state back.
      if (performance.now() < commitCooldownUntil) return
      // Direction-change resets the accumulator so a small reversal
      // doesn't immediately flip state.
      if ((delta > 0) !== (dirAccum > 0)) dirAccum = 0
      dirAccum += delta
      if (!hidden && dirAccum >= downThreshold) commit(true)
      else if (hidden && dirAccum <= -upThreshold) commit(false)
    }

    function updateFromScroll() {
      ticking = false
      const y = readScroll()
      // Top-anchor reset is ALSO gated by cooldown. Otherwise a
      // layout-driven scrollTop=0 (the engine clamping after chrome
      // hide collapsed the page) reads as "user is at the top" and
      // immediately reveals the chrome.
      if (y <= topAt && performance.now() >= commitCooldownUntil) {
        commit(false)
        lastY = y
        return
      }
      const delta = y - lastY
      lastY = y
      applyDelta(delta)
    }

    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(updateFromScroll)
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return
      touchLastY = e.touches[0].clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (touchLastY == null || e.touches.length !== 1) return
      const y = e.touches[0].clientY
      // Finger moves UP (y decreases) → user is trying to scroll down →
      // positive delta (advance hide). Finger moves DOWN (y increases)
      // → trying to scroll up → negative delta (reveal).
      const delta = touchLastY - y
      touchLastY = y
      applyDelta(delta)
    }

    function onTouchEnd() {
      touchLastY = null
    }

    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [topAt, downThreshold, upThreshold])

  return progress
}

/**
 * Back-compat shim — the old direction-only consumers can keep
 * calling this name. New code should use useHideProgress directly.
 */
export function useScrollDirection(): 'up' | 'down' {
  const p = useHideProgress()
  return p > 0.5 ? 'down' : 'up'
}
