import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../auth.jsx'
import { apiUrl } from '../../lib/api.js'
import { Button } from '../../ui/index.jsx'
import { AuthLayout, CardBrand, linkedinRedirectUri, takeLinkedInState } from './components/AuthKit.jsx'

/** Friendly text for the ?error=… LinkedIn sends back. */
export function linkedinErrorMessage(code, description) {
  const c = String(code || '')
  if (/cancel/i.test(c) || /cancel/i.test(description || '')) return null // user backed out: no error banner
  if (c === 'unauthorized_scope_error') return 'LinkedIn sign-in is not fully set up yet (the “Sign In with LinkedIn using OpenID Connect” product is missing on the LinkedIn app).'
  if (c === 'invalid_redirect_uri' || /redirect/i.test(description || '')) return 'LinkedIn sign-in is not fully set up yet (this website’s address is not in the LinkedIn app’s Authorized redirect URLs).'
  return description ? `LinkedIn: ${description}` : 'LinkedIn sign-in did not complete. Please try again.'
}

/**
 * /auth/linkedin/callback — LinkedIn redirects here with ?code&state (or
 * ?error). We check the state we stored before leaving, swap the code for a
 * CoreLink token on our server, then continue like the other logins.
 */
export default function LinkedInCallback() {
  const navigate = useNavigate()
  const { loginCandidate, loginRecruiter, loginAdmin } = useAuth()
  const [error, setError] = useState(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // React StrictMode runs effects twice in dev; the code is single-use
    ran.current = true
    const q = new URLSearchParams(window.location.search)
    const saved = takeLinkedInState()
    const back = (msg) => navigate(saved?.returnTo || '/candidate/login', { replace: true, state: msg ? { authError: msg } : undefined })

    if (q.get('error')) { back(linkedinErrorMessage(q.get('error'), q.get('error_description'))); return }
    if (!saved || saved.state !== q.get('state')) { setError('This LinkedIn sign-in link has expired or was opened in a different tab. Please start again.'); return }
    if (!q.get('code')) { back('LinkedIn did not return a sign-in code. Please try again.'); return }

    ;(async () => {
      try {
        const r = await fetch(apiUrl('/api/auth/linkedin'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: q.get('code'), redirect_uri: linkedinRedirectUri(), role: saved.role }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.detail || 'LinkedIn sign-in failed. Please try again.')
        if (d.role === 'candidate') {
          loginCandidate(d.access_token, d.username)
          navigate(d.created ? '/candidate/onboarding/linkedin' : '/candidate/feed', { replace: true })
        } else if (d.role === 'admin') {
          loginAdmin(d.access_token, d.email)
          navigate('/admin/dashboard', { replace: true })
        } else {
          loginRecruiter(d.access_token, d.email || d.username)
          navigate('/recruiter/dashboard', { replace: true })
        }
      } catch (e) {
        back(e.message || 'LinkedIn sign-in failed. Please try again.')
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthLayout image="/assets/images/crops/login-student.jpg" imageAlt="">
      <CardBrand />
      {error ? (
        <>
          <h1>Couldn’t sign you in</h1>
          <p className="pub-auth-sub">{error}</p>
          <Button block className="pub-submit" onClick={() => navigate('/candidate/login', { replace: true })}>Back to sign in</Button>
        </>
      ) : (
        <div className="cl-row" style={{ gap: 10, justifyContent: 'center', padding: '32px 0' }} role="status">
          <Loader2 size={20} className="cl-spin" /> <span>Signing you in with LinkedIn…</span>
        </div>
      )}
    </AuthLayout>
  )
}
