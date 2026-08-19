import React, { useEffect, useState } from 'react'
import DeepAnalysisPanel from '../components/DeepAnalysisPanel.jsx'
import FileDrop from '../components/FileDrop.jsx'
import ScoreResult from '../components/ScoreResult.jsx'

export default function CandidatePage() {
  // ---- Flow 1: generic ATS ----
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

  useEffect(() => {
    fetch('/api/candidate/branches')
      .then(r => r.json())
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
      .then(r => r.json())
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

  // ---- Flow 2: company-specific ATS ----
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)
  const [companyFile, setCompanyFile] = useState(null)
  const [companyResult, setCompanyResult] = useState(null)
  const [companyTarget, setCompanyTarget] = useState(null)
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companyError, setCompanyError] = useState(null)

  useEffect(() => {
    fetch('/api/candidate/companies')
      .then(r => r.json())
      .then(setCompanies)
      .catch(() => {})
  }, [])

  async function runCompanyCheck() {
    if (!companyFile || !selectedCompanyId) {
      setCompanyError('Select a resume and a company.')
      return
    }
    setCompanyError(null)
    setCompanyLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', companyFile)
      fd.append('company_id', selectedCompanyId)
      const res = await fetch('/api/candidate/ats-score-for-company', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Request failed')
      const data = await res.json()
      setCompanyResult(data)
      setCompanyTarget({ company_id: selectedCompanyId })
    } catch (e) {
      setCompanyError(e.message)
    } finally {
      setCompanyLoading(false)
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Generic ATS Check</h2>
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

      <div className="panel">
        <h2>Company-Specific ATS Check</h2>
        <p className="panel-desc">Pick a company and get scored against their current, live job posting.</p>

        <label>Company</label>
        {companies.length === 0 && <div className="empty-state">No companies have posted a job description yet.</div>}
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
          </div>
        ))}

        <label>Resume</label>
        <FileDrop file={companyFile} onFileSelected={setCompanyFile} />

        <button className="primary" onClick={runCompanyCheck} disabled={companyLoading}>
          {companyLoading ? 'Scanning…' : 'Run company ATS check'}
        </button>
        {companyError && <div className="error-msg">{companyError}</div>}

        <ScoreResult result={companyResult} title={companyResult?.job_title} />
        <DeepAnalysisPanel result={companyResult} target={companyTarget} />
      </div>
    </div>
  )
}
