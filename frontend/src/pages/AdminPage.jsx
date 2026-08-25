import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('email', email)
      fd.append('password', password)
      const loginRes = await fetch('/api/auth/login', { method: 'POST', body: fd })
      const loginData = await loginRes.json()
      if (!loginRes.ok || loginData.role !== 'admin') throw new Error('Invalid admin credentials')
      const statsRes = await fetch('/api/admin/suggestions', {
        headers: { Authorization: `Bearer ${loginData.access_token}` },
      })
      if (!statsRes.ok) throw new Error('Could not load admin dashboard')
      setStats(await statsRes.json())
      setAuthed(true)
      localStorage.setItem('ats_admin_token', loginData.access_token)
      localStorage.setItem('ats_admin_email', loginData.email)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-auth if password saved in session/localstorage
  useEffect(() => {
    const savedToken = localStorage.getItem('ats_admin_token')
    const savedEmail = localStorage.getItem('ats_admin_email')
    if (savedToken) {
      setEmail(savedEmail || '')
      fetch('/api/admin/suggestions', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then(res => {
          if (res.ok) {
            return res.json()
          }
          throw new Error()
        })
        .then(data => {
          setStats(data)
          setAuthed(true)
        })
        .catch(() => {
          localStorage.removeItem('ats_admin_token')
          localStorage.removeItem('ats_admin_email')
        })
    }
  }, [])

  function handleLogout() {
    localStorage.removeItem('ats_admin_token')
    localStorage.removeItem('ats_admin_email')
    setEmail('')
    setPassword('')
    setAuthed(false)
    setStats(null)
  }

  if (!authed) {
    return (
      <div className="admin-login-page container" style={{ maxWidth: 400, marginTop: '10%' }}>
        <div className="card admin-card">
          <h2>ATS Admin Gated Area</h2>
          <p>Please enter the admin password to access statistics and feedback box.</p>
          <form onSubmit={handleLogin}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>Admin Email</label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                style={{ width: '100%', marginBottom: 12 }}
              />
              <label>Admin Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password..."
                required
                style={{ width: '100%' }}
              />
            </div>
            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Verifying...' : 'Access Dashboard'}
              </button>
              <Link to="/" className="btn" style={{ textAlign: 'center', lineHeight: '36px' }}>Home</Link>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-dashboard-page container" style={{ marginTop: '3%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2>ATS Platform Admin Dashboard</h2>
          <p>Gated metrics & suggestion box feedback.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/" className="btn btn-secondary">Home</Link>
          <button onClick={handleLogout} className="btn">Log Out</button>
        </div>
      </div>

      <div className="admin-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="card stats-card" style={{ textAlign: 'center' }}>
          <h3>Total Candidates</h3>
          <span className="stats-number" style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary-color)' }}>
            {stats?.candidate_count}
          </span>
        </div>
        <div className="card stats-card" style={{ textAlign: 'center' }}>
          <h3>Total Recruiters</h3>
          <span className="stats-number" style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary-color)' }}>
            {stats?.recruiter_count}
          </span>
        </div>
      </div>

      <div className="card suggestions-card">
        <h3>User Suggestion / Feedback Submissions</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Suggestions submitted via contact/feedback box.</p>
        <div className="suggestions-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!stats?.suggestions || stats.suggestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No suggestions submitted yet.</div>
          ) : (
            stats.suggestions.map(sug => (
              <div key={sug.id} className="suggestion-item" style={{ padding: 12, border: '1px solid var(--border-color)', borderRadius: 8, background: 'rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <span>From: <strong>{sug.submitter || 'Anonymous'}</strong></span>
                  <span>{new Date(sug.submitted_at).toLocaleString()}</span>
                </div>
                <p style={{ margin: 0 }}>{sug.text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
