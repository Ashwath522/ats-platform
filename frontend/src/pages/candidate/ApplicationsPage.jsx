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

  const [explainApp, setExplainApp] = useState(null)
  const [explainData, setExplainData] = useState(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteMsg, setDeleteMsg] = useState(null)

  const handleOpenExplainability = async (app) => {
    setExplainApp(app)
    setExplainLoading(true)
    try {
      const res = await api(`/api/candidate/jobs/applications/${app.application_id}/explainability`)
      if (res.ok) {
        const data = await res.json()
        setExplainData(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setExplainLoading(false)
    }
  }

  const handleRequestDataDeletion = async (appId) => {
    if (!window.confirm('Are you sure you want to request deletion of your recorded interview video and transcript? Your evaluation score and audit record will be preserved.')) {
      return
    }
    setDeletingId(appId)
    try {
      const res = await api(`/api/candidate/applications/${appId}/request-data-deletion`, {
        method: 'POST'
      })
      if (res.ok) {
        setDeleteMsg('Interview data purged successfully.')
        loadApplications()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="panel">
      <h2>My Applications</h2>
      {deleteMsg && (
        <div className="success-msg" style={{ marginBottom: 16, fontSize: 13 }}>
          {deleteMsg}
        </div>
      )}
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
                    <button
                      onClick={() => handleOpenExplainability(app)}
                      className="btn"
                      style={{ marginTop: 6, fontSize: 11, padding: '4px 8px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)', border: '1px solid rgba(59, 130, 246, 0.3)' }}
                    >
                      💡 Why this score?
                    </button>
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {gate.allowed ? (
                      <button
                        onClick={() => setActiveInterviewApp(app)}
                        className="btn btn-primary"
                        style={{ padding: '8px 16px', fontSize: 13, fontWeight: 'bold' }}
                      >
                        🎥 Take AI Video Interview
                      </button>
                    ) : app.interview_status === 'completed' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="chip" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                          ✓ AI Interview Completed
                        </span>
                        <button
                          onClick={() => handleRequestDataDeletion(app.application_id)}
                          disabled={deletingId === app.application_id}
                          className="btn"
                          style={{ fontSize: 11, padding: '4px 8px', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'transparent' }}
                          title="Purge recorded video and transcript data"
                        >
                          {deletingId === app.application_id ? 'Purging...' : '🗑️ Purge Video'}
                        </button>
                      </div>
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

      {/* Why This Score? Explainability Modal */}
      {explainApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 16, maxWidth: 650, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto', color: 'var(--text, #f8fafc)', position: 'relative' }}>
            <button
              onClick={() => { setExplainApp(null); setExplainData(null); }}
              style={{ position: 'absolute', top: 16, right: 16, background: '#334155', border: 'none', color: '#fff', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer' }}
            >
              ✕
            </button>

            <h3 style={{ margin: '0 0 6px 0', fontSize: 20 }}>Score Breakdown & Explainability</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: 12, color: '#94a3b8' }}>Position: <strong>{explainApp.job_title}</strong></p>

            {explainLoading ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>Loading score explainability...</div>
            ) : explainData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>
                <div style={{ padding: 12, background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 'bold', color: '#60a5fa', marginBottom: 4 }}>
                    {explainData.summary_verdict} ({explainData.ats_score}/100 Match)
                  </div>
                  <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.4 }}>{explainData.summary_text}</p>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Evaluated Signals</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {explainData.components.map((c, i) => (
                      <div key={i} style={{ padding: 10, background: 'rgba(15, 23, 42, 0.5)', border: '1px solid #334155', borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <strong>{c.name}</strong>
                          <span style={{ fontWeight: 'bold', color: c.score !== null ? '#38bdf8' : '#64748b' }}>
                            {c.score !== null ? `${c.score}%` : 'Pending'}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{c.details}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: 14 }}>Skills Matched</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {explainData.matched_skills.length > 0 ? explainData.matched_skills.map((s, i) => (
                      <span key={i} className="chip matched" style={{ fontSize: 11 }}>✓ {s}</span>
                    )) : <span style={{ color: '#64748b', fontSize: 12 }}>No direct skill matches identified yet</span>}
                  </div>
                </div>

                {explainData.missing_skills.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: 14 }}>Missing Keywords / Target Skills</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {explainData.missing_skills.map((s, i) => (
                        <span key={i} className="chip missing" style={{ fontSize: 11 }}>+ {s}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: 14 }}>How to Strengthen Your Application</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1' }}>
                    {explainData.recommendations.map((rec, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
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

