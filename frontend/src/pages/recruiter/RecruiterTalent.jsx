import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { UnifiedRecruiterCard } from '../../components/UnifiedRecruiterCard.jsx'

export default function RecruiterTalent() {
  const { api } = useOutletContext()
  const [allApplicants, setAllApplicants] = useState([])
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [selectedJobFilter, setSelectedJobFilter] = useState('all')

  const loadTalent = async () => {
    try {
      setLoading(true)
      const jobsRes = await api('/api/recruiter/jobs')
      if (!jobsRes.ok) throw new Error('Failed to load jobs')
      const jobsData = await jobsRes.json()
      setJobs(jobsData)

      const applicantsData = []
      for (const job of jobsData) {
        try {
          const appRes = await api(`/api/recruiter/jobs/${job.id}/applicants`)
          if (appRes.ok) {
            const data = await appRes.json()
            data.applicants.forEach(a => {
              applicantsData.push({ ...a, job_title: job.title, job_id: job.id })
            })
          }
        } catch (e) {
          console.error(e)
        }
      }
      
      applicantsData.sort((a, b) => (b.ats_score || 0) - (a.ats_score || 0))
      setAllApplicants(applicantsData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTalent()
  }, [])

  const filteredApplicants = selectedJobFilter === 'all' 
    ? allApplicants 
    : allApplicants.filter(a => a.job_id.toString() === selectedJobFilter)

  const handleUpdateStatus = async (appId, newStatus) => {
    try {
      const res = await api(`/api/recruiter/applications/${appId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        loadTalent()
      }
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="recruiter-talent space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Unified Talent Dashboard</h1>
          <p className="text-sm text-slate-400">Review ATS resume matches, repo verifications, and AI proctored interviews.</p>
        </div>
        <select 
          value={selectedJobFilter} 
          onChange={(e) => setSelectedJobFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl px-4 py-2"
        >
          <option value="all">All Jobs</option>
          {jobs.map(job => (
            <option key={job.id} value={job.id}>{job.title}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading candidate applications...</div>
      ) : filteredApplicants.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-2xl text-slate-400">
          No candidates found for the selected job filter.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredApplicants.map(app => (
            <UnifiedRecruiterCard
              key={app.application_id || app.id}
              application={app}
              onUpdateStatus={handleUpdateStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}
