import React, { useState } from 'react'
import ScoreDial from './ScoreDial.jsx'

export default function DeepAnalysisPanel({ result, target }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  if (!result?.resume_id) return null

  async function loadAnalysis() {
    setError(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('resume_id', result.resume_id)
      if (target?.role_id) fd.append('role_id', target.role_id)
      else if (target?.company_id) fd.append('company_id', target.company_id)
      else fd.append('job_description', target?.job_description || '')
      const res = await fetch('/api/candidate/deep-analysis', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).detail || 'Deep analysis failed')
      setAnalysis(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="deep-analysis">
      <button className="secondary" onClick={loadAnalysis} disabled={loading}>
        {loading ? 'Analyzing…' : 'Get full analysis'}
      </button>
      {error && <div className="error-msg">{error}</div>}
      {analysis && analysis.llm_configured === false && (
        <div className="empty-state">{analysis.overall_summary}</div>
      )}
      {analysis?.llm_configured && (
        <div>
          <div className="analysis-dials">
            <Metric score={analysis.grammar_score} label="Grammar" />
            <Metric score={analysis.technical_depth_score} label="Technical depth" />
            <Metric score={analysis.experience_score} label="Experience" />
          </div>
          <p className="analysis-summary">{analysis.overall_summary}</p>
          <div className="analysis-notes">
            <div><strong>Technical depth</strong><span>{analysis.technical_depth_notes}</span></div>
            <div><strong>Experience</strong><span>{analysis.experience_notes}</span></div>
          </div>
          <div className="skills-section">
            <div className="skills-label">Grammar issues</div>
            {analysis.grammar_issues.length === 0 && <div className="empty-inline">No major grammar issues found.</div>}
            {analysis.grammar_issues.map((item, index) => (
              <div className="analysis-issue" key={`${item.issue}-${index}`}>
                <strong>{item.issue}</strong>
                <span>{item.suggestion}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ score, label }) {
  return (
    <div className="analysis-metric">
      <ScoreDial score={score} />
      <span>{label}</span>
    </div>
  )
}
