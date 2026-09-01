import React from 'react'

export function CandidateStepper({ status, repoScore, interviewStatus }) {
  const steps = [
    { key: 'applied', label: 'Applied' },
    { key: 'ats_scored', label: 'ATS Scored' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'repo_verified', label: 'Repo Verified' },
    { key: 'interview_unlocked', label: 'Interview Unlocked' },
    { key: 'completed', label: 'Completed' },
  ]

  // Calculate current active step index
  let activeIndex = 0
  if (status === 'ats_check') activeIndex = 1
  if (status === 'shortlisted') activeIndex = 2
  if (repoScore !== undefined && repoScore !== null) activeIndex = 3
  if ((status === 'shortlisted' || status === 'repo_verification' || status === 'automated_interview') && (repoScore !== undefined && repoScore !== null)) {
    activeIndex = 4
  }
  if (interviewStatus === 'completed' || status === 'automated_interview') {
    activeIndex = 5
  }

  return (
    <div className="w-full py-4 px-2 my-4 bg-slate-900/60 border border-slate-800 rounded-xl">
      <div className="flex items-center justify-between relative">
        {/* Connecting progress line */}
        <div className="absolute top-1/2 left-4 right-4 -translate-y-1/2 h-1 bg-slate-800 -z-0" />
        <div
          className="absolute top-1/2 left-4 -translate-y-1/2 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 transition-all duration-500 -z-0"
          style={{ width: `${(activeIndex / (steps.length - 1)) * 95}%` }}
        />

        {steps.map((step, idx) => {
          const isDone = idx < activeIndex
          const isCurrent = idx === activeIndex
          const isLocked = idx > activeIndex

          return (
            <div key={step.key} className="flex flex-col items-center relative z-10">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                  isDone
                    ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20'
                    : isCurrent
                    ? 'bg-blue-600 border-blue-400 text-white ring-4 ring-blue-500/20 animate-pulse'
                    : 'bg-slate-900 border-slate-700 text-slate-500'
                }`}
              >
                {isDone ? '✓' : idx + 1}
              </div>
              <span
                className={`text-[11px] font-medium mt-2 whitespace-nowrap ${
                  isCurrent
                    ? 'text-blue-400 font-semibold'
                    : isDone
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
