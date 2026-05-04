'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js on mount. Required so Chrome treats Nodal Control as
 * an installable PWA — without an active service worker the address-bar
 * install icon never shows, and "Install app…" stays disabled in the
 * three-dot menu.
 *
 * Failures are swallowed: if registration fails (private browsing,
 * disabled SW, etc.) the rest of the app must keep working.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Only attempt registration in production builds. In dev (next dev
    // with Turbopack) the SW would intercept HMR traffic and confuse the
    // dev server even with a passthrough fetch handler.
    if (process.env.NODE_ENV !== 'production') return

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silent — installability is a nice-to-have, not load-bearing.
    })
  }, [])

  return null
}
