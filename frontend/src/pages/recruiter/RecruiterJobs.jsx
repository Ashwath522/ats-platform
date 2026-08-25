import React, { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'

export default function RecruiterJobs() {
  const { api } = useOutletContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlJobId = searchParams.get('id')

  const [myJobs, setMyJobs] = useState([])
  const [branches, setBranches] = useState([])
  const [showJobForm, setShowJobForm] = useState(false)
  const [jobForm, setJobForm] = useState({
    title: '', description: '', branch: '', salary_min: '', salary_max: '', currency: 'INR',
    location_text: '', requirements: '', remote_type: 'onsite',
  })
  const [savingJob, setSavingJob] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState(urlJobId ? parseInt(urlJobId, 10) : null)
  const [applicants, setApplicants] = useState(null)
  const [applicantsLoading, setApplicantsLoading] = useState(false)
  const [error, setError] = useState(null)

  const pipelineStages = [
    { id: 'ats_check', label: 'ATS Check' },
    { id: 'repo_verification', label: 'Repo Verification' },
    { id: 'automated_interview', label: 'Automated Interview' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'rejected', label: 'Rejected' }
  ]

  useEffect(() => {
    fetch('/api/candidate/branches')
      .then(res => res.json())
      .then(data => setBranches(data || []))
      .catch(() => {})
    refreshJobs()
  }, [])

  useEffect(() => {
    if (selectedJobId) {
      loadApplicants(selectedJobId)
    } else {
      setApplicants(null)
    }
  }, [selectedJobId])

  async function refreshJobs() {
    try {
      const res = await api('/api/recruiter/jobs')
      if (res.ok) setMyJobs(await res.json())
    } catch (e) { setError(e.message) }
  }

  async function createJob() {
    setError(null)
    setSavingJob(true)
    try {
      const fd = new FormData()
      Object.keys(jobForm).forEach(k => {
        if (jobForm[k]) fd.append(k, jobForm[k])
      })
      const res = await api('/api/recruiter/jobs', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed to post job')
      await refreshJobs()
      setShowJobForm(false)
      setJobForm({ title: '', description: '', branch: '', salary_min: '', salary_max: '', currency: 'INR', location_text: '', requirements: '', remote_type: 'onsite' })
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingJob(false)
    }
  }

  async function closeJob(jobId) {
    try {
      await api(`/api/recruiter/jobs/${jobId}/close`, { method: 'POST' })
      await refreshJobs()
    } catch (e) { setError(e.message) }
  }

  async function deleteJob(jobId) {
    if (!window.confirm('Delete this job entirely?')) return
    try {
      await api(`/api/recruiter/jobs/${jobId}`, { method: 'DELETE' })
      if (selectedJobId === jobId) setSelectedJobId(null)
      await refreshJobs()
    } catch (e) { setError(e.message) }
  }

  async function loadApplicants(jobId) {
    setApplicantsLoading(true)
    try {
      const res = await api(`/api/recruiter/jobs/${jobId}/applicants`)
      if (res.ok) setApplicants(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setApplicantsLoading(false)
    }
  }

  async function updateApplicantStatus(jobId, appId, newStatus) {
    try {
      const fd = new FormData()
      fd.append('status', newStatus)
      const res = await api(`/api/recruiter/jobs/${jobId}/applicants/${appId}/status`, { method: 'PUT', body: fd })
      if (res.ok) {
        setApplicants(prev => {
          if (!prev) return prev
          return {
            ...prev,
            applicants: prev.applicants.map(a => a.application_id === appId ? { ...a, status: newStatus } : a)
          }
        })
      }
    } catch (e) {
      alert('Failed to update status')
    }
  }

  return (
    <div className="recruiter-jobs">
      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

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
            <div key={job.id} className="company-list-item" onClick={() => { setSelectedJobId(job.id); setSearchParams({ id: job.id }) }}>
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

      {selectedJobId && !showJobForm && applicants && (
        <div className="panel" style={{ maxWidth: 'none' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedJobId(null); setSearchParams({}) }}>← Back to Jobs</button>
            <h2 style={{ margin: 0 }}>Pipeline — {applicants.job_title}</h2>
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
    </div>
  )
}
