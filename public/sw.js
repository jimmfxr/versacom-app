// Minimal service worker — exists to satisfy Chrome's installability
// check (so the address-bar install icon shows up) AND to handle Web
// Push notifications. Intentionally does NOT cache anything: aggressive
// PWA caching has bitten us in the past by serving stale JS after a
// deploy. Add caching later if/when we decide we want offline support,
// with a clear cache-versioning strategy.

self.addEventListener('install', (event) => {
  // Activate this SW as soon as it's installed instead of waiting for
  // every tab to close. Combined with clients.claim() below, a deploy
  // takes effect on the next navigation.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Passthrough fetch handler — required by Chrome for the install prompt.
// We don't intercept anything; the request hits the network as usual.
self.addEventListener('fetch', () => {
  // no-op
})

// ─── Web Push ──────────────────────────────────────────────────────────
//
// `push` fires when the browser receives a notification from the push
// service. We expect a JSON payload of the shape:
//
//   { title, body, url?, tag? }
//
// produced by `src/lib/web-push.ts`. Anything that doesn't parse falls
// back to a generic notification so the user still gets a signal.
self.addEventListener('push', (event) => {
  let payload = { title: 'Nodal Control', body: '', url: '/', tag: undefined }
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      // not JSON — try plain text
      try { payload.body = event.data.text() } catch {}
    }
  }
  const opts = {
    body: payload.body || '',
    icon: '/apple-touch-icon.png',
    badge: '/favicon-64.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    // Don't auto-clear so users can review missed alerts when they pick
    // up the device.
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(payload.title, opts))
})

// Tapping a notification: focus an existing tab if one is open, else
// open a new tab on the URL passed via the push payload.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer a same-origin window already on the target URL.
    for (const c of all) {
      try {
        const u = new URL(c.url)
        if (u.origin === self.location.origin && u.pathname + u.search === targetUrl) {
          await c.focus()
          return
        }
      } catch {}
    }
    // Otherwise, focus any tab and navigate it.
    for (const c of all) {
      try {
        await c.focus()
        if ('navigate' in c) await c.navigate(targetUrl)
        return
      } catch {}
    }
    // No tab open — open a new one.
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl)
    }
  })())
})
