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

  return (
    <div>
      <Onboarding type="recruiter" />
      <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Signed in as <strong style={{ color: 'var(--text)' }}>{username}</strong></span>
        <button className="btn btn-secondary btn-sm" onClick={onLogout}>Log out</button>
      </div>

      {/* Tab navigation */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab-btn ${activeTab === 'companies' ? 'active' : ''}`} onClick={() => setActiveTab('companies')}>Companies & JDs</button>
        <button className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`} onClick={() => setActiveTab('jobs')}>Job Postings</button>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ===== Companies Tab ===== */}
      {activeTab === 'companies' && (
        <>
          <div className="panel">
            <h2>Companies</h2>
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
                  {showHistory ? 'Hide JD History' : 'Show JD History'}
                </button>
              </div>

              {showHistory && jdHistory.length > 0 && (
                <div style={{ marginBottom: 20, padding: 15, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <h3 style={{ marginTop: 0, fontSize: 14 }}>Past Job Descriptions</h3>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {jdHistory.map((jd, idx) => (
                      <div key={jd.id} style={{ padding: '8px 0', borderBottom: idx < jdHistory.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{jd.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{new Date(jd.updated_at).toLocaleString()}</div>
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{jd.description}</div>
                        <button style={{ marginTop: 8, fontSize: 12, padding: '4px 8px' }} onClick={() => { setJdTitle(jd.title); setJdDescription(jd.description); setApplyUrl(jd.apply_url || ''); setShowHistory(false) }}>Use this text</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label>Job title</label>
              <input type="text" value={jdTitle} onChange={e => setJdTitle(e.target.value)} placeholder="Senior Backend Engineer" />

              <label>Job description</label>
              <textarea rows={5} value={jdDescription} onChange={e => setJdDescription(e.target.value)} placeholder="Paste or write the job description…" />

              <label>Apply link</label>
              <input type="text" value={applyUrl} onChange={e => setApplyUrl(e.target.value)} placeholder="https://company.com/careers/job-id" />

              <button className="btn btn-primary" onClick={saveJobDescription} disabled={savingJd}>
                {savingJd ? 'Saving…' : 'Save & re-rank candidates'}
              </button>
            </div>
          )}

          {selectedCompanyId && (
            <div className="panel">
              <h2>Matching resumes {matches?.job_title ? `— ${matches.job_title}` : ''}</h2>
              <p className="panel-desc">Ranked by ATS score against the current job description.</p>

              <div className="filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div>
                  <label>Minimum ATS score</label>
                  <input type="number" min="0" max="100" value={minScore} onChange={e => setMinScore(Number(e.target.value) || 0)} style={{ width: '100%' }} />
                </div>
                <div>
                  <label>Minimum experience</label>
                  <input type="number" min="0" value={minExperience} onChange={e => setMinExperience(Number(e.target.value) || 0)} style={{ width: '100%' }} />
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
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Your Job Postings</h2>
              <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setShowJobForm(!showJobForm)}>
                {showJobForm ? 'Cancel' : '+ Post a Job'}
              </button>
            </div>

            {showJobForm && (
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
            )}

            {myJobs.length === 0 && !showJobForm && (
              <div className="empty-state" style={{ border: '2px dashed var(--border)', padding: 64, borderRadius: 16, marginTop: 24 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
                <h3>Let's find your next great hire</h3>
                <p style={{ maxWidth: 400, margin: '0 auto', color: 'var(--text-secondary)' }}>Create your first job posting to start receiving matching CoreLink scored applications instantly.</p>
                <button className="btn btn-primary" onClick={() => setShowJobForm(true)} style={{ marginTop: 24 }}>+ Create your first job</button>
              </div>
            )}

            {myJobs.map(job => (
              <div key={job.id} className={`company-list-item ${selectedJobId === job.id ? 'selected' : ''}`} onClick={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}>
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

          {/* Applicants for selected job */}
          {selectedJobId && applicants && (
            <div className="panel">
              <h2>Applicants — {applicants.job_title}</h2>
              <p className="panel-desc">{applicants.applicant_count} applicant{applicants.applicant_count !== 1 ? 's' : ''}, ranked by ATS score.</p>

              {applicantsLoading && <div className="empty-state">Loading applicants…</div>}

              {!applicantsLoading && applicants.applicants.length === 0 && (
                <div className="empty-state" style={{ border: '2px dashed var(--border)', padding: 48, borderRadius: 12 }}>
                  <h3 style={{ marginBottom: 12 }}>No applications yet</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>When candidates apply to this role, their CoreLink scored profiles will automatically appear here.</p>
                </div>
              )}

              {!applicantsLoading && applicants.applicants.length > 0 && (
                <table>
                  <thead><tr><th>Rank</th><th>Candidate</th><th>Resume</th><th>ATS Score</th><th>Status</th><th>Matched</th><th>Missing</th><th>Applied</th></tr></thead>
                  <tbody>
                    {applicants.applicants.map((a, idx) => (
                      <tr key={a.application_id}>
                        <td>{idx + 1}</td>
                        <td>{a.candidate_name || '—'}</td>
                        <td>{a.resume_filename || '—'}</td>
                        <td className="score-cell">{a.ats_score}</td>
                        <td style={{ minWidth: '180px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <select 
                              id={`status-select-${a.application_id}`}
                              defaultValue={a.status} 
                              style={{ padding: '4px 8px', fontSize: 12, flex: 1 }}
                            >
                              <option value="applied">Applied</option>
                              <option value="reviewed">Reviewed</option>
                              <option value="shortlisted">Shortlisted</option>
                              <option value="rejected">Rejected</option>
                            </select>
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => {
                                const el = document.getElementById(`status-select-${a.application_id}`);
                                if (el && el.value !== a.status) {
                                  updateApplicantStatus(selectedJobId, a.application_id, el.value);
                                }
                              }}
                            >
                              Update
                            </button>
                          </div>
                        </td>
                        <td><div className="chip-row">{a.matched_skills.slice(0, 4).map(s => <span key={s} className="chip matched">{s}</span>)}</div></td>
                        <td><div className="chip-row">{a.missing_skills.slice(0, 4).map(s => <span key={s} className="chip missing">{s}</span>)}</div></td>
                        <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{new Date(a.applied_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
