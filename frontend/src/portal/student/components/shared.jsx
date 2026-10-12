/** Building blocks shared by the student pages (04–12). */
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark, MapPin, ArrowRight, Check, Cog, Building2, Zap, Cpu, FlaskConical, Plane, Car, Layers, Briefcase,
  CheckCircle2, AlertCircle, ExternalLink, Clock,
} from 'lucide-react'
import { Alert, Badge, Button, LogoTile, Modal, Skeleton, Progress, StatusPill, useToast, fmtDate } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { branchThumb, getBranch } from '../../../branding/branches.js'
import './student.css'

export const BRANCH_ICONS = { Cog, Building2, Zap, Cpu, FlaskConical, Plane, Car, Layers }
export function BranchIcon({ branch, size = 22 }) {
  const b = typeof branch === 'string' ? getBranch(branch) : branch
  const I = BRANCH_ICONS[b?.icon] || Cog
  return <I size={size} />
}

export const JOB_TYPE_LABEL = { internship: 'Internship', 'full-time': 'Full Time', 'part-time': 'Part Time', apprenticeship: 'Apprenticeship' }
export const REMOTE_LABEL = { onsite: 'On-site', remote: 'Remote', hybrid: 'Hybrid' }

export function fmtSalary(job) {
  const lo = Number(job?.salary_min) || 0
  const hi = Number(job?.salary_max) || 0
  if (!lo && !hi) return null
  if (job.job_type === 'internship' && hi && hi < 200000) return `₹${Math.round(lo / 1000)}–${Math.round(hi / 1000)}K / month`
  const l = (v) => (v / 100000).toFixed(v % 100000 ? 1 : 0)
  return lo && hi ? `₹${l(lo)}–${l(hi)} LPA` : `₹${l(lo || hi)} LPA`
}

export const daysAgoLabel = (d) => (d == null ? '' : d === 0 ? 'Posted today' : `Posted ${d} day${d === 1 ? '' : 's'} ago`)

export function JobTags({ job, max = 5 }) {
  const tags = []
  if (job.job_type) tags.push(<span key="t" className="st-tag blue">{JOB_TYPE_LABEL[job.job_type] || job.job_type}</span>)
  if (job.remote_type) tags.push(<span key="r" className="st-tag">{REMOTE_LABEL[job.remote_type] || job.remote_type}</span>)
  if (job.branch_label) tags.push(<span key="b" className="st-tag">{job.branch_label}</span>)
  ;(job.skills || []).slice(0, Math.max(0, max - tags.length)).forEach((s) => tags.push(<span key={s} className="st-tag">{s}</span>))
  return <div className="st-tag-row">{tags}</div>
}

/** Saved-jobs state shared by a page: { saved:Set, toggle(job_id), items, reload } */
export function useSavedJobs() {
  const api = useApi('candidate')
  const toast = useToast()
  const [items, setItems] = useState([])
  const [saved, setSaved] = useState(() => new Set())
  const reload = useCallback(() => api.get('/api/student/saved-jobs').then((r) => {
    setItems(r.items || [])
    setSaved(new Set((r.items || []).map((i) => i.job_id)))
  }).catch(() => {}), [api])
  useEffect(() => { reload() }, [reload])
  const toggle = useCallback(async (jobId) => {
    const on = saved.has(jobId)
    setSaved((s) => { const n = new Set(s); on ? n.delete(jobId) : n.add(jobId); return n })
    try {
      if (on) await api.del(`/api/student/saved-jobs/${jobId}`)
      else await api.post('/api/student/saved-jobs', { job_id: jobId })
      toast(on ? 'Removed from saved jobs' : 'Saved to your jobs', 'success')
      reload()
    } catch (e) {
      setSaved((s) => { const n = new Set(s); on ? n.add(jobId) : n.delete(jobId); return n })
      toast(e.message, 'error')
    }
  }, [api, saved, toast, reload])
  return { saved, items, toggle, reload }
}

