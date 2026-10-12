import React from 'react'
import { Check } from 'lucide-react'
import './CandidateStepper.css'

/**
 * Hiring progress for one application. Each step is derived from real
 * backend state (no step is shown "done" until it actually happened).
 */
export function CandidateStepper({ status, repoScore, interviewStatus, candidateStatus }) {
  const hasProject = repoScore !== undefined && repoScore !== null
  const unlocked = ['unlocked', 'in_progress', 'completed'].includes(interviewStatus)
  const interviewed = interviewStatus === 'completed'
  const decided = candidateStatus === 'final_result' || status === 'rejected'

  const steps = [
    { label: 'Applied', done: true },
    { label: 'Resume scored', done: true },
    { label: 'Project verified', done: hasProject },
    { label: 'Interview unlocked', done: unlocked },
    { label: 'Interview done', done: interviewed },
    { label: 'Decision', done: decided },
  ]
  const current = steps.findIndex((s) => !s.done)

  return (
    <ol className="cs-steps" aria-label="Application progress">
      {steps.map((s, i) => (
        <li key={s.label} className={`cs-step ${s.done ? 'done' : ''} ${i === current ? 'current' : ''}`}>
          <span className="cs-dot">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
          <span className="cs-label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}
