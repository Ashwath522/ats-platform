import React from 'react'

// Signature element: a circular scan-gauge, ring fill = ats_score.
// Color shifts cyan (good match) -> amber (weak match) based on score.
export default function ScoreDial({ score }) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const offset = circumference - (clamped / 100) * circumference
  const color = clamped >= 70 ? '#46d9c6' : clamped >= 40 ? '#f5a94e' : '#e0616b'

  return (
    <div className="score-dial">
      <svg width="88" height="88">
        <circle cx="44" cy="44" r={radius} stroke="#2a3341" strokeWidth="6" fill="none" />
        <circle
          cx="44" cy="44" r={radius}
          stroke={color}
          strokeWidth="6"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="dial-value" style={{ color }}>{clamped}</div>
    </div>
  )
}
