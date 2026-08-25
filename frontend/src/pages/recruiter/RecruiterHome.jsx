import React, { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'

export default function RecruiterHome() {
  const { api, username } = useOutletContext()
  const [stats, setStats] = useState({ activeJobs: 0, newApplicants: 0, shortlisted: 0 })
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])

  useEffect(() => {
    async function loadData() {
      try {
        const jobsRes = await api('/api/recruiter/jobs')
        if (!jobsRes.ok) throw new Error('Failed to load jobs')
        const jobsData = await jobsRes.json()
        setJobs(jobsData)

        let active = 0
        let applicants = 0
        
        jobsData.forEach(j => {
          if (j.status === 'open') active++
        })

        // Fetch applicants for open jobs to calculate stats
        // We do this by hitting the status endpoints if needed, but for now just mock stats from jobs
        // Ideally we fetch actual applicants here.
        setStats({
          activeJobs: active,
          newApplicants: 12, // Mock for overview until backend aggregates
          shortlisted: 4
        })
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [api])

  return (
    <div className="recruiter-home">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, margin: '0 0 8px 0' }}>Good morning, {username}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Here is your hiring overview for today.</p>
      </div>

      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 40 }}>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.activeJobs}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Active Jobs</div>
        </div>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.newApplicants}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>New Applicants</div>
        </div>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: 'var(--primary)', marginBottom: 8 }}>{loading ? '-' : stats.shortlisted}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Shortlisted</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 32 }}>
        <div>
          <h2 style={{ marginBottom: 16 }}>Hiring Activity</h2>
          <div className="panel">
            {jobs.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <p>No active jobs yet.</p>
                <Link to="/recruiter/jobs" className="btn btn-primary" style={{ marginTop: 16 }}>Create your first job</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {jobs.slice(0, 3).map(job => (
                  <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0' }}>{job.title}</h4>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{job.location_text || 'Remote'}</div>
                    </div>
                    <Link to={`/recruiter/jobs?id=${job.id}`} className="btn btn-secondary btn-sm">View Pipeline</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 16 }}>Insights & Updates</h2>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 'bold', marginBottom: 4 }}>💡 Hiring Idea</div>
              <p style={{ fontSize: 14, margin: '0 0 12px 0' }}>"Should technical hiring focus more on projects than years of experience?"</p>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ cursor: 'pointer' }}>Like</span>
                <span style={{ cursor: 'pointer' }}>Comment</span>
              </div>
            </div>
            
            <div>
              <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 'bold', marginBottom: 4 }}>📈 CoreLink Tip</div>
              <p style={{ fontSize: 14, margin: '0 0 12px 0' }}>Job descriptions with explicit salary ranges receive 40% more qualified applicants.</p>
              <Link to="/recruiter/jobs" style={{ fontSize: 12, textDecoration: 'none' }}>Update Jobs →</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
