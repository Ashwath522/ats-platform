import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ExternalLink, Mail, RefreshCw, Send } from 'lucide-react'
import VerificationReport, { VerdictBadge } from '../components/VerificationReport'

// Riskiest first so they get the closest look; unverified (legacy) requests sit with "review".
const VERDICT_RANK = { high_risk: 0, review: 1, verified: 2 }
function riskRank(req) {
  return VERDICT_RANK[req.verification_verdict] ?? 1
}

function websiteHref(url) {
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authed, setAuthed] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  
  const [stats, setStats] = useState(null)
  const [requests, setRequests] = useState([])
  const [activeTab, setActiveTab] = useState('requests') // 'requests', 'stats', 'suggestions'
  const [tempPasswords, setTempPasswords] = useState({}) // request_id -> string
  const [expanded, setExpanded] = useState({}) // request_id -> bool
  const [reverifying, setReverifying] = useState({}) // request_id -> bool
  const [emailStatus, setEmailStatus] = useState(null)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

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
      
      localStorage.setItem('ats_admin_token', loginData.access_token)
      localStorage.setItem('ats_admin_email', loginData.email)
      
      await loadAdminData(loginData.access_token)
      setAuthed(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadAdminData(token) {
    try {
      const [statsRes, reqsRes] = await Promise.all([
        fetch('/api/admin/suggestions', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/recruiter-requests', { headers: { Authorization: `Bearer ${token}` } })
      ])
      
      if (statsRes.ok) setStats(await statsRes.json())
      if (reqsRes.ok) setRequests(await reqsRes.json())
      loadEmailStatus(token)
    } catch (err) {
      console.error('Error loading admin data', err)
      throw new Error('Failed to load dashboard data')
    }
  }

  async function loadEmailStatus(token = localStorage.getItem('ats_admin_token')) {
    try {
      const res = await fetch('/api/admin/email/status', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setEmailStatus(await res.json())
    } catch (err) {
      console.error('Error loading email status', err)
    }
  }

  async function handleSendTestEmail(e) {
    e.preventDefault()
    const token = localStorage.getItem('ats_admin_token')
    setTesting(true)
    setTestResult(null)
    try {
      const fd = new FormData()
      fd.append('to', testTo)
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Test email failed')
      setTestResult(data)
    } catch (err) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTesting(false)
      loadEmailStatus(token)
    }
  }

  async function handleReverify(requestId) {
    const token = localStorage.getItem('ats_admin_token')
    setReverifying(prev => ({ ...prev, [requestId]: true }))
    try {
      const res = await fetch(`/api/admin/recruiter-requests/${requestId}/reverify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Re-verification failed')
      setRequests(prev => prev.map(r => (r.id === requestId ? { ...r, ...data } : r)))
      setExpanded(prev => ({ ...prev, [requestId]: true }))
    } catch (err) {
      alert(err.message)
    } finally {
      setReverifying(prev => ({ ...prev, [requestId]: false }))
    }
  }

  // Auto-auth if password saved in session/localstorage
  useEffect(() => {
    const savedToken = localStorage.getItem('ats_admin_token')
    const savedEmail = localStorage.getItem('ats_admin_email')
    if (savedToken) {
      setEmail(savedEmail || '')
      loadAdminData(savedToken)
        .then(() => setAuthed(true))
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
    setRequests([])
  }

  async function handleApprove(requestId) {
    const token = localStorage.getItem('ats_admin_token')
    try {
      const res = await fetch(`/api/admin/recruiter-requests/${requestId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Approval failed')
      
      // Save temp password if returned
      if (data.temporary_password) {
        setTempPasswords(prev => ({ ...prev, [requestId]: data.temporary_password }))
      }
      
      // Update local state to 'approved'
      setRequests(prev => prev.map(r => r.id === requestId ? { 
        ...r, 
        status: 'approved',
        email_sent: data.email_sent,
        warning: data.warning
      } : r))
      
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleReject(requestId) {
    const token = localStorage.getItem('ats_admin_token')
    try {
      const res = await fetch(`/api/admin/recruiter-requests/${requestId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Rejection failed')
      }
      
      // Update local state to 'rejected'
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'rejected' } : r))
      
    } catch (err) {
      alert(err.message)
    }
  }

  if (!authed) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div className="admin-topbar-logo">A</div>
            <h2>Admin Portal</h2>
          </div>
          <p className="text-muted" style={{ marginBottom: 24 }}>Authenticate to access the admin dashboard.</p>
          <form onSubmit={handleLogin}>
            <label>Admin Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              style={{ marginBottom: 16 }}
            />
            <label>Admin Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password..."
              required
              style={{ marginBottom: 20 }}
            />
            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                {loading ? 'Verifying...' : 'Access Dashboard'}
              </button>
              <Link to="/" className="btn btn-secondary">Home</Link>
            </div>
          </form>
        </div>
      </div>
    )
  }

  const pendingRequests = requests
    .filter(r => r.status === 'pending')
    .sort((a, b) => riskRank(a) - riskRank(b) || new Date(a.submitted_at) - new Date(b.submitted_at))
  const completedRequests = requests.filter(r => r.status !== 'pending')

  return (
    <div className="admin-page">
      <div className="admin-topbar">
        <div className="admin-topbar-brand">
          <div className="admin-topbar-logo">C</div>
          <div>
            <div className="admin-topbar-title">CoreLink Admin</div>
            <div className="admin-topbar-subtitle">System Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/" className="btn btn-ghost btn-sm">Exit Admin</Link>
          <button onClick={handleLogout} className="btn btn-secondary btn-sm">Log Out</button>
        </div>
      </div>

      <div className="admin-body">
        <div className="tabs">
          <button 
            className={`tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            Recruiter Requests {pendingRequests.length > 0 && `(${pendingRequests.length})`}
          </button>
          <button 
            className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            Platform Stats
          </button>
          <button 
            className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`}
            onClick={() => setActiveTab('suggestions')}
          >
            User Suggestions
          </button>
          <button
            className={`tab-btn ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => { setActiveTab('email'); loadEmailStatus() }}
          >
            Email Delivery
          </button>
        </div>

        {activeTab === 'requests' && (
          <div className="panel">
            <h2>Pending Approvals</h2>
            <p className="panel-desc">Review and approve accounts for enterprise recruiters.</p>
            
            {pendingRequests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">✅</div>
                <p>All caught up! No pending recruiter requests.</p>
              </div>
            ) : (
              <div className="requests-list">
                {pendingRequests.map(req => (
                  <div key={req.id} className="recruiter-request-item">
                    <div className="recruiter-request-header" style={{ flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div className="recruiter-request-name">{req.name}</div>
                          <VerdictBadge verdict={req.verification_verdict} score={req.verification_score ?? undefined} />
                        </div>
                        {(req.designation || req.company_name) && (
                          <div className="recruiter-request-meta">
                            {[req.designation, req.company_name].filter(Boolean).join(' at ')}
                          </div>
                        )}
                        <div className="recruiter-request-meta" style={{ wordBreak: 'break-word' }}>
                          {req.email} • {req.phone}
                        </div>
                        {req.company_website && (
                          <div className="recruiter-request-meta">
                            <a href={websiteHref(req.company_website)} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, wordBreak: 'break-all' }}>
                              {req.company_website} <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          </div>
                        )}
                        {(req.gstin || req.cin) && (
                          <div className="recruiter-request-meta">
                            {req.gstin && <span>GSTIN: {req.gstin} </span>}
                            {req.cin && <span>CIN: {req.cin}</span>}
                          </div>
                        )}
                        <div className="recruiter-request-meta">
                          Submitted: {new Date(req.submitted_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="recruiter-request-actions" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleReverify(req.id)}
                          disabled={!!reverifying[req.id]}
                          title="Re-run company verification checks"
                        >
                          <RefreshCw size={14} aria-hidden="true" /> {reverifying[req.id] ? 'Checking…' : 'Re-verify'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleReject(req.id)}>Reject</button>
                        <button className="btn btn-primary btn-sm" onClick={() => handleApprove(req.id)}>Approve</button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, paddingLeft: 0 }}
                      aria-expanded={!!expanded[req.id]}
                      onClick={() => setExpanded(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                    >
                      <ChevronDown size={14} aria-hidden="true"
                        style={{ transform: expanded[req.id] ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                      {expanded[req.id] ? 'Hide verification report' : 'Show verification report'}
                    </button>
                    {expanded[req.id] && (
                      <div style={{ marginTop: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
                        <VerificationReport verification={req.verification} compact />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {completedRequests.length > 0 && (
              <>
                <h3 style={{ marginTop: 32, marginBottom: 16 }}>Recently Decided</h3>
                <div className="requests-list" style={{ opacity: 0.8 }}>
                  {completedRequests.map(req => (
                    <div key={req.id} className="recruiter-request-item" style={{ background: 'var(--bg)' }}>
                      <div className="recruiter-request-header">
                        <div>
                          <div className="recruiter-request-name">{req.name}</div>
                          <div className="recruiter-request-meta">
                            {req.email} • {req.phone}
                          </div>
                          <div className="recruiter-request-meta">
                            Status: <strong className={req.status === 'approved' ? 'text-success' : 'text-danger'}>{req.status.toUpperCase()}</strong>
                          </div>
                        </div>
                      </div>
                      {(tempPasswords[req.id] || req.email_sent === false) && (
                        <div className="temp-password-banner" style={req.email_sent === false ? { backgroundColor: '#fff3cd', color: '#856404' } : {}}>
                          {req.email_sent === false ? (
                            <strong>Account created, but email failed: {req.warning || 'They will need to reset their password.'} </strong>
                          ) : (
                            <span>Account created! The user has been emailed. </span>
                          )}
                          {tempPasswords[req.id] && (
                            <span>
                              If needed, their temporary password is: <span className="temp-password-value">{tempPasswords[req.id]}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'email' && (
          <div className="panel">
            <h2>Email Delivery</h2>
            <p className="panel-desc">Outbound email provider status and the most recent delivery attempts.</p>

            <div className="stats-grid">
              <div className="stat-card">
                <h3>Provider</h3>
                <span className="stat-number" style={{ fontSize: 24, textTransform: 'capitalize' }}>
                  {emailStatus?.provider || '...'}
                </span>
              </div>
              <div className="stat-card">
                <h3>Status</h3>
                <span className={`stat-number ${emailStatus?.configured ? 'text-success' : 'text-danger'}`} style={{ fontSize: 24 }}>
                  {emailStatus ? (emailStatus.configured ? 'Configured' : 'Not configured') : '...'}
                </span>
                {emailStatus?.sender && (
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                    From: {emailStatus.sender_name} &lt;{emailStatus.sender}&gt;
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={handleSendTestEmail} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '20px 0' }}>
              <input
                type="email"
                value={testTo}
                onChange={e => setTestTo(e.target.value)}
                placeholder="you@example.com"
                required
                style={{ flex: '1 1 220px', minHeight: 44, fontSize: 16 }}
                aria-label="Send test email to"
              />
              <button type="submit" className="btn btn-primary" disabled={testing} style={{ minHeight: 44 }}>
                <Send size={16} aria-hidden="true" /> {testing ? 'Sending…' : 'Send test email'}
              </button>
            </form>
            {testResult && (
              <div className={testResult.success ? 'temp-password-banner' : 'error-banner'} style={{ marginBottom: 16, wordBreak: 'break-word' }}>
                {testResult.success
                  ? `Test email sent to ${testResult.to} via ${testResult.provider}.`
                  : `Test email failed: ${testResult.error}`}
              </div>
            )}

            <h3 style={{ marginTop: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={18} aria-hidden="true" /> Recent emails
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadEmailStatus()} title="Refresh">
                <RefreshCw size={14} aria-hidden="true" />
              </button>
            </h3>
            {!emailStatus?.logs?.length ? (
              <div className="empty-state"><p>No emails sent yet.</p></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px 6px' }}>When</th>
                      <th style={{ padding: '8px 6px' }}>To</th>
                      <th style={{ padding: '8px 6px' }}>Category</th>
                      <th style={{ padding: '8px 6px' }}>Status</th>
                      <th style={{ padding: '8px 6px' }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailStatus.logs.map(row => (
                      <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          {row.created_at ? new Date(row.created_at + (row.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '8px 6px', wordBreak: 'break-all' }}>{row.to_email}</td>
                        <td style={{ padding: '8px 6px' }}>{row.category}</td>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          <strong className={row.status === 'sent' || row.status === 'logged' ? 'text-success' : row.status === 'failed' ? 'text-danger' : ''}>
                            {row.status}
                          </strong>
                          {row.attempts > 1 && <span className="text-muted"> ×{row.attempts}</span>}
                        </td>
                        <td style={{ padding: '8px 6px', color: 'var(--text-secondary)', wordBreak: 'break-word', maxWidth: 320 }}>
                          {row.error || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="panel">
            <h2>Platform Statistics</h2>
            <p className="panel-desc">Overview of user growth and system usage.</p>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Candidates</h3>
                <span className="stat-number">{stats?.candidate_count || 0}</span>
              </div>
              <div className="stat-card">
                <h3>Total Recruiters</h3>
                <span className="stat-number">{stats?.recruiter_count || 0}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'suggestions' && (
          <div className="panel">
            <h2>User Feedback</h2>
            <p className="panel-desc">Suggestions submitted via the contact / feedback box.</p>
            
            {!stats?.suggestions || stats.suggestions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <p>No suggestions submitted yet.</p>
              </div>
            ) : (
              <div className="suggestions-list">
                {stats.suggestions.map(sug => (
                  <div key={sug.id} className="suggestion-item">
                    <div className="suggestion-meta">
                      <span>From: <strong>{sug.submitter || 'Anonymous'}</strong></span>
                      <span>{new Date(sug.submitted_at).toLocaleString()}</span>
                    </div>
                    <div className="suggestion-text">{sug.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
