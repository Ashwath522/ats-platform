import React, { useEffect, useState } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import { Link } from 'react-router-dom'

export default function ApplicationsPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/candidate/jobs/applications/mine')
      .then(res => { if (res.ok) return res.json() })
      .then(data => {
        if (data) setApplications(data.applications || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [candidateToken])

  const statusSteps = ['applied', 'reviewed', 'shortlisted', 'hired', 'rejected']

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
                  if (app.status === 'rejected' && step === 'hired') return null
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
                          {step}
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
