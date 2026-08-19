import React, { useEffect, useState } from 'react'
import DeepAnalysisPanel from '../components/DeepAnalysisPanel.jsx'
import FileDrop from '../components/FileDrop.jsx'
import ScoreResult from '../components/ScoreResult.jsx'

export default function CandidatePage() {
  const [branches, setBranches] = useState([])
  const [roles, setRoles] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [useCustomJd, setUseCustomJd] = useState(false)
  const [genericFile, setGenericFile] = useState(null)
  const [jobDescText, setJobDescText] = useState('')
  const [genericResult, setGenericResult] = useState(null)
  const [genericTarget, setGenericTarget] = useState(null)
  const [genericLoading, setGenericLoading] = useState(false)
  const [genericError, setGenericError] = useState(null)
  const [companyScores, setCompanyScores] = useState({})

  useEffect(() => {
    fetch('/api/candidate/branches')
      .then(r => r.ok ? r.json() : [])
      .then(setBranches)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedBranch) {
      setRoles([])
      setSelectedRoleId('')
      return
    }
    fetch(`/api/candidate/roles?branch=${encodeURIComponent(selectedBranch)}`)
      .then(r => r.ok ? r.json() : [])
      .then(items => {
        setRoles(items)
        setSelectedRoleId(items[0]?.id || '')
        setUseCustomJd(false)
      })
      .catch(() => {})
  }, [selectedBranch])

  async function runGenericCheck() {
    if (!genericFile || (!useCustomJd && !selectedRoleId) || (useCustomJd && !jobDescText.trim())) {
      setGenericError('Select a resume and choose a role or paste a job description.')
      return
    }
    setGenericError(null)
    setGenericLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', genericFile)
      if (useCustomJd) fd.append('job_description', jobDescText)
      else fd.append('role_id', selectedRoleId)
      const res = await fetch('/api/candidate/ats-score', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Request failed')
      const data = await res.json()
      setGenericResult(data)
      setGenericTarget(useCustomJd ? { job_description: jobDescText } : { role_id: selectedRoleId })
    } catch (e) {
      setGenericError(e.message)
    } finally {
      setGenericLoading(false)
    }
  }

  const [companies, setCompanies] = useState([])
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companyError, setCompanyError] = useState(null)

  useEffect(() => {
    fetch('/api/candidate/companies')
      .then(r => r.ok ? r.json() : [])
      .then(setCompanies)
      .catch(() => {})
  }, [])

  async function runCompanyCheck(companyId) {
    if (!genericResult?.resume_id) {
      setCompanyError('Run your ATS check first.')
      return
    }
    setCompanyError(null)
    setCompanyLoading(true)
    try {
      const fd = new FormData()
      fd.append('resume_id', genericResult.resume_id)
      fd.append('company_id', companyId)
      const res = await fetch('/api/candidate/ats-score-existing-resume-for-company', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Request failed')
      const data = await res.json()
      setCompanyScores(prev => ({ ...prev, [companyId]: data }))
    } catch (e) {
      setCompanyError(e.message)
    } finally {
      setCompanyLoading(false)
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Resume ATS Check</h2>
        <p className="panel-desc">Pick your branch and role, or paste a custom job description.</p>

        <label>Resume</label>
        <FileDrop file={genericFile} onFileSelected={setGenericFile} />

        <label>Branch</label>
        <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}>
          <option value="">Select branch</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>

        <label>Role</label>
        <select
          value={useCustomJd ? 'custom' : selectedRoleId}
          onChange={e => {
            setUseCustomJd(e.target.value === 'custom')
            if (e.target.value !== 'custom') setSelectedRoleId(e.target.value)
          }}
          disabled={!selectedBranch}
        >
          {roles.map(role => <option key={role.id} value={role.id}>{role.title}</option>)}
          <option value="custom">Custom - paste your own JD</option>
        </select>

        {useCustomJd && (
          <>
            <label>Job description</label>
            <textarea rows={5} value={jobDescText} onChange={e => setJobDescText(e.target.value)} placeholder="Paste the job description here…" />
          </>
        )}

        <button className="primary" onClick={runGenericCheck} disabled={genericLoading}>
          {genericLoading ? 'Scanning…' : 'Run ATS check'}
        </button>
        {genericError && <div className="error-msg">{genericError}</div>}

        <ScoreResult result={genericResult} title={genericResult?.job_title || 'Generic match'} />
        <DeepAnalysisPanel result={genericResult} target={genericTarget} />
      </div>

      {genericResult && (
        <div className="panel">
          <h2>Company Matches</h2>
          <p className="panel-desc">Score the same resume against live company postings, then open the apply link.</p>

          {companies.length === 0 && <div className="empty-state">No companies have posted a job description yet.</div>}
          {companyError && <div className="error-msg">{companyError}</div>}
          {companies.map(c => {
            const score = companyScores[c.id]
            return (
              <div key={c.id} className="company-match-item">
                <div>
                  <div className="company-name">{c.name}</div>
                  <div className="company-jd-title">{c.current_title || 'No open role posted'}</div>
                </div>
                <div className="company-actions">
                  {score && <span className="score-pill">{score.ats_score}</span>}
                  {c.apply_url && <a className="apply-link" href={c.apply_url} target="_blank" rel="noreferrer">Apply</a>}
                  <button className="secondary" onClick={() => runCompanyCheck(c.id)} disabled={companyLoading || !c.current_title}>
                    {companyLoading ? 'Scoring…' : 'Score'}
                  </button>
                </div>
                {score && (
                  <div className="company-score-detail">
                    <ScoreResult result={score} title={score.job_title} />
                    <DeepAnalysisPanel result={score} target={{ company_id: c.id }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
