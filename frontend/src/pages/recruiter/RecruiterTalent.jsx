import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'

export default function RecruiterTalent() {
  const { api } = useOutletContext()
  const [allApplicants, setAllApplicants] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  
  useEffect(() => {
    async function loadTalent() {
      try {
        // Fetch all jobs first
        const jobsRes = await api('/api/recruiter/jobs')
        if (!jobsRes.ok) throw new Error('Failed to load jobs')
        const jobsData = await jobsRes.json()

        // Fetch applicants for all jobs
        const applicantsData = []
        for (const job of jobsData) {
          try {
            const appRes = await api(`/api/recruiter/jobs/${job.id}/applicants`)
            if (appRes.ok) {
              const data = await appRes.json()
              data.applicants.forEach(a => {
                applicantsData.push({ ...a, job_title: job.title })
              })
            }
          } catch (e) {
            console.error(e)
          }
        }
        
        // Sort by ATS score desc
        applicantsData.sort((a, b) => b.ats_score - a.ats_score)
        setAllApplicants(applicantsData)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadTalent()
  }, [api])

  const handleInterest = () => {
    alert("Interest registered (Feature in development)")
  }

  return (
    <div className="recruiter-talent" style={{ display: 'flex', gap: 24, height: '100%' }}>
      <div style={{ flex: selectedCandidate ? '1' : '1', overflowY: 'auto' }}>
        <h1 style={{ fontSize: 28, margin: '0 0 24px 0' }}>Talent Discovery</h1>
        
        {loading ? (
          <div className="empty-state">Loading talent pool...</div>
        ) : allApplicants.length === 0 ? (
          <div className="empty-state panel">No candidates have applied to your jobs yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {allApplicants.map(a => (
              <div 
                key={a.application_id} 
                className={`panel ${selectedCandidate?.application_id === a.application_id ? 'selected' : ''}`}
                style={{ cursor: 'pointer', border: selectedCandidate?.application_id === a.application_id ? '2px solid var(--primary)' : '1px solid var(--border)' }}
                onClick={() => setSelectedCandidate(a)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{a.candidate_name || 'Anonymous Candidate'}</h3>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Applied for: {a.job_title}</div>
                  </div>
                  <div className="score-cell" style={{ fontSize: 16 }}>{a.ats_score}%</div>
                </div>
                
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {a.matched_skills.slice(0, 3).map(s => <span key={s} className="chip matched">{s}</span>)}
                  {a.matched_skills.length > 3 && <span className="chip" style={{ background: 'var(--background)' }}>+{a.matched_skills.length - 3}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedCandidate && (
        <div style={{ width: 400, backgroundColor: 'var(--surface)', borderLeft: '1px solid var(--border)', padding: 24, overflowY: 'auto', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h2 style={{ margin: 0 }}>Candidate Profile</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCandidate(null)}>✕</button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: 'var(--border)', margin: '0 auto 12px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
              👤
            </div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 20 }}>{selectedCandidate.candidate_name || 'Anonymous Candidate'}</h3>
            <div style={{ color: 'var(--text-secondary)' }}>Applicant for {selectedCandidate.job_title}</div>
            
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={handleInterest}>Interested</button>
              <button className="btn btn-secondary btn-sm" disabled title="Messaging Coming Soon">Message</button>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>ATS Match Analysis</h4>
            <div style={{ backgroundColor: 'var(--background)', padding: 16, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>Overall Match</strong>
                <strong className="score-cell">{selectedCandidate.ats_score}%</strong>
              </div>
              <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                Based on semantic similarity, skill extraction, and experience requirements.
              </p>
              
              <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>Matched Skills</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selectedCandidate.matched_skills.map(s => <span key={s} className="chip matched">{s}</span>)}
              </div>
              
              <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>Missing Skills</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedCandidate.missing_skills.map(s => <span key={s} className="chip missing">{s}</span>)}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Application Details</h4>
            <div style={{ fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Current Status</span>
                <span style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{selectedCandidate.status.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Applied On</span>
                <span>{new Date(selectedCandidate.applied_at).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Resume</span>
                <a href="#" style={{ color: 'var(--primary)' }} onClick={(e) => { e.preventDefault(); alert("Resume preview in development.") }}>{selectedCandidate.resume_filename || 'View File'}</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
