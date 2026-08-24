import React from 'react'
import ScoreDial from './ScoreDial.jsx'

export default function ScoreResult({ result, title }) {
  if (!result) return null

  // keyword_coverage is null when the job description had no keywords we
  // recognize (e.g. it was just a bare title, not a real JD) - the score in
  // that case is semantic-similarity-only. Showing "0% keywords" or "0
  // missing" here would be misleading, since we didn't actually check.
  const hasKeywordSignal = result.jd_has_recognized_skills !== false && result.keyword_coverage !== null

  return (
    <div>
      <div className="score-readout">
        <ScoreDial score={result.ats_score} />
        <div className="score-meta">
          <p className="job-title">{title || 'ATS Match'}</p>
          <div className="sub-metrics">
            <span>semantic {(result.semantic_similarity * 100).toFixed(0)}%</span>
            {hasKeywordSignal && <span>keywords {(result.keyword_coverage * 100).toFixed(0)}%</span>}
          </div>
        </div>
      </div>

      {!hasKeywordSignal && (
        <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(245, 169, 78, 0.08)', border: '1px solid var(--warn-dim, #d99b3f)', borderRadius: 6, fontSize: 13, color: 'var(--warn, #b5762a)' }}>
          This job description didn't include specific skills we recognize (it may just be a title, not a full description) — the score above is based on overall content similarity only, not keyword matching.
        </div>
      )}

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
          {result.missing_skills.length === 0 && hasKeywordSignal && <span style={{ color: 'var(--accent)', fontSize: 13 }}>Nothing missing — full keyword coverage</span>}
          {result.missing_skills.length === 0 && !hasKeywordSignal && <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Not checked — see note above</span>}
          {result.missing_skills.map(s => <span key={s} className="chip missing">{s}</span>)}
        </div>
      </div>
    </div>
  )
}
