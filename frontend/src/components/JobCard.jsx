import React from 'react'

export default function JobCard({ job, onApply, applied }) {
  const salaryStr = job.salary_min || job.salary_max
    ? `${job.currency} ${job.salary_min?.toLocaleString() || '?'} – ${job.salary_max?.toLocaleString() || '?'}`
    : null

  const remoteLabel = {
    remote: 'Remote',
    onsite: 'On-site',
    hybrid: 'Hybrid',
  }[job.remote_type] || job.remote_type

  const [expanded, setExpanded] = React.useState(false)

  const getTruncatedDesc = (text) => {
    if (!text) return ''
    if (text.length <= 300) return text
    const substr = text.substring(0, 300)
    const lastPeriod = substr.lastIndexOf('.')
    if (lastPeriod > 100) {
      return text.substring(0, lastPeriod + 1)
    }
    return text.substring(0, 300) + '...'
  }

  const isLong = job.description && job.description.length > 300

  return (
    <div className="job-card">
      <div className="job-card-header">
        <h3 className="job-card-title">{job.title}</h3>
        <span className={`job-card-badge ${job.remote_type}`}>{remoteLabel}</span>
      </div>

      <div className="job-card-meta">
        {job.location_text && (
          <span className="job-card-location">📍 {job.location_text}</span>
        )}
        {salaryStr && (
          <span className="job-card-salary">💰 {salaryStr}</span>
        )}
        {job.distance_km != null && (
          <span className="job-card-distance">📏 {job.distance_km} km</span>
        )}
      </div>

      <div className="job-card-desc">
        {expanded ? job.description : getTruncatedDesc(job.description)}
        {isLong && (
          <span 
            onClick={() => setExpanded(!expanded)} 
            style={{ color: 'var(--primary)', cursor: 'pointer', marginLeft: 8, fontWeight: 'bold' }}
          >
            {expanded ? 'Show Less' : 'Read More'}
          </span>
        )}
      </div>

      {job.requirements && (
        <div className="job-card-skills">
          {job.requirements.split(',').filter(Boolean).map(s => (
            <span key={s.trim()} className="chip matched">{s.trim()}</span>
          ))}
        </div>
      )}

      <div className="job-card-footer">
        <span className="job-card-date">{new Date(job.created_at).toLocaleDateString()}</span>
        {onApply && (
          <button
            className={`primary ${applied ? 'applied' : ''}`}
            onClick={() => onApply(job.id)}
            disabled={applied}
          >
            {applied ? '✓ Applied' : 'Apply'}
          </button>
        )}
      </div>
    </div>
  )
}