export function BookmarkButton({ on, onClick, className = 'cl-icon-btn', label }) {
  return (
    <button type="button" className={`${className} st-bookmark ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={label || (on ? 'Remove from saved jobs' : 'Save job')} title={on ? 'Saved' : 'Save'}
      onClick={(e) => { e.stopPropagation(); onClick() }}>
      <Bookmark size={18} />
    </button>
  )
}

/** Opportunity card with the branch photo of the JOB (dashboard). */
export function JobMediaCard({ job, index = 0, saved, onToggleSave, onOpen }) {
  return (
    <article className="cl-card cl-media-card st-card-click" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()} aria-label={`${job.title} at ${job.company}`}>
      <div className="cl-media">
        <img src={branchThumb(job.branch || 'mechanical', index)} alt="" loading="lazy" />
        <BookmarkButton on={saved} onClick={onToggleSave} className="cl-media-act" />
        <div className="st-media-logo"><LogoTile name={job.company} src={job.company_logo} size={26} wide /></div>
      </div>
      <div className="cl-media-body">
        <h4 className="cl-ellipsis">{job.title}</h4>
        <div className="cl-meta"><span><MapPin size={14} />{job.location || 'Location not specified'}</span></div>
        <JobTags job={{ ...job, skills: [] }} max={3} />
      </div>
    </article>
  )
}

/** Full job details + apply (used by Dashboard and Opportunities). */
export function JobDetailsModal({ jobId, onClose, saved, onToggleSave, onApplied }) {
  const api = useApi('candidate')
  const toast = useToast()
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!jobId) return
    setJob(null); setError(null); setResult(null)
    api.get(`/api/student/opportunities/${jobId}`).then(setJob).catch(setError)
  }, [jobId, api])

  const apply = async () => {
    setApplying(true)
    try {
      const r = await api.post(`/api/candidate/jobs/${jobId}/apply`)
      setResult(r)
      setJob((j) => ({ ...j, applied: true, application_id: r.application_id }))
      toast('Application submitted', 'success')
      onApplied?.(r)
    } catch (e) {
      toast(e.message, 'error')
      if (e.status === 409) setJob((j) => ({ ...j, applied: true }))
    } finally { setApplying(false) }
  }

  const salary = job && fmtSalary(job)
  return (
    <Modal open={!!jobId} onClose={onClose} size="lg" title={job ? job.title : 'Job details'}
      footer={job && !error && (
        <>
          <Button variant="secondary" icon={Bookmark} onClick={() => onToggleSave?.(job.id)}>{saved ? 'Saved' : 'Save job'}</Button>
          {job.applied
            ? <Button to="/candidate/applications" iconRight={ArrowRight}>View my application</Button>
            : <Button loading={applying} onClick={apply} disabled={!job.has_resume || job.status !== 'open'}>Apply now</Button>}
        </>
      )}>
      {error && <Alert tone="error">{error.message}</Alert>}
      {!job && !error && <div className="cl-col"><Skeleton h={22} w="60%" /><Skeleton h={14} /><Skeleton h={120} /></div>}
      {job && (
        <div className="cl-col" style={{ gap: 14 }}>
          <div className="cl-row" style={{ alignItems: 'flex-start' }}>
            <LogoTile name={job.company} src={job.company_logo} size={52} />
            <div className="cl-grow">
              <div style={{ fontWeight: 700, color: 'var(--cl-ink)', fontSize: 16 }}>{job.company}</div>
              <div className="cl-meta" style={{ marginTop: 4 }}>
                <span><MapPin size={14} />{job.location || '—'}</span>
                {salary && <span>{salary}</span>}
                {job.openings ? <span><Briefcase size={14} />{job.openings} opening{job.openings > 1 ? 's' : ''}</span> : null}
                <span><Clock size={14} />{daysAgoLabel(job.days_ago)}</span>
              </div>
            </div>
            <Badge tone={job.match >= 70 ? 'green' : job.match >= 45 ? 'amber' : ''}>{job.match}% {job.match_source === 'ats' ? 'ATS match' : 'match'}</Badge>
          </div>
          <JobTags job={job} max={8} />
          {result && (
            <Alert tone="success" icon={CheckCircle2}>
              Applied! Your resume scored <b>{result.ats_score}/100</b> for this role.
              {result.missing_skills?.length > 0 && <> Consider strengthening: {result.missing_skills.slice(0, 5).join(', ')}.</>}{' '}
              <Link to="/candidate/applications">Track it in Applications →</Link>
            </Alert>
          )}
          {!job.has_resume && !job.applied && (
            <Alert tone="warn" icon={AlertCircle}>Upload your resume before applying. <Link to="/candidate/resume-skills">Go to Resume & Skills →</Link></Alert>
          )}
          {job.applied && !result && <Alert tone="success" icon={Check}>You have already applied to this job{job.application_status ? ` — current stage: ${job.application_status.replace(/_/g, ' ')}` : ''}.</Alert>}
          <div>
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>About the role</h4>
            <div className="st-pre">{job.description}</div>
          </div>
          {job.eligibility && <div><h4 style={{ fontSize: 15, marginBottom: 6 }}>Eligibility</h4><div className="st-pre">{job.eligibility}</div></div>}
          {(job.skills || []).length > 0 && (
            <div>
              <h4 style={{ fontSize: 15, marginBottom: 8 }}>Skills</h4>
              <div className="st-tag-row">
                {job.skills_have.map((s) => <span key={s} className="st-tag green"><Check size={12} style={{ marginRight: 3 }} />{s}</span>)}
                {job.skills_missing.map((s) => <span key={s} className="st-tag">{s}</span>)}
              </div>
              <small className="cl-muted" style={{ display: 'block', marginTop: 6 }}>Green = on your profile. Add missing skills you have in Resume & Skills.</small>
            </div>
          )}
          {job.company_about && <div><h4 style={{ fontSize: 15, marginBottom: 6 }}>About {job.company}</h4><p className="cl-muted">{job.company_about}</p>{job.company_website && <a href={job.company_website} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Website</a>}</div>}
        </div>
      )}
    </Modal>
  )
}

/** Candidate-facing explainability for one application. */
export function ExplainabilityModal({ appId, onClose }) {
  const api = useApi('candidate')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!appId) return
    setData(null); setError(null)
    api.get(`/api/candidate/jobs/applications/${appId}/explainability`).then(setData).catch(setError)
  }, [appId, api])
  return (
    <Modal open={!!appId} onClose={onClose} size="lg" title={data ? `Why this score — ${data.job_title}` : 'Application insights'}>
      {error && <Alert tone="error">{error.message}</Alert>}
      {!data && !error && <Skeleton h={160} />}
      {data && <ExplainabilityBody data={data} />}
    </Modal>
  )
}

export function ExplainabilityBody({ data }) {
  return (
    <div className="cl-col" style={{ gap: 14 }}>
      <Alert tone={data.ats_score >= 70 ? 'success' : data.ats_score >= 50 ? undefined : 'warn'}><b>{data.summary_verdict}.</b> {data.summary_text}</Alert>
      {data.components.map((c) => (
        <div key={c.name} className="st-mini-card" style={{ gap: 6 }}>
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <strong style={{ color: 'var(--cl-ink)' }}>{c.name}</strong>
            {c.score != null ? <Badge tone={c.score >= 70 ? 'green' : c.score >= 50 ? 'amber' : 'red'}>{c.score}/100</Badge> : <StatusPill status={c.status} />}
          </div>
          {c.score != null && <Progress value={c.score} color={c.score >= 70 ? 'var(--cl-green)' : c.score >= 50 ? '#f59e0b' : 'var(--cl-red)'} />}
          <small className="cl-muted">{c.details}</small>
        </div>
      ))}
      {(data.matched_skills.length > 0 || data.missing_skills.length > 0) && (
        <div className="st-tag-row">
          {data.matched_skills.map((s) => <span key={s} className="st-tag green">{s}</span>)}
          {data.missing_skills.map((s) => <span key={s} className="st-tag amber">{s}</span>)}
        </div>
      )}
      <div>
        <h4 style={{ fontSize: 15, marginBottom: 6 }}>How to improve</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="cl-col">{data.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
      <small className="cl-muted">Review status: {data.human_review_status}. Final decisions are always confirmed by a person.</small>
    </div>
  )
}

export const fmtRange = (start, end) => {
  if (!start) return ''
  const s = new Date(start)
  const t = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return end ? `${t(s)} – ${t(new Date(end))}` : t(s)
}

export { fmtDate }
