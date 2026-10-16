import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth.jsx'
import { apiUrl } from '../../lib/api.js'

export default function LinkedInCallback() {
  const navigate = useNavigate(); const { loginCandidate, loginRecruiter, loginAdmin } = useAuth(); const [error, setError] = useState('Signing you in with LinkedIn…')
  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(location.search); const saved = JSON.parse(sessionStorage.getItem('linkedin_oauth') || 'null'); sessionStorage.removeItem('linkedin_oauth')
      if (!saved || saved.state !== q.get('state')) { setError('This LinkedIn sign-in link has expired. Please try again.'); return }
      if (q.get('error')) { navigate('/candidate/login?linkedin=cancelled', { replace: true }); return }
      try {
        const redirect_uri = `${location.origin}/auth/linkedin/callback`
        const r = await fetch(apiUrl('/api/auth/linkedin'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: q.get('code'), redirect_uri, role: saved.role }) })
        const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'LinkedIn sign-in failed')
        if (d.role === 'candidate') { loginCandidate(d.access_token, d.username); navigate(d.created ? '/candidate/onboarding/linkedin' : '/candidate/feed', { replace: true }) }
        else if (d.role === 'admin') { loginAdmin(d.access_token, d.email); navigate('/admin/dashboard', { replace: true }) }
        else { loginRecruiter(d.access_token, d.email || d.username); navigate('/recruiter/dashboard', { replace: true }) }
      } catch (e) { setError(e.message) }
    })()
  }, [])
  return <main className="pub-auth-card" style={{ margin: '15vh auto', maxWidth: 440 }}><h1>{error}</h1><button className="pub-linkbtn" onClick={() => navigate('/candidate/login')}>Back to sign in</button></main>
}
