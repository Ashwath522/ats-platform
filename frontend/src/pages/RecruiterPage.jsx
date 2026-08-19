import React, { useEffect, useState } from 'react'

const TOKEN_KEY = 'ats_recruiter_token'
const USERNAME_KEY = 'ats_recruiter_username'

export default function RecruiterPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [username, setUsername] = useState(() => localStorage.getItem(USERNAME_KEY))

  function handleLogin(newToken, newUsername) {
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USERNAME_KEY, newUsername)
    setToken(newToken)
    setUsername(newUsername)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USERNAME_KEY)
    setToken(null)
    setUsername(null)
  }

  if (!token) {
    return <AuthPanel onLogin={handleLogin} />
  }

  return <RecruiterDashboard token={token} username={username} onLogout={handleLogout} onAuthExpired={handleLogout} />
}

function AuthPanel({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'register'
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
      const endpoint = mode === 'login' ? '/api/recruiter/auth/login' : '/api/recruiter/auth/register'
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      onLogin(data.access_token, data.username)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel">
      <h2>{mode === 'login' ? 'Recruiter Login' : 'Create Recruiter Account'}</h2>
      <p className="panel-desc">
        {mode === 'login'
          ? 'Sign in to manage companies, post job descriptions, and view ranked candidates.'
          : 'Set up an account to start posting job descriptions.'}
      </p>

      <label>Username</label>
      <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. jordan" />

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
  )
}

function RecruiterDashboard({ token, username, onLogout, onAuthExpired }) {
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)

  const [newCompanyName, setNewCompanyName] = useState('')
  const [jdTitle, setJdTitle] = useState('')
  const [jdDescription, setJdDescription] = useState('')
  const [applyUrl, setApplyUrl] = useState('')
  const [savingJd, setSavingJd] = useState(false)

  const [matches, setMatches] = useState(null)
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [error, setError] = useState(null)
  const [minScore, setMinScore] = useState(0)
  const [minExperience, setMinExperience] = useState(0)
  const [requiredSkill, setRequiredSkill] = useState('')

  // Wraps fetch with the Authorization header, and logs the recruiter out if the
  // token has expired/is invalid (401) rather than showing a confusing error.
  async function authedFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      onAuthExpired()
      throw new Error('Session expired — please log in again.')
    }
    return res
  }

  async function refreshCompanies() {
    try {
      const res = await authedFetch('/api/recruiter/companies')
      if (!res.ok) throw new Error('Could not load companies')
      setCompanies(await res.json())
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { refreshCompanies() }, [])

  async function createCompany() {
    if (!newCompanyName.trim()) return
    try {
      const fd = new FormData()
      fd.append('name', newCompanyName)
      const res = await authedFetch('/api/recruiter/companies', { method: 'POST', body: fd })
      const c = await res.json()
      setNewCompanyName('')
      await refreshCompanies()
      setSelectedCompanyId(c.id)
    } catch (e) {
      setError(e.message)
    }
  }

  async function deleteCompany(companyId, companyName) {
    if (!window.confirm(`Delete "${companyName}"? This removes its job description too. This can't be undone.`)) {
      return
    }
    setError(null)
    try {
      const res = await authedFetch(`/api/recruiter/companies/${companyId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to delete company')
      if (selectedCompanyId === companyId) {
        setSelectedCompanyId(null)
        setMatches(null)
      }
      await refreshCompanies()
    } catch (e) {
      setError(e.message)
    }
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
      const res = await authedFetch(`/api/recruiter/companies/${selectedCompanyId}/job-description`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to save')
      await refreshCompanies()
      // Auto-refresh matches right after the JD updates — this is the "automatic" part.
      await loadMatches(selectedCompanyId)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingJd(false)
    }
  }

  async function loadMatches(companyId) {
    setMatchesLoading(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/recruiter/companies/${companyId}/matching-resumes`)
      if (!res.ok) throw new Error((await res.json()).detail || 'No matches yet')
      setMatches(await res.json())
    } catch (e) {
      setError(e.message)
      setMatches(null)
    } finally {
      setMatchesLoading(false)
    }
  }

  useEffect(() => {
    if (selectedCompanyId) loadMatches(selectedCompanyId)
  }, [selectedCompanyId])

  return (
    <div>
      <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Signed in as <strong style={{ color: 'var(--text)' }}>{username}</strong></span>
        <button className="primary" style={{ marginTop: 0, padding: '8px 14px' }} onClick={onLogout}>Log out</button>
      </div>

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
          <div
            key={c.id}
            className={`company-list-item ${selectedCompanyId === c.id ? 'selected' : ''}`}
            onClick={() => setSelectedCompanyId(c.id)}
          >
            <div>
              <div className="company-name">{c.name}</div>
              <div className="company-jd-title">{c.current_title || 'No open role posted'}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); deleteCompany(c.id, c.name) }}
              title={`Delete ${c.name}`}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {selectedCompanyId && (
        <div className="panel">
          <h2>Job description</h2>
          <p className="panel-desc">Updating this immediately re-ranks every resume below — no manual resync.</p>

          <label>Job title</label>
          <input type="text" value={jdTitle} onChange={e => setJdTitle(e.target.value)} placeholder="Senior Backend Engineer" />

          <label>Job description</label>
          <textarea rows={5} value={jdDescription} onChange={e => setJdDescription(e.target.value)} placeholder="Paste or write the job description…" />

          <label>Apply link</label>
          <input type="text" value={applyUrl} onChange={e => setApplyUrl(e.target.value)} placeholder="https://company.com/careers/job-id" />

          <button className="primary" onClick={saveJobDescription} disabled={savingJd}>
            {savingJd ? 'Saving…' : 'Save & re-rank candidates'}
          </button>
          {error && <div className="error-msg">{error}</div>}
        </div>
      )}

      {selectedCompanyId && (
        <div className="panel">
          <h2>Matching resumes {matches?.job_title ? `— ${matches.job_title}` : ''}</h2>
          <p className="panel-desc">Ranked by ATS score against the current job description.</p>

          <div className="filter-grid">
            <div>
              <label>Minimum ATS score</label>
              <input type="number" min="0" max="100" value={minScore} onChange={e => setMinScore(Number(e.target.value) || 0)} />
            </div>
            <div>
              <label>Minimum experience</label>
              <input type="number" min="0" value={minExperience} onChange={e => setMinExperience(Number(e.target.value) || 0)} />
            </div>
            <div>
              <label>Required matched skill</label>
              <input type="text" value={requiredSkill} onChange={e => setRequiredSkill(e.target.value)} placeholder="Python, SolidWorks…" />
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
    </div>
  )
}

function filteredMatches(results, minScore, minExperience, requiredSkill) {
  const skill = requiredSkill.trim().toLowerCase()
  return results.filter(result => {
    const hasSkill = !skill || result.matched_skills.some(item => item.toLowerCase().includes(skill))
    return result.ats_score >= minScore && (result.experience_years || 0) >= minExperience && hasSkill
  })
}
