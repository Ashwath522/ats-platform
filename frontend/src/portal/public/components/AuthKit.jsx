/**
 * Shared pieces for the public sign-in pages (02 student, 03 recruiter, admin):
 * split layout with the approved photo, CoreLink card header, inputs with
 * show/hide password, and the platform announcement / support email that the
 * admin manages in System Settings (served by GET /api/public/stats).
 */
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, Lock, Megaphone } from 'lucide-react'
import { BrandMark, Input, cx } from '../../../ui/index.jsx'
import { apiUrl } from '../../../lib/api.js'
import './public.css'

let cache = null
/** Public platform info (counts, announcement, support email). Never throws. */
export function usePublicInfo() {
  const [info, setInfo] = useState(cache)
  useEffect(() => {
    if (cache) return undefined
    let alive = true
    fetch(apiUrl('/api/public/stats'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { cache = d; if (alive) setInfo(d) } })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return info
}

export function Announcement({ info }) {
  if (!info?.announcement) return null
  return <div className={cx('pub-announce', info.announcement.tone)} role="status"><Megaphone size={15} aria-hidden="true" /> {info.announcement.text}</div>
}

export function AuthLayout({ image, imageAlt, wide, children }) {
  const info = usePublicInfo()
  return (
    <div className="cl-app pub pub-auth">
      <Announcement info={info} />
      <div className={cx('pub-auth-grid', wide && 'wide')}>
        <div className="pub-auth-media"><img src={image} alt={imageAlt} /></div>
        <main className={cx('pub-auth-side', wide && 'wide')}>
          <div className={cx('pub-auth-card', wide && 'wide')}>{typeof children === 'function' ? children(info) : children}</div>
        </main>
      </div>
    </div>
  )
}

export function CardBrand() {
  return (
    <div className="pub-auth-brand">
      <Link to="/" aria-label="CoreLink home">
        <BrandMark size={58} />
        <span><strong>CoreLink</strong><small>Build · Learn · Grow</small></span>
      </Link>
    </div>
  )
}

export function TextField({ id, label, icon, error, ...rest }) {
  return (
    <div className={icon ? undefined : 'pub-plain'}>
      <label htmlFor={id} className="cl-sr">{label}</label>
      <Input id={id} icon={icon} placeholder={label} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
      {error && <p id={`${id}-err`} className="pub-field-err">{error}</p>}
    </div>
  )
}

export function PasswordField({ id, label = 'Password', error, strength, ...rest }) {
  const [show, setShow] = useState(false)
  const v = rest.value || ''
  const score = [v.length >= 8, /[A-Z]/.test(v) && /[a-z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length
  return (
    <div className="pub-pw">
      <label htmlFor={id} className="cl-sr">{label}</label>
      <Input id={id} icon={Lock} type={show ? 'text' : 'password'} placeholder={label} aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined} {...rest}
        right={<button type="button" className="pub-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={21} /> : <Eye size={21} />}
        </button>} />
      {strength && v && (
        <div className="pub-strength" aria-label={`Password strength ${score} of 4`}>
          {[0, 1, 2, 3].map((i) => <i key={i} className={cx(i < score && 'on', score < 3 && 'weak')} />)}
        </div>
      )}
      {error && <p id={`${id}-err`} className="pub-field-err">{error}</p>}
    </div>
  )
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** POST form-data and return parsed JSON, throwing Error(detail) on failure. */
export async function postForm(url, fields) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v))
  const res = await fetch(apiUrl(url), { method: 'POST', body: fd })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  if (!res.ok) {
    const d = data?.detail
    const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : null
    const err = new Error(msg || (res.status === 429 ? 'Too many attempts — wait a minute and try again.' : `Request failed (${res.status})`))
    err.status = res.status
    throw err
  }
  return data
}

/* ── Sign in with Google ─────────────────────────────────────────────── */
let gisPromise = null
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in')) }
      document.head.appendChild(s)
    })
  }
  return gisPromise
}

