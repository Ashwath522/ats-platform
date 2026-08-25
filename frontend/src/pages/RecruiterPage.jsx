import React, { useEffect, useState } from 'react'
import { useAuth, createAuthedFetch } from '../auth.jsx'
import { useNavigate, Navigate } from 'react-router-dom'
import Onboarding from '../components/Onboarding.jsx'

export default function RecruiterPage() {
  const { recruiterToken, recruiterUsername, loginRecruiter, logoutRecruiter } = useAuth()
  const [role, setRole] = useState(() => localStorage.getItem('ats_recruiter_role') || 'recruiter')
  const navigate = useNavigate()

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

  return <RecruiterDashboard token={recruiterToken} username={recruiterUsername} onLogout={handleLogout} />
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

// AdminDashboard removed, now in AdminPage.jsx

function RecruiterDashboard({ token, username, onLogout }) {
  const api = createAuthedFetch(token, onLogout)

  // Tab state
  const [activeTab, setActiveTab] = useState('companies') // 'companies' | 'jobs'

  // Companies state (existing + merged with origin/main)
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [editingCompanyId, setEditingCompanyId] = useState(null)
  const [editCompanyName, setEditCompanyName] = useState('')
  const [jdTitle, setJdTitle] = useState('')
  const [jdDescription, setJdDescription] = useState('')
  const [applyUrl, setApplyUrl] = useState('')
  const [savingJd, setSavingJd] = useState(false)
  const [matches, setMatches] = useState(null)
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [error, setError] = useState(null)
  const [jdHistory, setJdHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  // Filters from origin/main
  const [minScore, setMinScore] = useState(0)
  const [minExperience, setMinExperience] = useState(0)
  const [requiredSkill, setRequiredSkill] = useState('')

  // Jobs state (new)
  const [myJobs, setMyJobs] = useState([])
  const [branches, setBranches] = useState([])
  const [showJobForm, setShowJobForm] = useState(false)
  const [jobForm, setJobForm] = useState({
    title: '', description: '', branch: '', salary_min: '', salary_max: '', currency: 'INR',
    location_text: '', requirements: '', remote_type: 'onsite',
  })
  const [savingJob, setSavingJob] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [applicants, setApplicants] = useState(null)
  const [applicantsLoading, setApplicantsLoading] = useState(false)

  // Fetch branches
  useEffect(() => {
    fetch('/api/candidate/branches')
      .then(res => res.json())
      .then(data => setBranches(data || []))
      .catch(() => {})
  }, [])

  // Companies logic
  async function refreshCompanies() {
    try {
      const res = await api('/api/recruiter/companies')
      if (!res.ok) throw new Error('Could not load companies')
      setCompanies(await res.json())
    } catch (e) { setError(e.message) }
  }

  useEffect(() => { refreshCompanies() }, [])

  async function createCompany() {
    if (!newCompanyName.trim()) return
    try {
      const fd = new FormData()
      fd.append('name', newCompanyName)
      const res = await api('/api/recruiter/companies', { method: 'POST', body: fd })
      const c = await res.json()
      setNewCompanyName('')
      await refreshCompanies()
      setSelectedCompanyId(c.id)
    } catch (e) { setError(e.message) }
  }

  async function updateCompanyName(companyId) {
    if (!editCompanyName.trim()) { setEditingCompanyId(null); return }
    try {
      const fd = new FormData()
      fd.append('name', editCompanyName)
      const res = await api(`/api/recruiter/companies/${companyId}`, { method: 'PUT', body: fd })
      if (!res.ok) throw new Error('Failed to update company name')
      await refreshCompanies()
      setEditingCompanyId(null)
    } catch (e) { setError(e.message) }
  }

  async function deleteCompany(companyId, companyName) {
    if (!window.confirm(`Delete "${companyName}"? This removes its job description too. This can't be undone.`)) return
    setError(null)
    try {
      const res = await api(`/api/recruiter/companies/${companyId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to delete company')
      if (selectedCompanyId === companyId) { setSelectedCompanyId(null); setMatches(null) }
      await refreshCompanies()
    } catch (e) { setError(e.message) }
  }

  async function saveJobDescription() {
    if (!selectedCompanyId || !jdTitle.trim() || !jdDescription.trim()) {
      setError('Select a company and fill in title + description.')
      return
    }
    setError(null)
    setSavingJd(true)
    try {
      const fd = new FormData()
      fd.append('title', jdTitle)
      fd.append('description', jdDescription)
      fd.append('apply_url', applyUrl)
      const res = await api(`/api/recruiter/companies/${selectedCompanyId}/job-description`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save')
      await refreshCompanies()
      await loadMatches(selectedCompanyId)
      await loadJdHistory(selectedCompanyId)
    } catch (e) { setError(e.message) } finally { setSavingJd(false) }
  }

  async function loadMatches(companyId) {
    setMatchesLoading(true)
    setError(null)
    try {
      const res = await api(`/api/recruiter/companies/${companyId}/matching-resumes`)
      if (!res.ok) throw new Error((await res.json()).detail || 'No matches yet')
      setMatches(await res.json())
    } catch (e) { setError(e.message); setMatches(null) } finally { setMatchesLoading(false) }
  }

  async function loadJdHistory(companyId) {
    try {
      const res = await api(`/api/recruiter/companies/${companyId}/job-descriptions`)
      if (res.ok) setJdHistory(await res.json())
    } catch (e) {}
  }

  useEffect(() => {
    if (selectedCompanyId) {
      loadMatches(selectedCompanyId)
      loadJdHistory(selectedCompanyId)
      const comp = companies.find(c => c.id === selectedCompanyId)
      if (comp) {
        setApplyUrl(comp.apply_url || '')
      }
    } else {
      setJdHistory([])
      setShowHistory(false)
    }
  }, [selectedCompanyId, companies])

  // Jobs logic (new)
  async function refreshJobs() {
    try {
      const res = await api('/api/recruiter/jobs')
      if (res.ok) setMyJobs(await res.json())
    } catch (e) { setError(e.message) }
  }

  useEffect(() => { if (activeTab === 'jobs') refreshJobs() }, [activeTab])

  async function createJob() {
    setSavingJob(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('title', jobForm.title)
      fd.append('description', jobForm.description)
      if (jobForm.branch) fd.append('branch', jobForm.branch)
      if (jobForm.salary_min) fd.append('salary_min', jobForm.salary_min)
      if (jobForm.salary_max) fd.append('salary_max', jobForm.salary_max)
      fd.append('currency', jobForm.currency)
      fd.append('location_text', jobForm.location_text)
      fd.append('requirements', jobForm.requirements)
      fd.append('remote_type', jobForm.remote_type)
      const res = await api('/api/recruiter/jobs', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      setShowJobForm(false)
      setJobForm({ title: '', description: '', branch: '', salary_min: '', salary_max: '', currency: 'INR', location_text: '', requirements: '', remote_type: 'onsite' })
      await refreshJobs()
    } catch (e) { setError(e.message) } finally { setSavingJob(false) }
  }

  async function deleteJob(jobId) {
    if (!window.confirm('Delete this job posting?')) return
    try {
      const res = await api(`/api/recruiter/jobs/${jobId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      if (selectedJobId === jobId) { setSelectedJobId(null); setApplicants(null) }
      await refreshJobs()
    } catch (e) { setError(e.message) }
  }

  async function closeJob(jobId) {
    try {
      const fd = new FormData()
      fd.append('status', 'closed')
      const res = await api(`/api/recruiter/jobs/${jobId}`, { method: 'PUT', body: fd })
      if (!res.ok) throw new Error('Failed')
      await refreshJobs()
    } catch (e) { setError(e.message) }
  }

  async function loadApplicants(jobId) {
    setApplicantsLoading(true)
    try {
      const res = await api(`/api/recruiter/jobs/${jobId}/applicants`)
      if (res.ok) setApplicants(await res.json())
    } catch (e) { setError(e.message) } finally { setApplicantsLoading(false) }
  }

  useEffect(() => {
    if (selectedJobId) loadApplicants(selectedJobId)
    else setApplicants(null)
  }, [selectedJobId])

  async function updateApplicantStatus(jobId, appId, status) {
    try {
      const fd = new FormData()
      fd.append('status', status)
      const res = await api(`/api/recruiter/jobs/${jobId}/applicants/${appId}/status`, { method: 'PUT', body: fd })
      if (!res.ok) throw new Error('Failed to update status')
      // Update local state instead of full refetch to keep it snappy
      setApplicants(prev => {
        if (!prev) return prev
        return {
          ...prev,
          applicants: prev.applicants.map(a => a.application_id === appId ? { ...a, status } : a)
        }
      })
    } catch (e) { setError(e.message) }
  }

  function filteredMatches(results, minScore, minExperience, requiredSkill) {
    const skill = requiredSkill.trim().toLowerCase()
    return results.filter(result => {
      const hasSkill = !skill || result.matched_skills.some(item => item.toLowerCase().includes(skill))
      return result.ats_score >= minScore && (result.experience_years || 0) >= minExperience && hasSkill
    })
  }

  const pipelineStages = [
    { id: 'ats_check', label: 'ATS Check' },
    { id: 'repo_verification', label: 'Repo Verification' },
    { id: 'automated_interview', label: 'Automated Interview' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'rejected', label: 'Rejected' }
  ]

  return (
    <div className="recruiter-dashboard-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Onboarding type="recruiter" />
      
      {/* Sidebar Navigation */}
      <div className="recruiter-sidebar" style={{ width: 260, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        <div className="admin-topbar-brand" style={{ padding: '24px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="admin-topbar-logo">C</div>
          <div>
            <div className="admin-topbar-title">CoreLink Recruiter</div>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 12px', gap: 8, flex: 1 }}>
          <button 
            className={`btn ${activeTab === 'jobs' && !showJobForm && !selectedJobId ? 'btn-primary' : 'btn-ghost'}`} 
            style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '10px 16px', fontWeight: activeTab === 'jobs' && !showJobForm && !selectedJobId ? 'bold' : 'normal' }}
            onClick={() => { setActiveTab('jobs'); setShowJobForm(false); setSelectedJobId(null); }}
          >
            🏢 Job Selection
          </button>
          
          <button 
            className={`btn ${activeTab === 'jobs' && showJobForm ? 'btn-primary' : 'btn-ghost'}`} 
            style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '10px 16px', fontWeight: activeTab === 'jobs' && showJobForm ? 'bold' : 'normal' }}
            onClick={() => { setActiveTab('jobs'); setShowJobForm(true); setSelectedJobId(null); }}
          >
            ✨ Post a Job
          </button>

          <button 
            className={`btn ${activeTab === 'companies' ? 'btn-primary' : 'btn-ghost'}`} 
            style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '10px 16px', fontWeight: activeTab === 'companies' ? 'bold' : 'normal', marginTop: 16 }}
            onClick={() => setActiveTab('companies')}
          >
            📂 Legacy Matches
          </button>
        </div>

        <div style={{ padding: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Signed in as <strong style={{ color: 'var(--text)' }}>{username}</strong></span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Log out</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="recruiter-content" style={{ flex: 1, overflowY: 'auto', padding: '40px 60px', background: 'var(--background)' }}>
        
        {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ===== Companies Tab (Legacy) ===== */}
        {activeTab === 'companies' && (
          <>
            <div className="panel">
              <h2>Legacy Company Resumes</h2>
              <p className="panel-desc">Create a company, then post or update its job description below.</p>

              <label>New company name</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" value={newCompanyName} onChange={e => setNewCompanyName(e.target.value)} placeholder="Acme Corp" />
                <button className="primary" style={{ marginTop: 0 }} onClick={createCompany}>Add</button>
              </div>

              <label style={{ marginTop: 20 }}>Select company</label>
              {companies.length === 0 && <div className="empty-state">No companies yet — add one above.</div>}
              {companies.map(c => (
                <div key={c.id} className={`company-list-item ${selectedCompanyId === c.id ? 'selected' : ''}`} onClick={() => setSelectedCompanyId(c.id)}>
                  <div style={{ flex: 1 }}>
                    {editingCompanyId === c.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <input type="text" value={editCompanyName} onChange={e => setEditCompanyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && updateCompanyName(c.id)} autoFocus style={{ margin: 0 }} />
                        <button className="btn btn-primary btn-sm" style={{ margin: 0 }} onClick={() => updateCompanyName(c.id)}>Save</button>
                        <button className="btn btn-ghost btn-sm" style={{ margin: 0 }} onClick={() => setEditingCompanyId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div className="company-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {c.name}
                          <button className="delete-btn" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); setEditingCompanyId(c.id); setEditCompanyName(c.name) }}>Edit Name</button>
                        </div>
                        <div className="company-jd-title">{c.current_title || 'No open role posted'}</div>
                      </>
                    )}
                  </div>
                  <button className="delete-btn" onClick={(e) => { e.stopPropagation(); deleteCompany(c.id, c.name) }} title={`Delete ${c.name}`}>Delete</button>
                </div>
              ))}
            </div>

            {selectedCompanyId && (
              <div className="panel">
                <h2>Job description</h2>
                <p className="panel-desc">Updating this immediately re-ranks every resume below — no manual resync.</p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? 'Hide Version History' : 'View Version History'}
                  </button>
                </div>

                {showHistory && (
                  <div className="jd-history" style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>Previous Versions</h3>
                    {jdHistory.length === 0 ? (
                      <div className="empty-state" style={{ padding: '20px' }}>No previous versions found.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {jdHistory.map(h => (
                          <div key={h.id} style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <strong style={{ fontSize: 13 }}>{h.title}</strong>
                              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                {new Date(h.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' }}>
                              {h.description}
                            </div>
                            <button 
                              className="btn btn-secondary btn-sm" 
                              style={{ marginTop: 8 }}
                              onClick={() => restoreJdVersion(h.id)}
                            >
                              Restore this version
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <label>Job Title</label>
                <input type="text" value={jdTitle} onChange={e => setJdTitle(e.target.value)} placeholder="e.g. Senior Frontend Engineer" />
                <label>Job Description</label>
                <textarea rows={6} value={jdDescription} onChange={e => setJdDescription(e.target.value)} placeholder="Paste the full job description here..." />
                
                <label>Application URL (Optional)</label>
                <input type="url" value={applyUrl} onChange={e => setApplyUrl(e.target.value)} placeholder="https://boards.greenhouse.io/..." />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
                  If provided, candidates will be redirected here when they click Apply.
                </div>

                <button className="primary" onClick={saveJobDescription} disabled={savingJd}>
                  {savingJd ? 'Saving & Ranking...' : 'Save & Rank Resumes'}
                </button>
              </div>
            )}

            {selectedCompanyId && jdTitle && (
              <div className="panel">
                <h2>Top Candidates</h2>
                <div className="two-col" style={{ marginBottom: 16 }}>
                  <div>
                    <label>Min ATS Score</label>
                    <input type="number" value={minScore} onChange={e => setMinScore(e.target.value)} placeholder="0-100" />
                  </div>
                  <div>
                    <label>Min Experience (years)</label>
                    <input type="number" value={minExperience} onChange={e => setMinExperience(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label>Required matched skill</label>
                    <input type="text" value={requiredSkill} onChange={e => setRequiredSkill(e.target.value)} placeholder="Python, SQL…" style={{ width: '100%' }} />
                  </div>
                </div>

                {matchesLoading && <div className="empty-state">Ranking candidates…</div>}
                {!matchesLoading && (!matches || filteredMatches(matches.results, minScore, minExperience, requiredSkill).length === 0) && (
                  <div className="empty-state">No resumes indexed yet. Candidates need to upload via the Candidate tab first.</div>
                )}
                {!matchesLoading && matches && filteredMatches(matches.results, minScore, minExperience, requiredSkill).length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Filename</th>
                        <th>ATS Score</th>
                        <th>Experience</th>
                        <th>Matched skills</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMatches(matches.results, minScore, minExperience, requiredSkill).map((r, idx) => (
                        <tr key={r.resume_id}>
                          <td>{idx + 1}</td>
                          <td>{r.filename}</td>
                          <td className="score-cell">{r.ats_score}</td>
                          <td>{r.experience_years || 0} yrs</td>
                          <td>
                            <div className="chip-row">
                              {r.matched_skills.slice(0, 6).map(s => <span key={s} className="chip matched">{s}</span>)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

        {/* ===== Jobs Tab ===== */}
        {activeTab === 'jobs' && (
          <>
            {!showJobForm && !selectedJobId && (
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2>Job Selection</h2>
                  <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setShowJobForm(true)}>
                    + Post a Job
                  </button>
                </div>

                {myJobs.length === 0 && (
                  <div className="empty-state" style={{ border: '2px dashed var(--border)', padding: 64, borderRadius: 16, marginTop: 24 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
                    <h3>Let's find your next great hire</h3>
                    <p style={{ maxWidth: 400, margin: '0 auto', color: 'var(--text-secondary)' }}>Create your first job posting to start receiving matching CoreLink scored applications instantly.</p>
                    <button className="btn btn-primary" onClick={() => setShowJobForm(true)} style={{ marginTop: 24 }}>+ Create your first job</button>
                  </div>
                )}

                {myJobs.map(job => (
                  <div key={job.id} className={`company-list-item`} onClick={() => setSelectedJobId(job.id)}>
                    <div style={{ flex: 1 }}>
                      <div className="company-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {job.title}
                        <span className={`job-card-badge ${job.remote_type}`}>
                          {job.remote_type === 'remote' ? 'Remote' : job.remote_type === 'hybrid' ? 'Hybrid' : 'On-site'}
                        </span>
                        <span className={`job-status-badge ${job.status}`}>{job.status}</span>
                      </div>
                      <div className="company-jd-title">
                        {job.location_text && `📍 ${job.location_text}`}
                        {job.salary_min && ` · 💰 ${job.currency} ${job.salary_min?.toLocaleString()} – ${job.salary_max?.toLocaleString()}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {job.status === 'open' && (
                        <button className="delete-btn" onClick={e => { e.stopPropagation(); closeJob(job.id) }}>Close</button>
                      )}
                      <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteJob(job.id) }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showJobForm && (
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2>Post a Job</h2>
                  <button className="btn btn-ghost" style={{ marginTop: 0 }} onClick={() => setShowJobForm(false)}>
                    Cancel
                  </button>
                </div>
                <div className="job-post-form">
                  <label>Job title *</label>
                  <input type="text" value={jobForm.title} onChange={e => setJobForm({...jobForm, title: e.target.value})} placeholder="Senior Mechanical Engineer" />

                  <label>Branch / Specialization *</label>
                  <select value={jobForm.branch} onChange={e => setJobForm({...jobForm, branch: e.target.value})} required style={{ width: '100%', marginBottom: 12 }}>
                    <option value="">Select branch...</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>

                  <label>Description *</label>
                  <textarea rows={4} value={jobForm.description} onChange={e => setJobForm({...jobForm, description: e.target.value})} placeholder="Describe the role, responsibilities, and team…" />

                  <div className="two-col">
                    <div>
                      <label>Min salary</label>
                      <input type="number" value={jobForm.salary_min} onChange={e => setJobForm({...jobForm, salary_min: e.target.value})} placeholder="e.g. 500000" />
                    </div>
                    <div>
                      <label>Max salary</label>
                      <input type="number" value={jobForm.salary_max} onChange={e => setJobForm({...jobForm, salary_max: e.target.value})} placeholder="e.g. 1200000" />
                    </div>
                  </div>

                  <div className="two-col">
                    <div>
                      <label>Currency</label>
                      <select value={jobForm.currency} onChange={e => setJobForm({...jobForm, currency: e.target.value})}>
                        <option value="INR">INR</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                      </select>
                    </div>
                    <div>
                      <label>Work type</label>
                      <select value={jobForm.remote_type} onChange={e => setJobForm({...jobForm, remote_type: e.target.value})}>
                        <option value="onsite">On-site</option>
                        <option value="remote">Remote</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                  </div>

                  <label>Location</label>
                  <input type="text" value={jobForm.location_text} onChange={e => setJobForm({...jobForm, location_text: e.target.value})} placeholder="e.g. Bangalore, India" />

                  <label>Required skills (comma-separated)</label>
                  <input type="text" value={jobForm.requirements} onChange={e => setJobForm({...jobForm, requirements: e.target.value})} placeholder="Python, FastAPI, Docker, …" />

                  <button className="btn btn-primary" onClick={createJob} disabled={savingJob || !jobForm.title.trim() || !jobForm.description.trim() || !jobForm.branch}>
                    {savingJob ? 'Posting…' : 'Post Job'}
                  </button>
                </div>
              </div>
            )}

            {/* Applicants Pipeline for selected job */}
            {selectedJobId && !showJobForm && applicants && (
              <div className="panel" style={{ maxWidth: 'none' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedJobId(null)}>← Back to Jobs</button>
                  <h2 style={{ margin: 0 }}>Applicants Pipeline — {applicants.job_title}</h2>
                </div>

                {applicantsLoading && <div className="empty-state">Loading applicants…</div>}

                {!applicantsLoading && applicants.applicants.length === 0 && (
                  <div className="empty-state" style={{ border: '2px dashed var(--border)', padding: 48, borderRadius: 12 }}>
                    <h3 style={{ marginBottom: 12 }}>No applications yet</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>When candidates apply to this role, their CoreLink scored profiles will automatically appear here.</p>
                  </div>
                )}

                {!applicantsLoading && applicants.applicants.length > 0 && (
                  <div className="pipeline-board" style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16 }}>
                    {pipelineStages.map(stage => {
                      const stageApplicants = applicants.applicants.filter(a => a.status === stage.id);
                      return (
                        <div key={stage.id} style={{ flex: '0 0 320px', backgroundColor: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
                          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {stage.label}
                            <span style={{ background: 'var(--border)', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{stageApplicants.length}</span>
                          </div>
                          
                          <div style={{ padding: 12, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {stageApplicants.length === 0 ? (
                              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No candidates</div>
                            ) : (
                              stageApplicants.map(a => (
                                <div key={a.application_id} style={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{a.candidate_name || '—'}</div>
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{a.resume_filename || '—'}</div>
                                  
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                    <span className="score-cell" style={{ fontSize: 14 }}>{a.ats_score} / 100</span>
                                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{new Date(a.applied_at).toLocaleDateString()}</span>
                                  </div>
                                  
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <select 
                                      id={`status-select-${a.application_id}`}
                                      defaultValue={a.status} 
                                      style={{ padding: '6px', fontSize: 12, width: '100%' }}
                                    >
                                      {pipelineStages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                    </select>
                                    <button 
                                      className="btn btn-secondary btn-sm" 
                                      style={{ width: '100%', justifyContent: 'center' }}
                                      onClick={() => {
                                        const el = document.getElementById(`status-select-${a.application_id}`);
                                        if (el && el.value !== a.status) {
                                          updateApplicantStatus(selectedJobId, a.application_id, el.value);
                                        }
                                      }}
                                    >
                                      Move
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
