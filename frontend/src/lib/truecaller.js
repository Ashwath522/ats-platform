/**
 * Truecaller mobile-web verification (free). Works in Android phone browsers
 * when the Truecaller app is installed; everywhere else the button is hidden.
 *
 *   const r = await runTruecaller({ purpose: 'login' })          // → login payload
 *   const r = await runTruecaller({ purpose: 'verify_phone', token })
 *
 * Flow: our API issues a one-time nonce → we open truecallersdk://…web_verify →
 * the user taps Continue in Truecaller → Truecaller calls our server → we poll
 * /status until it is verified.
 */
import { apiUrl } from './api.js'

export const isNativeApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

/** Android phone browser (the only place Truecaller's web flow runs). */
export function truecallerSupported(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return /Android/i.test(ua) && /Mobile/i.test(ua) && !isNativeApp()
}

export function buildDeepLink({ nonce, partnerKey, partnerName, origin, ttlMs = 600000 }) {
  const q = new URLSearchParams({
    type: 'btmsheet',
    requestNonce: nonce,
    partnerKey,
    partnerName: partnerName || 'CoreLink',
    lang: 'en',
    privacyUrl: `${origin}/privacy`,
    termsUrl: `${origin}/terms`,
    loginPrefix: 'continue',
    loginSuffix: 'verifymobile',
    ctaPrefix: 'continuewith',
    ctaColor: '#0b5cff',
    ctaTextColor: '#ffffff',
    btnShape: 'round',
    skipOption: 'useanothermethod',
    ttl: String(ttlMs),
  })
  return `truecallersdk://truesdk/web_verify?${q.toString()}`
}

export class TruecallerError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runTruecaller({ purpose = 'login', token, timeoutMs = 120000, openLink = (u) => { window.location.href = u } } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(apiUrl('/api/auth/truecaller/start'), { method: 'POST', headers, body: JSON.stringify({ purpose }) })
  const start = await r.json().catch(() => ({}))
  if (!r.ok) throw new TruecallerError('start', start.detail || 'Truecaller verification is unavailable right now')

  openLink(buildDeepLink({ nonce: start.nonce, partnerKey: start.partner_key, partnerName: start.partner_name, origin: window.location.origin, ttlMs: start.ttl_ms }))
  // If the page still has focus, Truecaller didn't open (app missing).
  await sleep(700)
  if (typeof document !== 'undefined' && document.hasFocus()) {
    throw new TruecallerError('no_app', 'Truecaller isn’t installed on this phone. Use Google, LinkedIn or Email instead.')
  }

  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    await sleep(document.hidden ? 1500 : 1200)
    let s
    try {
      const res = await fetch(apiUrl(`/api/auth/truecaller/status?nonce=${start.nonce}`))
      s = await res.json()
    } catch { continue }
    if (s.status === 'pending') continue
    if (s.status === 'verified') return s
    if (s.status === 'rejected') throw new TruecallerError('rejected', 'Truecaller verification was cancelled.')
    if (s.status === 'no_account') throw new TruecallerError('no_account', s.detail)
    throw new TruecallerError(s.status || 'failed', s.detail || 'Truecaller couldn’t verify your number. Please try again.')
  }
  throw new TruecallerError('timeout', 'Truecaller didn’t respond in time. Please try again.')
}
