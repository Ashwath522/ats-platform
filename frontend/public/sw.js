/* CoreLink service worker.
 * - Pages (HTML) are always fetched from the network first, so a new deploy shows
 *   up immediately; the cached copy is only used when offline.
 * - Fingerprinted build files (/assets/*-hash.js|css) never change, so they are
 *   served from cache.
 * - Anything else, and every request to another origin (the API), is left alone.
 * Bump VERSION to drop old caches.
 */
const VERSION = 'corelink-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        const c = await caches.open(VERSION)
        c.put('/index.html', fresh.clone())
        return fresh
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) { const c = await caches.open(VERSION); c.put(req, res.clone()) }
      return res
    })())
  }
})
