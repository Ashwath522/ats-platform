import React, { useState } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import { useNavigate, Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import Onboarding from '../../components/Onboarding.jsx'

export default function RecruiterLayout() {
  const { recruiterToken, recruiterUsername, loginRecruiter, logoutRecruiter } = useAuth()
  const [role, setRole] = useState(() => localStorage.getItem('ats_recruiter_role') || 'recruiter')
  const navigate = useNavigate()
  const location = useLocation()

  function handleLogin(token, username, nextRole) {
    localStorage.setItem('ats_recruiter_role', nextRole)
    setRole(nextRole)
    loginRecruiter(token, username)
  }

  function handleLogout() {
    localStorage.removeItem('ats_recruiter_role')
    logoutRecruiter()
    navigate('/')
  }

  if (!recruiterToken) {
    return <RecruiterAuthPanel onLogin={handleLogin} />
  }

  if (role === 'admin') {
    return <Navigate to="/admin" replace />
  }

  const navItems = [
    { id: 'home', label: 'Home', path: '/recruiter/home', icon: '🏠' },
    { id: 'jobs', label: 'Jobs', path: '/recruiter/jobs', icon: '💼' },
    { id: 'talent', label: 'Talent', path: '/recruiter/talent', icon: '👥' },
    { id: 'messages', label: 'Messages', path: '/recruiter/messages', icon: '💬' },
    { id: 'profile', label: 'Profile', path: '/recruiter/profile', icon: '🏢' },
  ]

  return (
    <div className="recruiter-dashboard-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Onboarding type="recruiter" />
      
      {/* Sidebar Navigation (Desktop) */}
      <div className="recruiter-sidebar" style={{ width: 260, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div className="admin-topbar-brand" style={{ padding: '24px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="admin-topbar-logo">C</div>
          <div>
            <div className="admin-topbar-title">CoreLink Recruiter</div>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 12px', gap: 8, flex: 1 }}>
          {navItems.map(item => {
            const isActive = location.pathname.startsWith(item.path)
            return (
              <Link 
                key={item.id}
                to={item.path}
                className={`btn ${isActive ? 'btn-primary' : 'btn-ghost'}`} 
                style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '10px 16px', fontWeight: isActive ? 'bold' : 'normal', textDecoration: 'none', color: isActive ? 'white' : 'var(--text)' }}
              >
                <span style={{ marginRight: 12 }}>{item.icon}</span> {item.label}
              </Link>
            )
          })}
        </div>

        <div style={{ padding: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Signed in as <strong style={{ color: 'var(--text)' }}>{recruiterUsername}</strong></span>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Log out</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="recruiter-content" style={{ flex: 1, overflowY: 'auto', padding: '40px 60px', background: 'var(--background)' }}>
        <Outlet context={{ token: recruiterToken, username: recruiterUsername, api: createAuthedFetch(recruiterToken, handleLogout) }} />
      </div>

      {/* Mobile Bottom Nav */}
      <div className="mobile-nav">
        {navItems.map(item => {
          const isActive = location.pathname.startsWith(item.path)
          return (
            <Link key={item.id} to={item.path} className={`mobile-nav-item ${isActive ? 'active' : ''}`}>
              <div className="icon">{item.icon}</div>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
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
