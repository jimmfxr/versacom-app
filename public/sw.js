// Minimal service worker — exists only to satisfy Chrome's installability
// check so the address-bar install icon shows up. Intentionally does NOT
// cache anything: aggressive PWA caching has bitten us in the past by
// serving stale JS after a deploy. Add caching later if/when we decide we
// want offline support, with a clear cache-versioning strategy.

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
