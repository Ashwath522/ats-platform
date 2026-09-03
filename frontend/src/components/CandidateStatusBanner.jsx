import React from 'react'

const STATUS_CONFIG = {
  applied: {
    label: 'Application Under Review',
    message: 'Application received. We are reviewing your submission.',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    containerClass: 'bg-blue-950/40 border-blue-800/40',
  },
  shortlisted: {
    label: 'Shortlisted',
    message: 'Congratulations! Your profile has progressed to the shortlist.',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    containerClass: 'bg-emerald-950/40 border-emerald-800/40',
  },
  not_selected: {
    label: 'Not Selected',
    message: 'Thank you for your interest. Unfortunately, we will not be moving forward with your application at this time.',
    badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-600/40',
    containerClass: 'bg-slate-900/50 border-slate-800',
  },
  interview: {
    label: 'Interview Round',
    message: 'You are invited for an interview. Please prepare and join your session.',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    containerClass: 'bg-purple-950/40 border-purple-800/40',
  },
  final_result: {
    label: 'Final Result',
    message: 'Final decision has been recorded. Our team will be in touch with next steps.',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    containerClass: 'bg-amber-950/40 border-amber-800/40',
  },
}

export default function CandidateStatusBanner({ status }) {
  const normStatus = (status || 'applied').toLowerCase().trim()
  const config = STATUS_CONFIG[normStatus] || STATUS_CONFIG.applied

  return (
    <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${config.containerClass}`}>
      <div>
        <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${config.badgeClass}`}>
          {config.label}
        </span>
        <p className="text-sm text-slate-200 mt-1 font-medium">
          {config.message}
        </p>
      </div>
    </div>
  )
}
