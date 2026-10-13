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
