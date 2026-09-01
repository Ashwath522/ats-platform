import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

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
    } catch (err) {
      console.error('Error loading admin data', err)
      throw new Error('Failed to load dashboard data')
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

  const pendingRequests = requests.filter(r => r.status === 'pending')
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
                    <div className="recruiter-request-header">
                      <div>
                        <div className="recruiter-request-name">{req.name}</div>
                        <div className="recruiter-request-meta">
                          {req.email} • {req.phone}
                        </div>
                        <div className="recruiter-request-meta">
                          Submitted: {new Date(req.submitted_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="recruiter-request-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleReject(req.id)}>Reject</button>
                        <button className="btn btn-primary btn-sm" onClick={() => handleApprove(req.id)}>Approve</button>
                      </div>
                    </div>
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
