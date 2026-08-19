import React from 'react'
import ScoreDial from './ScoreDial.jsx'

export default function ScoreResult({ result, title }) {
  if (!result) return null
  return (
    <div>
      <div className="score-readout">
        <ScoreDial score={result.ats_score} />
        <div className="score-meta">
          <p className="job-title">{title || 'ATS Match'}</p>
          <div className="sub-metrics">
            <span>semantic {(result.semantic_similarity * 100).toFixed(0)}%</span>
            <span>keywords {(result.keyword_coverage * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div className="skills-section">
        <div className="skills-label">Matched ({result.matched_skills.length})</div>
        <div className="chip-row">
          {result.matched_skills.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>None detected</span>}
          {result.matched_skills.map(s => <span key={s} className="chip matched">{s}</span>)}
        </div>
      </div>

      <div className="skills-section">
        <div className="skills-label">Missing — add these to improve your score ({result.missing_skills.length})</div>
        <div className="chip-row">
          {result.missing_skills.length === 0 && <span style={{ color: 'var(--accent)', fontSize: 13 }}>Nothing missing — full keyword coverage</span>}
          {result.missing_skills.map(s => <span key={s} className="chip missing">{s}</span>)}
        </div>
      </div>
    </div>
  )
}
