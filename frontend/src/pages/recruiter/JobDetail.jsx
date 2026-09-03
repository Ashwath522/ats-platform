import React, { useState, useEffect, useCallback } from 'react'

export default function JobDetail({ jobId, job, applicants = [], api, onRefresh }) {
  const [runningATS, setRunningATS] = useState(false)
  const [runningRepoVerify, setRunningRepoVerify] = useState(false)
  const [repoShortlist, setRepoShortlist] = useState(null)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  // Shortlist #1 consists of applicants with status == 'shortlisted'
  const shortlist1 = applicants.filter(a => a.status === 'shortlisted')
  const hasShortlist1 = shortlist1.length > 0

  const handleRunATSShortlist = async () => {
    setRunningATS(true)
    setError(null)
    setSuccessMsg(null)
    try {
      // Shortlist candidates with top ATS scores (e.g. >= 70 or highest)
      const topCandidates = applicants.filter(a => (a.ats_score || 0) >= 60)
      if (topCandidates.length === 0 && applicants.length > 0) {
        topCandidates.push(applicants[0])
      }

      for (const cand of topCandidates) {
        if (cand.status !== 'shortlisted') {
          const fd = new FormData()
          fd.append('decision', 'shortlisted')
          fd.append('notes', 'Stage 1 ATS Shortlist qualification')
          await api(`/api/recruiter/jobs/${jobId}/applicants/${cand.application_id}/confirm-decision`, {
            method: 'POST',
            body: fd,
          })
        }
      }

      setSuccessMsg(`Stage 1 ATS Shortlist generated (${topCandidates.length} applicants shortlisted).`)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setError(err.message || 'Failed to run ATS shortlist')
    } finally {
      setRunningATS(false)
    }
  }

  const handleRunRepoVerify = async () => {
    if (!hasShortlist1) return
    setRunningRepoVerify(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const res = await api(`/api/recruiter/jobs/${jobId}/repo-verify`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Repo verification failed')
      }

      setRepoShortlist(data.shortlist || [])
      setSuccessMsg(`Stage 2 Repo Verification completed! Ranked ${data.total_evaluated} candidate(s).`)
      if (onRefresh) await onRefresh()
    } catch (err) {
      setError(err.message || 'Failed to run repo verification')
    } finally {
      setRunningRepoVerify(false)
    }
  }

  return (
    <div className="job-detail-pipeline space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6 bg-slate-900/60 border border-slate-800 rounded-2xl">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{job?.title || 'Job Details'}</h2>
          <p className="text-xs text-slate-400 mt-1">
            {applicants.length} total applicant(s) &bull; {shortlist1.length} shortlisted in Stage 1
          </p>
        </div>

        {/* Action Button Bar */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRunATSShortlist}
            disabled={runningATS || applicants.length === 0}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50"
          >
            {runningATS ? 'Running ATS...' : 'Run ATS Shortlist'}
          </button>

          <button
            onClick={handleRunRepoVerify}
            disabled={runningRepoVerify || !hasShortlist1}
            title={!hasShortlist1 ? 'Run ATS Shortlist first to generate Stage 1 candidates' : 'Run Stage 2 Repo Verification'}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-40 disabled:cursor-not-allowed border border-indigo-400/30"
          >
            {runningRepoVerify ? 'Verifying Repos...' : 'Repo Verification'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-500/40 text-red-300 text-xs rounded-xl">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-900/30 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl">
          {successMsg}
        </div>
      )}

      {/* Shortlist #2: Repo Verification Ranked Table */}
      {repoShortlist && repoShortlist.length > 0 && (
        <div className="p-6 bg-slate-900/70 border border-indigo-500/30 rounded-2xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
              Stage 2: Repo Verified Ranked Shortlist
            </h3>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full border border-indigo-500/30">
              {repoShortlist.length} Candidate(s) Ranked
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Rank</th>
                  <th className="py-2 px-3">Candidate ID</th>
                  <th className="py-2 px-3">ATS Score</th>
                  <th className="py-2 px-3">Project Score</th>
                  <th className="py-2 px-3">Final Score</th>
                  <th className="py-2 px-3">Candidate Status</th>
                  <th className="py-2 px-3">Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {repoShortlist.map((item) => (
                  <tr key={item.application_id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-3 font-bold text-indigo-400">#{item.rank}</td>
                    <td className="py-3 px-3 font-mono">{item.candidate_id}</td>
                    <td className="py-3 px-3">{item.ats_score ?? '—'}</td>
                    <td className="py-3 px-3 text-indigo-300 font-bold">{item.project_score ?? '—'}%</td>
                    <td className="py-3 px-3 text-emerald-400 font-black">{item.final_score ?? '—'}%</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded-full uppercase text-[10px] font-bold ${
                        item.candidate_status === 'shortlisted' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {item.candidate_status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 max-w-xs truncate" title={item.repo_match_reasoning}>
                      {item.repo_match_reasoning || 'Evaluated'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
