/* Thanos PWA service worker.
 *
 * Deliberately minimal. A wallet must NEVER serve stale app code from a cache
 * (a stale bundle is a security risk), so this caches nothing — every request
 * goes to the network. Its only job is to exist with a `fetch` handler so the
 * site satisfies Chrome's PWA install criteria ("Install app" prompt).
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // No respondWith() — let the browser perform the default network fetch.
  // The presence of this handler is what makes the app installable.
});
