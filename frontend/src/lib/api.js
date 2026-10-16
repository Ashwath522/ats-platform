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

/* ── "Waking up the server…" ──────────────────────────────────────────────
 * The API runs on a free host that sleeps when idle; the first request after
 * a sleep takes 30–60 s. If the first API call of this page load is still
 * pending after WAKE_AFTER_MS we show a small banner instead of a blank page,
 * and remove it as soon as any API response arrives. Shown at most once. */
export const WAKE_AFTER_MS = 3000
let wakeState = 'idle' // idle → pending → done
let wakeTimer = null
let wakeEl = null

function isApiCall(url) {
  return typeof url === 'string' && (url.startsWith('/api/') || (RAW_BASE && url.startsWith(`${RAW_BASE}/api/`)))
}

function showWakeBanner() {
  if (wakeEl || typeof document === 'undefined' || !document.body) return
  wakeEl = document.createElement('div')
  wakeEl.className = 'cl-wake-banner'
  wakeEl.setAttribute('role', 'status')
  wakeEl.setAttribute('aria-live', 'polite')
  wakeEl.innerHTML = '<span class="cl-wake-spin" aria-hidden="true"></span><span><strong>Waking up the server…</strong> '
    + 'Our free hosting sleeps when idle — the first load can take up to a minute.</span>'
  if (!document.getElementById('cl-wake-style')) {
    const st = document.createElement('style')
    st.id = 'cl-wake-style'
    st.textContent = `.cl-wake-banner{position:fixed;left:16px;right:16px;top:12px;margin:0 auto;width:fit-content;max-width:560px;z-index:9999;display:flex;gap:10px;align-items:center;
box-sizing:border-box;padding:10px 16px;border-radius:12px;background:#0f2a4a;color:#fff;font:500 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
box-shadow:0 8px 24px rgba(15,42,74,.25);animation:cl-wake-in .2s ease-out}
.cl-wake-banner strong{font-weight:700}
.cl-wake-spin{flex:none;width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:cl-wake-rot .8s linear infinite}
@keyframes cl-wake-rot{to{transform:rotate(360deg)}}@keyframes cl-wake-in{from{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){.cl-wake-spin,.cl-wake-banner{animation:none}}
@media (prefers-color-scheme:dark){.cl-wake-banner{background:#e8f0fb;color:#0f2a4a}.cl-wake-spin{border-color:rgba(15,42,74,.3);border-top-color:#0f2a4a}}`
    document.head.appendChild(st)
  }
  document.body.appendChild(wakeEl)
}

function endWake() {
  if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null }
  if (wakeEl) { wakeEl.remove(); wakeEl = null }
  wakeState = 'done'
}

/** Wrap an API fetch promise so a slow *first* request shows the wake banner. */
export function trackWake(promise) {
  if (wakeState === 'done') return promise
  if (wakeState === 'idle') {
    wakeState = 'pending'
    wakeTimer = setTimeout(showWakeBanner, WAKE_AFTER_MS)
  }
  // any API response (or failure) means the server answered / we stop waiting
  promise.then(endWake, endWake)
  return promise
}

export function installApiBase() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && needsBase(input)) {
      return trackWake(nativeFetch(`${RAW_BASE}${input}`, init))
    }
    if (input instanceof Request) {
      const u = new URL(input.url)
      if (u.origin === window.location.origin && needsBase(u.pathname)) {
        return trackWake(nativeFetch(new Request(`${RAW_BASE}${u.pathname}${u.search}`, input), init))
      }
    }
    const p = nativeFetch(input, init)
    return isApiCall(typeof input === 'string' ? input : input?.url && new URL(input.url).pathname) ? trackWake(p) : p
  }
}
