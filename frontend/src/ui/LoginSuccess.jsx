import React, { useCallback, useEffect, useRef, useState } from 'react'
import './login-success.css'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Full-screen "you're in" moment shown right after any successful sign-in:
 * the CoreLink mark spins up, a ring closes around it, a verified tick pops
 * and a few sparks fly — then onDone() navigates. ~1.6 s (0.6 s with
 * reduced motion). Click / Esc skips it.
 */
export function LoginSuccess({ name, subtitle, onDone }) {
  const done = useRef(false)
  const finish = useCallback(() => { if (!done.current) { done.current = true; onDone?.() } }, [onDone])
  useEffect(() => {
    const t = setTimeout(finish, reduced() ? 650 : 1650)
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') finish() }
    window.addEventListener('keydown', onKey)
    try { navigator.vibrate?.(18) } catch { /* ignore */ }
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [finish])
  const first = String(name || '').replace(/@.*/, '').split(/[\s._-]+/)[0]
  const hello = first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
  return (
    <div className="ls-root" role="status" aria-live="polite" onClick={finish}>
      <div className="ls-stage">
        <div className="ls-badge">
          <svg className="ls-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" className="ls-ring-track" />
            <circle cx="60" cy="60" r="54" className="ls-ring-fill" />
          </svg>
          <svg className="ls-mark" viewBox="0 0 40 40" aria-hidden="true">
            <defs>
              <linearGradient id="lsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f8dff" /><stop offset="1" stopColor="#0b4fe0" /></linearGradient>
            </defs>
            <path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" fill="url(#lsg)" />
            <path d="M20 11 27.8 15.5v9L20 29l-7.8-4.5v-9Z" fill="#fff" />
            <path d="M20 15.2 24.1 17.6v4.8L20 24.8l-4.1-2.4v-4.8Z" fill="#0b5cff" />
          </svg>
          <span className="ls-tick" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
          </span>
          {Array.from({ length: 10 }).map((_, i) => <i key={i} className="ls-spark" style={{ '--a': `${i * 36}deg`, '--d': `${(i % 3) * 40}ms` }} />)}
        </div>
        <h2 className="ls-title">{hello ? `You're in, ${hello}` : "You're in"}</h2>
        <p className="ls-sub">{subtitle || 'Verified · taking you to your dashboard'}</p>
      </div>
    </div>
  )
}

/** const [overlay, celebrate] = useLoginSuccess(); celebrate(name, () => navigate(...)) */
export function useLoginSuccess() {
  const [state, setState] = useState(null)
  const celebrate = useCallback((name, then, subtitle) => setState({ name, then, subtitle }), [])
  const overlay = state ? <LoginSuccess name={state.name} subtitle={state.subtitle} onDone={() => state.then?.()} /> : null
  return [overlay, celebrate]
}
