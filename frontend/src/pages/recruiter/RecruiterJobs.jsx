import React, { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Plus, MapPin, Briefcase } from 'lucide-react'

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
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>Jobs</h1>
            <button className="btn btn-primary" onClick={() => setShowJobForm(true)}>
              <Plus size={16} style={{ marginRight: 6 }} /> Post a Job
            </button>
          </div>

          {myJobs.length === 0 && (
            <div className="empty-state panel" style={{ border: '2px dashed var(--border)', padding: 64, borderRadius: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👋</div>
              <h3>Let's find your next great hire</h3>
              <p style={{ maxWidth: 400, margin: '0 auto', color: 'var(--text-secondary)' }}>Create your first job posting to start receiving matching CoreLink scored applications instantly.</p>
              <button className="btn btn-primary" onClick={() => setShowJobForm(true)} style={{ marginTop: 24 }}>
                <Plus size={16} style={{ marginRight: 6 }} /> Create your first job
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {myJobs.map(job => (
              <div key={job.id} className="panel" style={{ padding: 20, cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', opacity: job.status === 'closed' ? 0.6 : 1 }} onClick={() => { setSelectedJobId(job.id); setSearchParams({ id: job.id }) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 18, paddingRight: 32 }}>{job.title}</h3>
                  <div style={{ position: 'absolute', top: 20, right: 20 }}>
                    {job.status === 'open' ? (
                      <span style={{ fontSize: 11, background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '4px 8px', borderRadius: 12, fontWeight: 'bold', textTransform: 'uppercase' }}>Active</span>
                    ) : (
                      <span style={{ fontSize: 11, background: 'rgba(156, 163, 175, 0.1)', color: '#9ca3af', padding: '4px 8px', borderRadius: 12, fontWeight: 'bold', textTransform: 'uppercase' }}>Closed</span>
                    )}
                  </div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={14} /> {job.location_text || 'Location not specified'} ({job.remote_type})</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Briefcase size={14} /> {job.salary_min ? `${job.currency} ${job.salary_min.toLocaleString()} - ${job.salary_max.toLocaleString()}` : 'Salary not specified'}</div>
                </div>

                <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  {job.status === 'open' && (
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: 8 }} onClick={e => { e.stopPropagation(); closeJob(job.id) }}>Close Job</button>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: 8, color: 'var(--error)' }} onClick={e => { e.stopPropagation(); deleteJob(job.id) }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 40px', borderBottom: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: 16, alignItems: 'center', background: 'rgba(255,255,255,0.4)' }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setSelectedJobId(null); setSearchParams({}) }}>← Back to Jobs</button>
            <h2 style={{ margin: 0 }}>Pipeline — {applicants.job_title}</h2>
          </div>

          <div style={{ flex: 1, padding: '32px 40px', overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
            {applicantsLoading && <div className="empty-state" style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 16 }}>Loading applicants…</div>}

            {!applicantsLoading && applicants.applicants.length === 0 && (
              <div className="empty-state" style={{ background: 'rgba(255,255,255,0.6)', padding: 64, borderRadius: 16, border: '1px solid rgba(255,255,255,0.5)', boxShadow: '0 8px 32px rgba(0,0,0,0.05)' }}>
                <h3 style={{ marginBottom: 12 }}>No applications yet</h3>
                <p style={{ color: 'var(--text-secondary)' }}>When candidates apply to this role, their CoreLink scored profiles will automatically appear here.</p>
              </div>
            )}

            {!applicantsLoading && applicants.applicants.length > 0 && (
              <div className="pipeline-board" style={{ display: 'flex', gap: 24, flex: 1, minWidth: 'min-content' }}>
                {pipelineStages.map(stage => {
                  const stageApplicants = applicants.applicants.filter(a => a.status === stage.id);
                  return (
                    <div key={stage.id} style={{ flex: '0 0 320px', background: 'rgba(255, 255, 255, 0.5)', backdropFilter: 'blur(10px)', borderRadius: 16, border: '1px solid rgba(255, 255, 255, 0.8)', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                      <div style={{ padding: '20px', borderBottom: '1px solid rgba(0,0,0,0.05)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.6)' }}>
                        {stage.label}
                        <span style={{ background: 'var(--primary)', color: 'white', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>{stageApplicants.length}</span>
                      </div>
                      
                      <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {stageApplicants.length === 0 ? (
                          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No candidates</div>
                        ) : (
                          stageApplicants.map(a => (
                            <div key={a.application_id} style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,1)', borderRadius: 12, padding: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                              <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 15 }}>{a.candidate_name || '—'}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>{a.resume_filename || '—'}</div>
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                                  <strong>ATS:</strong> {a.ats_score} &middot; <strong>Proj:</strong> {a.project_score ?? '—'} &middot; <strong style={{ color: 'var(--success)' }}>Final: {a.final_score ?? '—'}</strong>
                                </div>
                                {a.priority_level && (
                                  <div className={`chip priority-${a.priority_level.toLowerCase()}`} style={{ padding: '2px 6px', fontSize: 10, marginLeft: 8 }}>
                                    {a.priority_level}
                                  </div>
                                )}
                                {a.api_used && (
                                  <div className="chip" style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4, backgroundColor: 'var(--bg-highlight)' }}>
                                    {a.api_used}
                                  </div>
                                )}
                                {a.parse_method && (
                                  <div className="chip" style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4, backgroundColor: 'var(--bg-highlight)' }}>
                                    {a.parse_method}
                                  </div>
                                )}
                              </div>
                              
                              {a.project_summary && (
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {a.project_summary}
                                </div>
                              )}
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Applied: {new Date(a.applied_at).toLocaleDateString()}</span>
                              </div>
                              
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <select 
                                  id={`status-select-${a.application_id}`}
                                  defaultValue={a.status} 
                                  style={{ padding: '8px', fontSize: 13, width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
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
                                  Move Candidate
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
        </div>
      )}
    </div>
  )
}
