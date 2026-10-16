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

let gConfig = null
async function googleConfig() {
  if (gConfig) return gConfig
  try {
    const r = await fetch(apiUrl('/api/auth/google/config'))
    gConfig = r.ok ? await r.json() : { enabled: false }
  } catch { gConfig = { enabled: false } }
  return gConfig
}

const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.()

/**
 * Google's official button. Hidden when the server has no GOOGLE_CLIENT_ID or
 * inside the native app (Google blocks its sign-in inside app webviews).
 * onSuccess(data) receives the same token payload as the password logins.
 */
export function GoogleSignIn({ role = 'candidate', onSuccess, onError, text = 'continue_with' }) {
  const box = React.useRef(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const handlers = React.useRef({ onSuccess, onError })
  handlers.current = { onSuccess, onError }

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
      const width = Math.min(400, Math.max(220, Math.round(box.current.getBoundingClientRect().width || 320)))
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text, shape: 'rectangular', logo_alignment: 'center', width })
      setReady(true)
    })()
    return () => { alive = false }
  }, [role, text])

  if (isNativeApp()) return null
  return (
    <div className={cx('pub-google', !ready && 'pending')} aria-busy={busy}>
      {ready && <div className="pub-or"><span>or</span></div>}
      <div ref={box} className="pub-google-btn" />
    </div>
  )
}

let liConfig = null
async function linkedinConfig() {
  if (liConfig) return liConfig
  try { const r = await fetch(apiUrl('/api/auth/linkedin/config')); liConfig = r.ok ? await r.json() : { enabled: false } }
  catch { liConfig = { enabled: false } }
  return liConfig
}

export function LinkedInSignIn({ role = 'candidate', onError }) {
  const [cfg, setCfg] = useState(null)
  useEffect(() => { if (!isNativeApp()) linkedinConfig().then(setCfg) }, [])
  if (isNativeApp() || !cfg?.enabled) return null
  const start = () => {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes)
    const state = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('')
    const redirect = `${window.location.origin}/auth/linkedin/callback`
    sessionStorage.setItem('linkedin_oauth', JSON.stringify({ state, role, returnTo: window.location.pathname }))
    window.location.assign(`https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(cfg.client_id)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}&scope=openid%20profile%20email`)
  }
  return <button type="button" className="pub-linkedin" onClick={start}><b>in</b> Continue with LinkedIn</button>
}
