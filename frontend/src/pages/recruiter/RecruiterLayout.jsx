import React, { useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'

const scoutCSS = `
  @keyframes scoutScan {
    0% { transform: translateY(0) scale(1); opacity: 0.8; }
    50% { transform: translateY(-10px) scale(1.05); opacity: 1; }
    100% { transform: translateY(0) scale(1); opacity: 0.8; }
  }
  @keyframes scoutBeam {
    0% { opacity: 0; height: 0; }
    50% { opacity: 0.5; height: 60px; }
    100% { opacity: 0; height: 0; }
  }
  .corelink-scout {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--background);
  }
  .scout-drone {
    width: 60px;
    height: 60px;
    background: var(--surface);
    border: 2px solid var(--primary);
    border-radius: 20px 20px 8px 8px;
    position: relative;
    animation: scoutScan 2s ease-in-out infinite;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  }
  .scout-eye {
    width: 24px;
    height: 12px;
    background: var(--primary);
    border-radius: 6px;
    box-shadow: 0 0 10px var(--primary);
  }
  .scout-beam {
    width: 40px;
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.4) 0%, rgba(59, 130, 246, 0) 100%);
    animation: scoutBeam 2s ease-in-out infinite;
    margin-top: 4px;
    border-radius: 4px;
  }
`;

import { useNavigate, Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import Onboarding from '../../components/Onboarding.jsx'
import AppShell from '../../components/AppShell.jsx'
import RecruiterAccessRequest from '../../components/RecruiterAccessRequest.jsx'
import { Home, Briefcase, Users, Building, LogOut } from 'lucide-react'

export default function RecruiterLayout() {
  const { recruiterToken, recruiterUsername, loginRecruiter, logoutRecruiter } = useAuth()
  const [role, setRole] = useState(() => localStorage.getItem('ats_recruiter_role') || 'recruiter')
  const [isInitializing, setIsInitializing] = useState(true)

  // (Removed an artificial 1.5 s "initializing" splash — it only added latency.)
  React.useEffect(() => { setIsInitializing(false) }, [])
  const navigate = useNavigate()
  const location = useLocation()

  function handleLogin(token, username, nextRole) {
    localStorage.setItem('ats_recruiter_role', nextRole)
    setRole(nextRole)
    loginRecruiter(token, username)
  }

  const handleLogout = useCallback(() => {
    localStorage.removeItem('ats_recruiter_role')
    logoutRecruiter()
    navigate('/')
  }, [logoutRecruiter, navigate])

    if (isInitializing && recruiterToken) {
    return (
      <div className="corelink-scout">
        <style>{scoutCSS}</style>
        <div className="scout-drone">
          <div className="scout-eye"></div>
        </div>
        <div className="scout-beam"></div>
        <div style={{ marginTop: 24, fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase', fontSize: 13 }}>
          CoreLink Initializing...
        </div>
      </div>
    )
  }

  if (!recruiterToken) {
    return <RecruiterAuthPanel onLogin={handleLogin} />
  }

  if (role === 'admin') {
    return <Navigate to="/admin" replace />
  }

  const navItems = [
    { to: '/recruiter/home', label: 'Home', icon: Home },
    { to: '/recruiter/jobs', label: 'Jobs', icon: Briefcase },
    { to: '/recruiter/talent', label: 'Talent', icon: Users },
    { to: '/recruiter/profile', label: 'Company', icon: Building },
  ]
  const display = (recruiterUsername || '').split('@')[0]

  return (
    <AppShell
      tabs={navItems}
      brandSuffix="for Recruiters"
      quickLinks={[
        { to: '/recruiter/jobs?new=1', label: 'Post a job' },
        { to: '/recruiter/jobs', label: 'Review applicants' },
        { to: '/recruiter/talent', label: 'Search talent' },
        { to: '/recruiter/profile', label: 'Company profile' },
      ]}
      searchPlaceholder="Search candidates by skill, e.g. React, AutoCAD"
      onSearch={(q) => navigate(`/recruiter/talent${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
      account={{ initials: display.substring(0, 2).toUpperCase() || 'RC', label: display || 'Recruiter', sublabel: 'Recruiter', to: '/recruiter/profile' }}
      actions={
        <button type="button" className="as-icon-btn" onClick={handleLogout} aria-label="Log out" title="Log out">
          <LogOut size={18} />
        </button>
      }
    >
      <Onboarding type="recruiter" />
      <div className="recruiter-content">
        <Outlet context={{ token: recruiterToken, username: recruiterUsername, api: createAuthedFetch(recruiterToken, handleLogout) }} />
      </div>
    </AppShell>
  )
}

function RecruiterAuthPanel({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'request'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (mode === 'request') {
      return submitRequest()
    }
    if (!email.trim() || !password) {
      setError('Enter an email and password.')
      return
    }
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('email', email)
      fd.append('password', password)
      const res = await fetch('/api/auth/login', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      onLogin(data.access_token, data.email || data.username, data.role)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function submitRequest() {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError('Enter your name, email, and phone.')
      return
    }
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('email', email)
      fd.append('phone', phone)
      const res = await fetch('/api/recruiter-requests', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      setMessage('Request submitted. An admin will review it and email credentials after approval.')
      setName('')
      setEmail('')
      setPhone('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'request') {
    return (
      <div className="auth-page">
        <RecruiterAccessRequest onSwitchToLogin={() => { setMode('login'); setError(null); setMessage(null) }} />
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-glow" />
        <h2>{mode === 'login' ? 'Login' : 'Recruiter Access Request'}</h2>
        <p className="panel-desc">
          {mode === 'login'
            ? 'Sign in as a recruiter or admin.'
            : 'Send your details for admin approval. This does not create an account yet.'}
        </p>

        {mode === 'request' && (
          <>
            <label>Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jordan Lee" />
          </>
        )}

        <label>Email</label>
        <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="jordan@company.com" />

        {mode === 'request' && (
          <>
            <label>Phone</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 0100" />
          </>
        )}

        {mode === 'login' && (
          <>
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </>
        )}

        <button className="btn btn-primary" onClick={submit} disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Submit request'}
        </button>
        {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}
        {message && <div className="success-msg" style={{ marginTop: 16 }}>{message}</div>}

        <p className="panel-desc" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'login' ? "I'm a recruiter without an account. " : 'Already approved? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'request' : 'login'); setError(null); setMessage(null) }}>
            {mode === 'login' ? 'Request access' : 'Log in'}
          </a>
        </p>
      </div>
    </div>
  )
}
