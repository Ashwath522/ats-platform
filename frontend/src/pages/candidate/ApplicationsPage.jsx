import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import { Link } from 'react-router-dom'
import { CandidateStepper } from '../../components/CandidateStepper.jsx'
import { AIInterviewModal } from '../../components/AIInterviewModal.jsx'
import { canTakeInterview } from '../../lib/interview-access.ts'

export default function ApplicationsPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadingId, setUploadingId] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [activeInterviewApp, setActiveInterviewApp] = useState(null)

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
      
      loadApplications()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploadingId(null)
    }
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
          {applications.map(app => {
            const gate = canTakeInterview(app)

            return (
              <div key={app.application_id} className="application-card" style={{
                border: '1px solid var(--border)', padding: 20, borderRadius: 12, marginBottom: 20, background: 'var(--bg-card)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{app.job_title}</h3>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>{app.job_location || 'Remote'}</p>
                    
                    {uploadError && uploadingId === app.application_id && (
                      <div className="error-msg" style={{ marginTop: 8, fontSize: 12 }}>{uploadError}</div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div className="chip matched" style={{ fontWeight: 'bold' }}>{app.ats_score}/100 Match</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      Applied: {new Date(app.applied_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Candidate Progression Stepper */}
                <CandidateStepper
                  status={app.status}
                  repoScore={app.repo_match_score ?? app.project_score}
                  interviewStatus={app.interview_status}
                />

                {/* Upload Project Section */}
                {(app.status === 'ats_check' || app.status === 'shortlisted') && !app.repo_match_score && !app.project_score && (
                  <div style={{ marginTop: 16, padding: 14, background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 8 }}>
                    <p style={{ fontSize: 13, margin: '0 0 8px 0', fontWeight: 'bold' }}>
                      Step 2: Upload Project / GitHub Repo for Verification
                    </p>
                    {uploadingId === app.application_id ? (
                      <div style={{ fontSize: 12, color: 'var(--primary-color)' }}>
                        Analyzing your project - evaluating tech stack and code depth...
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

                {/* Interview Gatekeeper & Action Button */}
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    {app.project_score != null && (
                      <div style={{ fontSize: 13 }}>
                        <strong>Repo Match Score:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{app.project_score}%</span>
                      </div>
                    )}
                  </div>

                  <div>
                    {gate.allowed ? (
                      <button
                        onClick={() => setActiveInterviewApp(app)}
                        className="btn btn-primary"
                        style={{ padding: '8px 16px', fontSize: 13, fontWeight: 'bold' }}
                      >
                        🎥 Take AI Video Interview
                      </button>
                    ) : app.interview_status === 'completed' ? (
                      <span className="chip" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                        ✓ AI Interview Completed
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        🔒 {gate.reason}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* AI Interview Modal */}
      {activeInterviewApp && (
        <AIInterviewModal
          applicationId={activeInterviewApp.application_id}
          jobTitle={activeInterviewApp.job_title}
          candidateName={activeInterviewApp.candidate_name || 'Candidate'}
          onClose={() => setActiveInterviewApp(null)}
          onCompleted={() => {
            setActiveInterviewApp(null)
            loadApplications()
          }}
        />
      )}
    </div>
  )
}

