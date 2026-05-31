'use client'

import { useEffect, useState } from 'react'

/**
 * Thin "new version available" banner that surfaces when the service
 * worker has a freshly-installed update sitting in the waiting state.
 *
 * Tap Refresh → the page tells the new worker to skipWaiting(),
 * listens for it to become the controlling worker, then reloads so
 * the new build's HTML + assets serve.
 *
 * Dismiss → the banner stays hidden for the rest of this session
 * (sessionStorage flag). Reappears on next launch if the new SW is
 * still waiting.
 */

const DISMISS_KEY = 'sw-update-banner-dismissed'

export function SwUpdateBanner() {
  const [available, setAvailable] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // PWA-only: skip in regular browser tabs where Cmd/Ctrl+R already
    // gets a fresh bundle. The "new version available" banner is
    // really only useful when the user installed the home-screen
    // PWA (which holds a cached SW and would otherwise serve stale
    // JS until they explicitly trigger an update).
    //  - display-mode: standalone → installed PWA (Chrome / Android
    //    / iOS 16.4+)
    //  - navigator.standalone === true → legacy iOS Safari PWA
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Legacy iOS Safari property — typed via the cast to avoid the
      // missing-property error on the standard Navigator interface.
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (!isStandalone) return

    // Suppressed for this tab session?
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return

    let cancelled = false

    function show() {
      if (cancelled) return
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return
      setAvailable(true)
    }

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || cancelled) return

      // 1) Update already waiting from a previous session.
      if (reg.waiting && navigator.serviceWorker.controller) {
        show()
      }

      // 2) New update arrives while the page is open — listen for
      //    installing → installed transition, then surface the
      //    banner. The `controller` guard skips the FIRST install
      //    (which is the initial registration, not an update).
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            show()
          }
        })
      })

      // 3) Periodically poke the browser to check for updates so we
      //    don't have to wait for the default 24h cadence. Every 5
      //    minutes is plenty for active sessions.
      const interval = window.setInterval(
        () => {
          reg.update().catch(() => {})
        },
        5 * 60 * 1000,
      )
      return () => window.clearInterval(interval)
    })

    // 4) Reload when the new SW finishes claiming control. Triggered
    //    by handleRefresh below posting SKIP_WAITING.
    let refreshing = false
    function onControllerChange() {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  async function handleRefresh() {
    setReloading(true)
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      // controllerchange fires once the new worker activates → page
      // reload kicks in via the listener above.
      return
    }
    // No waiting worker (edge case — maybe already activated). Just
    // reload to be safe.
    window.location.reload()
  }

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setAvailable(false)
  }

  if (!available) return null

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[#0178a3]/30 bg-[#0178a3]/15 px-4 py-2 text-sm text-[#22a7d3]">
      <div className="flex items-center gap-2 min-w-0">
        <svg
          className="size-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
        <span className="truncate">A new version is available</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={reloading}
          className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reloading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={reloading}
          aria-label="Dismiss"
          className="flex size-7 items-center justify-center rounded-md text-[#22a7d3] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
        >
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
