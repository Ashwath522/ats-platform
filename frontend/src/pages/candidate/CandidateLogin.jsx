import React, { useState } from 'react'
import { useAuth } from '../../auth.jsx'
import { useNavigate } from 'react-router-dom'

export default function CandidateLogin() {
  const { loginCandidate } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!username.trim() || !password) {
      setError('Enter a username and password.')
      return
    }
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('username', username)
      fd.append('password', password)
      const endpoint = mode === 'login' ? '/api/candidate/auth/login' : '/api/candidate/auth/register'
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      loginCandidate(data.access_token, data.username)
      navigate('/candidate/profile')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-glow" />
        <h2>{mode === 'login' ? 'Candidate Login' : 'Create Candidate Account'}</h2>
        <p className="panel-desc">
          {mode === 'login'
            ? 'Sign in to browse jobs, manage your profile, and track applications.'
            : 'Create an account to start building your portfolio and applying to jobs.'}
        </p>

        <label>Username</label>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. alex" />

        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'At least 8 characters' : 'Password'}
          onKeyDown={e => e.key === 'Enter' && submit()} />

        <button className="primary" onClick={submit} disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        {error && <div className="error-msg">{error}</div>}

        <p className="panel-desc" style={{ marginTop: 16 }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
            {mode === 'login' ? 'Create one' : 'Log in'}
          </a>
        </p>
      </div>
    </div>
  )
}
