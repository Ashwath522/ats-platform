import React, { useState } from 'react'

export function UnifiedRecruiterCard({ application, onUpdateStatus, onVerifyRepo }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [showRepoDetails, setShowRepoDetails] = useState(false)

  if (!application) return null

  const {
    id,
    candidate_name,
    candidate_email,
    job_title,
    ats_score,
    suitability_verdict,
    ai_recommendation,
    repo_match_score,
    project_score,
    project_summary,
    repo_match_reasoning,
    interview_eval_score,
    interview_risk_score,
    interview_risk_level,
    interview_recommendation,
    interview_evidence_url,
    interview_transcript_json,
    status,
    interview_status,
  } = application

  const effectiveRepoScore = repo_match_score ?? project_score
  const effectiveRepoReason = repo_match_reasoning ?? project_summary

  let transcriptList = []
  if (interview_transcript_json) {
    try {
      transcriptList = JSON.parse(interview_transcript_json)
    } catch (e) {
      transcriptList = []
    }
  }

  const getRiskBadge = (level) => {
    if (level === 'high') {
      return 'bg-red-500/10 text-red-400 border-red-500/30'
    }
    if (level === 'medium') {
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    }
    return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl hover:border-slate-700 transition-all space-y-6">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-xl font-bold text-slate-100">{candidate_name || `Candidate #${id}`}</h3>
          <p className="text-sm text-slate-400">{candidate_email} • Applying for <span className="text-blue-400 font-medium">{job_title || 'Software Engineer'}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Status:</span>
          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
            {status}
          </span>
        </div>
      </div>

      {/* 3 Core Metric Dials / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Resume ATS Score */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">1. ATS Score</span>
            <span className="text-2xl font-black text-blue-400">{ats_score ?? 'N/A'}%</span>
          </div>
          <p className="text-xs text-slate-300 line-clamp-2">
            <strong className="text-slate-200">Verdict:</strong> {suitability_verdict || 'Passed initial ATS match'}
          </p>
          {ai_recommendation && (
            <p className="text-[11px] text-slate-400 mt-2 italic line-clamp-2">
              "{ai_recommendation}"
            </p>
          )}
        </div>

        {/* 2. Repo Match Score */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">2. Repo Verification</span>
            <span className={`text-2xl font-black ${effectiveRepoScore !== null && effectiveRepoScore !== undefined ? 'text-indigo-400' : 'text-slate-600'}`}>
              {effectiveRepoScore !== null && effectiveRepoScore !== undefined ? `${effectiveRepoScore}%` : 'Pending'}
            </span>
          </div>
          {effectiveRepoReason ? (
            <div>
              <p className="text-xs text-slate-300 line-clamp-2">{effectiveRepoReason}</p>
              <button
                onClick={() => setShowRepoDetails(!showRepoDetails)}
                className="text-[11px] text-indigo-400 hover:underline mt-2 font-medium"
              >
                {showRepoDetails ? 'Hide Details' : 'View Code Analysis'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => onVerifyRepo && onVerifyRepo(id)}
              className="text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 py-1 px-3 rounded-lg mt-2 transition"
            >
              Verify Project Repo
            </button>
          )}
        </div>

        {/* 3. AI Interview & Proctoring Score */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">3. AI Interview</span>
            <span className={`text-2xl font-black ${interview_eval_score ? 'text-emerald-400' : 'text-slate-600'}`}>
              {interview_eval_score ? `${interview_eval_score}%` : (interview_status === 'unlocked' ? 'Unlocked' : 'Locked')}
            </span>
          </div>

          {interview_eval_score ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Proctoring Risk:</span>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded border uppercase ${getRiskBadge(interview_risk_level)}`}>
                  {interview_risk_level || 'Low'} ({interview_risk_score ?? 0}/100)
                </span>
              </div>
              <p className="text-xs text-slate-300 line-clamp-2 mt-1">{interview_recommendation}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              {interview_status === 'unlocked'
                ? 'Candidate invited to live AI interview.'
                : 'Interview will unlock after Repo Verification.'}
            </p>
          )}
        </div>
      </div>

      {/* Expanded Repo Details */}
      {showRepoDetails && effectiveRepoReason && (
        <div className="bg-slate-950 p-4 rounded-xl border border-indigo-500/20 text-xs space-y-2">
          <h4 className="font-semibold text-indigo-300">Detailed Code / Project Analysis</h4>
          <p className="text-slate-300 whitespace-pre-line">{effectiveRepoReason}</p>
        </div>
      )}

      {/* Evidence & Transcript Section */}
      {interview_eval_score && (
        <div className="border-t border-slate-800 pt-4 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            {interview_evidence_url && (
              <a
                href={interview_evidence_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition"
              >
                📹 View Video & Proctoring Evidence
              </a>
            )}
            {transcriptList.length > 0 && (
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                className="text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg transition"
              >
                💬 {showTranscript ? 'Hide Transcript' : 'View Full Transcript'}
              </button>
            )}
          </div>

          <span className="text-xs text-slate-500">
            Interview Engine: CV Risk First → LLM Next-Step Second
          </span>
        </div>
      )}

      {/* Expanded Transcript Modal / Drawer */}
      {showTranscript && transcriptList.length > 0 && (
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs max-h-60 overflow-y-auto">
          <h4 className="font-bold text-slate-200 border-b border-slate-800 pb-1">AI Interview Transcript</h4>
          {transcriptList.map((qa, i) => (
            <div key={i} className="space-y-1">
              <p className="text-blue-400 font-medium">Q: {qa.question}</p>
              <p className="text-slate-300 pl-3 border-l border-slate-800">A: {qa.answer}</p>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
        {status === 'ats_check' && (
          <button
            onClick={() => onUpdateStatus && onUpdateStatus(id, 'shortlisted')}
            className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition"
          >
            Shortlist Candidate
          </button>
        )}
        {status === 'shortlisted' && !effectiveRepoScore && (
          <span className="text-xs text-amber-400 font-medium self-center">
            Awaiting Repo / Project Verification to unlock Interview
          </span>
        )}
      </div>
    </div>
  )
}
