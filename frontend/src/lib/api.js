/**
 * API base-URL wrapper.
 *
 * The web build talks to the backend through relative URLs (`/api/...`),
 * which works behind the Vite dev proxy or nginx. Inside the Android/iOS app
 * (Capacitor) the page is served from `https://localhost` / `capacitor://`,
 * so relative calls would hit the phone itself. We wrap `window.fetch` once at
 * startup: any request to `/api/...` or `/media/...` is rewritten to
 * `${VITE_API_URL}/api/...`. Every existing `fetch('/api/…')` call in the app
 * keeps working unchanged.
 */

const RAW_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

export const API_BASE = RAW_BASE

const PREFIXES = ['/api/', '/media/', '/candidate/project-upload', '/candidate/status', '/recruiter/jobs/']

function needsBase(url) {
  return typeof url === 'string' && RAW_BASE && url.startsWith('/') && PREFIXES.some((p) => url.startsWith(p))
}

export function apiUrl(path) {
  return needsBase(path) ? `${RAW_BASE}${path}` : path
}

/** Absolute URL for user-uploaded media (avatars, covers, certificates). */
export function mediaUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl
  if (/^(https?:|data:|blob:)/.test(pathOrUrl)) return pathOrUrl
  const p = pathOrUrl.startsWith('/') ? pathOrUrl : `/media/${pathOrUrl}`
  return apiUrl(p)
}

let installed = false

export function installApiBase() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && needsBase(input)) {
      return nativeFetch(`${RAW_BASE}${input}`, init)
    }
    if (input instanceof Request) {
      const u = new URL(input.url)
      if (u.origin === window.location.origin && needsBase(u.pathname)) {
        return nativeFetch(new Request(`${RAW_BASE}${u.pathname}${u.search}`, input), init)
      }
    }
    return nativeFetch(input, init)
  }
}
