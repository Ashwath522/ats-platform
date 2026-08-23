import React, { useEffect, useState, useCallback } from 'react'
import { useAuth, createAuthedFetch } from '../../auth.jsx'
import JobCard from '../../components/JobCard.jsx'

export default function JobsPage() {
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [appliedIds, setAppliedIds] = useState(new Set())
  const [applyResult, setApplyResult] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [sugLoading, setSugLoading] = useState(false)
  const [sugError, setSugError] = useState(null)

  async function fetchSuggestions(jobId) {
    setSugLoading(true)
    setSugError(null)
    try {
      const res = await api(`/api/candidate/jobs/${jobId}/suggestions`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch (e) {
      setSugError(e.message)
    } finally {
      setSugLoading(false)
    }
  }

  // Filters
  const [titleFilter, setTitleFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [remoteFilter, setRemoteFilter] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [sortBy, setSortBy] = useState('recent')

  // Location
  const [userLat, setUserLat] = useState(null)
  const [userLng, setUserLng] = useState(null)
  const [geoLoading, setGeoLoading] = useState(false)
  const [radiusKm, setRadiusKm] = useState('')

  const loadJobs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (titleFilter.trim()) params.set('title', titleFilter.trim())
      if (locationFilter.trim()) params.set('location', locationFilter.trim())
      if (remoteFilter) params.set('remote_type', remoteFilter)
      if (salaryMin) params.set('salary_min', salaryMin)
      if (userLat != null && userLng != null) {
        params.set('lat', userLat)
        params.set('lng', userLng)
        if (radiusKm) params.set('radius_km', radiusKm)
      }
      params.set('sort_by', sortBy)

      const res = await api(`/api/candidate/jobs?${params}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed')
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [candidateToken, titleFilter, locationFilter, remoteFilter, salaryMin, sortBy, userLat, userLng, radiusKm])

  const loadApplications = useCallback(async () => {
    try {
      const res = await api('/api/candidate/jobs/applications/mine')
      if (res.ok) {
        const data = await res.json()
        setAppliedIds(new Set((data.applications || []).map(a => a.job_id)))
      }
    } catch (e) {}
  }, [candidateToken])

  useEffect(() => { loadJobs(); loadApplications() }, [loadJobs, loadApplications])

  async function handleApply(jobId) {
    setApplyResult(null)
    setSuggestions(null)
    setSugError(null)
    try {
      const res = await api(`/api/candidate/jobs/${jobId}/apply`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Apply failed')
      setApplyResult({ ...data, job_id: jobId })
      setAppliedIds(prev => new Set([...prev, jobId]))
    } catch (e) {
      setError(e.message)
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude)
        setUserLng(pos.coords.longitude)
        setGeoLoading(false)
        setSortBy('distance')
      },
      () => {
        setError('Location access denied')
        setGeoLoading(false)
      }
    )
  }

  return (
    <div className="jobs-page">
      {/* Filters */}
      <div className="panel jobs-filters">
        <h2>Browse Jobs</h2>
        <div className="filters-grid">
          <div className="filter-group">
            <label>Search title</label>
            <input type="text" value={titleFilter} onChange={e => setTitleFilter(e.target.value)} placeholder="e.g. Backend, React…" />
          </div>
          <div className="filter-group">
            <label>Location</label>
            <input type="text" value={locationFilter} onChange={e => setLocationFilter(e.target.value)} placeholder="e.g. Bangalore" />
          </div>
          <div className="filter-group">
            <label>Work type</label>
            <select value={remoteFilter} onChange={e => setRemoteFilter(e.target.value)}>
              <option value="">All</option>
              <option value="remote">Remote</option>
              <option value="onsite">On-site</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Min salary</label>
            <input type="number" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} placeholder="0" />
          </div>
          <div className="filter-group">
            <label>Sort by</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="recent">Most recent</option>
              <option value="salary">Highest salary</option>
              <option value="distance">Nearest</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Radius (km)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={radiusKm} onChange={e => setRadiusKm(e.target.value)} placeholder="50" disabled={!userLat} />
              <button className="geo-btn" onClick={requestLocation} disabled={geoLoading}>
                {geoLoading ? '…' : userLat ? '✓ 📍' : '📍 Near me'}
              </button>
            </div>
          </div>
        </div>

        <button className="primary" onClick={loadJobs} style={{ marginTop: 12 }}>Search</button>
      </div>

      {/* Apply result toast */}
      {applyResult && (
        <div className="panel apply-result">
          <h3>Application Submitted!</h3>
          <p>Job: <strong>{applyResult.job_title}</strong></p>
          <div className="score-readout" style={{ marginTop: 12 }}>
            <div className="score-dial">
              <span className="dial-value">{applyResult.ats_score}</span>
            </div>
            <div className="score-meta">
              <p className="job-title">Your ATS Score</p>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {applyResult.matched_skills?.map(s => <span key={s} className="chip matched">{s}</span>)}
                {applyResult.missing_skills?.slice(0, 4).map(s => <span key={s} className="chip missing">{s}</span>)}
              </div>
            </div>
          </div>

          <div className="apply-result-actions" style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {!suggestions && !sugLoading && (
              <button className="btn btn-secondary" onClick={() => fetchSuggestions(applyResult.job_id)}>
                💡 How can I improve my score?
              </button>
            )}
            <button onClick={() => setApplyResult(null)} className="btn">Dismiss</button>
          </div>

          {sugLoading && <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary-color)' }}>
            <div className="socket-loader-small" /> Loading AI resume recommendations...
          </div>}
          {sugError && <div className="error-banner" style={{ marginTop: 12 }}>{sugError}</div>}

          {suggestions && (
            <div className="suggestions-box" style={{ marginTop: 16, padding: 16, background: 'rgba(0,0,0,0.02)', borderRadius: 8, borderLeft: '4px solid var(--primary-color)' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--primary-color)' }}>AI Resume Suggestions</h4>
              <ul style={{ margin: 0, paddingLeft: 20, textAlign: 'left' }}>
                {suggestions.map((sug, idx) => (
                  <li key={idx} style={{ marginBottom: 8, fontSize: 14 }}>{sug}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Job listings */}
      {error && <div className="error-msg" style={{ padding: '0 0 12px' }}>{error}</div>}

      {loading && <div className="panel"><div className="empty-state">Loading jobs…</div></div>}

      {!loading && jobs.length === 0 && (
        <div className="panel"><div className="empty-state">No jobs found matching your criteria.</div></div>
      )}

      {!loading && jobs.map(job => (
        <JobCard
          key={job.id}
          job={job}
          onApply={handleApply}
          applied={appliedIds.has(job.id)}
        />
      ))}
    </div>
  )
}