/** GET a public auth config. Success is cached; failures are not (Render may be waking up). */
function configLoader(path) {
  let ok = null
  let pending = null
  return () => {
    if (ok) return Promise.resolve(ok)
    if (!pending) {
      pending = fetch(apiUrl(path))
        .then((r) => (r.ok ? r.json() : { enabled: false }))
        .then((d) => { if (d && typeof d.enabled === 'boolean') ok = d; return d || { enabled: false } })
        .catch(() => ({ enabled: false }))
        .finally(() => { pending = null })
    }
    return pending
  }
}
const googleConfig = configLoader('/api/auth/google/config')
const linkedinConfig = configLoader('/api/auth/linkedin/config')

const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.()

/**
 * Google's official button. Hidden when the server has no GOOGLE_CLIENT_ID or
 * inside the native app (Google blocks its sign-in inside app webviews).
 * onSuccess(data) receives the same token payload as the password logins.
 */
export function GoogleSignIn({ role = 'candidate', onSuccess, onError, text = 'continue_with', divider = true, onReady, width: fixedWidth, shape = 'rectangular' }) {
  const box = React.useRef(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const handlers = React.useRef({ onSuccess, onError, onReady })
  handlers.current = { onSuccess, onError, onReady }

  useEffect(() => {
    if (isNativeApp()) return undefined
    let alive = true
    ;(async () => {
      const cfg = await googleConfig()
      if (!alive || !cfg.enabled || !cfg.client_id) return
      try { await loadGis() } catch (e) { return }
      if (!alive || !box.current) return
      window.google.accounts.id.initialize({
        client_id: cfg.client_id,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async ({ credential }) => {
          setBusy(true)
          try {
            const r = await fetch(apiUrl('/api/auth/google'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, role }) })
            const data = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(data.detail || 'Google sign-in failed')
            handlers.current.onSuccess?.(data)
          } catch (e) {
            handlers.current.onError?.(e.message || 'Google sign-in failed')
          } finally { setBusy(false) }
        },
      })
      const width = fixedWidth || Math.min(400, Math.max(220, Math.round(box.current.getBoundingClientRect().width || 320)))
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text, shape, logo_alignment: 'center', width })
      setReady(true)
      handlers.current.onReady?.()
    })()
    return () => { alive = false }
  }, [role, text, fixedWidth, shape])

  if (isNativeApp()) return null
  return (
    <div className={cx('pub-google', !ready && 'pending')} aria-busy={busy}>
      {ready && divider && <div className="pub-or"><span>or</span></div>}
      <div ref={box} className="pub-google-btn" />
    </div>
  )
}

/* ── Sign in with LinkedIn (OpenID Connect, redirect flow) ────────────── */

const LI_KEY = 'linkedin_oauth'
export const linkedinRedirectUri = () => `${window.location.origin}/auth/linkedin/callback`

function randomState() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Build LinkedIn's authorize URL and remember state/role for the callback page. */
export function startLinkedIn(clientId, role, storage = window.sessionStorage) {
  const state = randomState()
  const returnTo = role === 'candidate' ? '/candidate/login' : '/recruiter/login'
  storage.setItem(LI_KEY, JSON.stringify({ state, role, returnTo, at: Date.now() }))
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: linkedinRedirectUri(), state, scope: 'openid profile email',
  })
  return `https://www.linkedin.com/oauth/v2/authorization?${q.toString()}`
}

/** Read and clear what startLinkedIn stored. Returns null when missing/expired (> 15 min). */
export function takeLinkedInState(storage = window.sessionStorage) {
  let saved = null
  try { saved = JSON.parse(storage.getItem(LI_KEY) || 'null') } catch { saved = null }
  storage.removeItem(LI_KEY)
  if (!saved || !saved.state || (saved.at && Date.now() - saved.at > 15 * 60 * 1000)) return null
  return saved
}

function LinkedInGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path fill="#fff" d="M7.1 9.6h2.6V18H7.1zM8.4 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM11.3 9.6h2.5v1.15h.04c.35-.66 1.2-1.36 2.47-1.36 2.64 0 3.13 1.74 3.13 4V18h-2.6v-4.1c0-.98-.02-2.24-1.36-2.24-1.37 0-1.58 1.07-1.58 2.17V18h-2.6z" />
    </svg>
  )
}

export function LinkedInSignIn({ role = 'candidate', onReady, style }) {
  const [cfg, setCfg] = useState(null)
  const [going, setGoing] = useState(false)
  useEffect(() => {
    if (isNativeApp()) return undefined
    let alive = true
    linkedinConfig().then((c) => { if (alive) { setCfg(c); if (c?.enabled) onReady?.() } })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (isNativeApp() || !cfg?.enabled || !cfg.client_id) return null
  const start = () => {
    setGoing(true)
    window.location.assign(startLinkedIn(cfg.client_id, role))
  }
  return (
    <button type="button" className="pub-provider pub-linkedin" style={style} onClick={start} disabled={going} aria-busy={going}>
      <LinkedInGlyph />
      <span>{going ? 'Opening LinkedIn…' : 'Continue with LinkedIn'}</span>
    </button>
  )
}

/** Which sign-in providers the server has turned on ({google, linkedin}: true/false, null while loading). */
export function useProviders() {
  const [p, setP] = useState(() => (isNativeApp() ? { google: false, linkedin: false } : { google: null, linkedin: null }))
  useEffect(() => {
    if (isNativeApp()) return undefined
    let alive = true
    googleConfig().then((c) => alive && setP((x) => ({ ...x, google: !!(c?.enabled && c.client_id) })))
    linkedinConfig().then((c) => alive && setP((x) => ({ ...x, linkedin: !!(c?.enabled && c.client_id) })))
    return () => { alive = false }
  }, [])
  return p
}

function MailGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" />
    </svg>
  )
}

/** Width every provider button shares (Google's button is drawn at a fixed pixel width). */
function useSharedWidth(ref) {
  const [w, setW] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setW(Math.min(400, Math.max(220, Math.floor(el.getBoundingClientRect().width))))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    let t
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(measure, 150) })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [ref])
  return w
}

/**
 * Three equal pills: Google · LinkedIn · Email. Google/LinkedIn appear only
 * when the server has them configured; Email is always there.
 */
export function ProviderButtons({ role = 'candidate', providers, onSuccess, onError, onEmail, googleText = 'continue_with', emailLabel = 'Continue with Email' }) {
  const box = React.useRef(null)
  const width = useSharedWidth(box)
  const style = width ? { width } : undefined
  return (
    <div className="pub-providers" ref={box}>
      {providers.google !== false && width && (
        <div className="pub-provider-slot" style={style}>
          <GoogleSignIn role={role} text={googleText} divider={false} shape="pill" width={width} onSuccess={onSuccess} onError={onError} />
        </div>
      )}
      {providers.linkedin && <LinkedInSignIn role={role} style={style} />}
      <button type="button" className="pub-provider pub-email" style={style} onClick={onEmail}>
        <MailGlyph /><span>{emailLabel}</span>
      </button>
    </div>
  )
}

/**
 * "or" divider + Google + LinkedIn, stacked at the same width (used where the
 * email form stays visible, e.g. the recruiter page).
 */
export function SocialSignIn({ role = 'candidate', onSuccess, onError, googleText = 'continue_with' }) {
  const providers = useProviders()
  const box = React.useRef(null)
  const width = useSharedWidth(box)
  if (isNativeApp() || (!providers.google && !providers.linkedin)) return <div ref={box} />
  const style = width ? { width } : undefined
  return (
    <div className="pub-social" ref={box}>
      <div className="pub-or"><span>or</span></div>
      {providers.google && width && (
        <div className="pub-provider-slot" style={style}>
          <GoogleSignIn role={role} text={googleText} divider={false} shape="pill" width={width} onSuccess={onSuccess} onError={onError} />
        </div>
      )}
      {providers.linkedin && <LinkedInSignIn role={role} style={style} />}
    </div>
  )
}
