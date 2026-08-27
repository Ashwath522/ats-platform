import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import { Link } from 'react-router-dom'

export default function ApplicationsPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadingId, setUploadingId] = useState(null)
  const [uploadError, setUploadError] = useState(null)

  const loadApplications = useCallback(() => {
    api('/api/candidate/jobs/applications/mine')
      .then(res => { if (res.ok) return res.json() })
      .then(data => {
        if (data) setApplications(data.applications || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [api])

  useEffect(() => {
    loadApplications()
  }, [loadApplications])

  const handleFileUpload = async (e, appId) => {
    const file = e.target.files[0]
    if (!file) return

    setUploadingId(appId)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('application_id', appId)

    try {
      const res = await api('/api/candidate/score-project', {
        method: 'POST',
        body: formData
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      
      // Reload applications to get updated status and scores
      loadApplications()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploadingId(null)
    }
  }

  const statusSteps = ['ats_check', 'repo_verification', 'automated_interview', 'shortlisted', 'rejected']

  const statusLabels = {
    'ats_check': 'ATS Check',
    'repo_verification': 'Repo Verification',
    'automated_interview': 'Automated Interview',
    'shortlisted': 'Shortlisted',
    'rejected': 'Rejected'
  }

  return (
    <div className="panel">
      <h2>My Applications</h2>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : applications.length === 0 ? (
        <div className="empty-state">
          You haven't applied to any jobs yet.<br/>
          <Link to="/candidate/jobs" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-block' }}>Discover Jobs</Link>
        </div>
      ) : (
        <div className="applications-list">
          {applications.map(app => (
            <div key={app.application_id} className="application-card" style={{
              border: '1px solid var(--border)', padding: 16, borderRadius: 8, marginBottom: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0' }}>{app.job_title}</h3>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>{app.job_location || 'Remote'}</p>
                  
                  {uploadError && uploadingId === app.application_id && (
                    <div className="error-msg" style={{ marginTop: 8, fontSize: 12 }}>{uploadError}</div>
                  )}

                  {app.status === 'ats_check' && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 12, margin: '0 0 8px 0' }}>Upload a project zip/pdf/code to proceed:</p>
                      {uploadingId === app.application_id ? (
                        <div style={{ fontSize: 12, color: 'var(--primary-color)' }}>
                          Analyzing your project - this can take up to 30 seconds...
                        </div>
                      ) : (
                        <input 
                          type="file" 
                          onChange={(e) => handleFileUpload(e, app.application_id)}
                          style={{ fontSize: 12 }}
                          accept=".pdf,.docx,.zip,.txt,.py,.js,.jsx,.ts,.tsx"
                          disabled={uploadingId !== null}
                        />
                      )}
                    </div>
                  )}

                  {/* Show final score if scored or pending */}
                  {app.status !== 'ats_check' && app.status !== 'rejected' && (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
                      {app.project_score == null ? (
                        <div style={{ color: 'var(--text-secondary)' }}>Scores pending...</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: app.project_summary ? 8 : 0 }}>
                            <div><strong>ATS:</strong> {app.ats_score}/100</div>
                            <div><strong>Project:</strong> {app.project_score}/100</div>
                            <div style={{ color: 'var(--success)', fontWeight: 'bold' }}>Final: {app.final_score}/100</div>
                            {app.priority_level && (
                              <div className={`chip priority-${app.priority_level.toLowerCase()}`} style={{ padding: '2px 8px', fontSize: 11 }}>
                                {app.priority_level} Priority
                              </div>
                            )}
                            {app.api_used && (
                              <div className="chip" style={{ padding: '2px 8px', fontSize: 11, backgroundColor: 'var(--bg-highlight)' }}>
                                Scored via: {app.api_used}
                              </div>
                            )}
                            {app.parse_method && (
                              <div className="chip" style={{ padding: '2px 8px', fontSize: 11, backgroundColor: 'var(--bg-highlight)' }}>
                                Parsed as: {app.parse_method}
                              </div>
                            )}
                          </div>
                          {app.project_summary && (
                            <div style={{ color: 'var(--text-secondary)', fontSize: 12, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {app.project_summary}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="chip matched" style={{ fontWeight: 'bold' }}>{app.ats_score}/100 Match</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                    Applied: {new Date(app.applied_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="status-timeline" style={{ marginTop: 24, display: 'flex', alignItems: 'center' }}>
                {statusSteps.map((step, i) => {
                  if (app.status === 'rejected' && step === 'shortlisted') return null
                  if (app.status !== 'rejected' && step === 'rejected') return null
                  
                  const isCurrent = app.status === step
                  const stepIndex = statusSteps.indexOf(app.status)
                  const isPassed = stepIndex >= i
                  const isRejected = app.status === 'rejected'

                  return (
                    <React.Fragment key={step}>
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1,
                        color: isPassed ? (isRejected ? 'var(--error)' : 'var(--primary)') : 'var(--border)'
                      }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: '50%',
                          backgroundColor: isPassed ? (isRejected ? 'var(--error)' : 'var(--primary)') : 'transparent',
                          border: `2px solid ${isPassed ? (isRejected ? 'var(--error)' : 'var(--primary)') : 'var(--border)'}`,
                          marginBottom: 8
                        }} />
                        <span style={{ fontSize: 12, textTransform: 'capitalize', fontWeight: isCurrent ? 'bold' : 'normal' }}>
                          {statusLabels[step] || step}
                        </span>
                      </div>
                      {i < statusSteps.length - 1 && (
                        <div style={{
                          flex: 1, height: 2,
                          backgroundColor: isPassed && i < stepIndex ? (isRejected ? 'var(--error)' : 'var(--primary)') : 'var(--border)',
                          margin: '0 -20px', position: 'relative', top: -12
                        }} />
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
