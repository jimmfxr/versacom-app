'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Visibility-aware periodic `router.refresh()`.
 *
 * Many pages have multiple concurrent editors (managers on the project
 * page, kiosk creating placeholder members, users submitting change
 * requests). Without polling, a manager's view goes stale until they
 * manually reload. This hook calls `router.refresh()` on an interval
 * while the tab is in the foreground.
 *
 * Pages opt out of a tick by returning `true` from `shouldSkip` — use
 * this to pause while a card edit form is open, a save is in flight,
 * or any local state would be disrupted by a re-render.
 *
 * @param intervalMs  How often to attempt a refresh. Default 6000.
 * @param shouldSkip  Optional predicate; return true to skip this tick.
 *                    Wrap the closed-over state in `useCallback` so the
 *                    interval doesn't reset every render.
 */
export function useBackgroundRefresh(intervalMs: number = 6000, shouldSkip?: () => boolean) {
  const router = useRouter()
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') return
      if (shouldSkip?.()) return
      router.refresh()
    }, intervalMs)
    return () => window.clearInterval(interval)
  }, [router, intervalMs, shouldSkip])
}
