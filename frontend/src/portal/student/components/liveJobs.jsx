/** Live jobs from official company boards / job APIs (apply on the company site). */
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, CheckCircle2, Clock, ExternalLink, MapPin, Radio, ShieldCheck, X, AlertCircle } from 'lucide-react'
import { Alert, Badge, Button, LogoTile, Modal, Skeleton, timeAgo, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { JobTags, fmtSalary } from './shared.jsx'
import './student.css'

export const isExternalKey = (id) => typeof id === 'string' && id.startsWith('ext-')
export const externalIdOf = (id) => (isExternalKey(id) ? Number(id.slice(4)) : Number(id))

/**
 * Open an official listing outside the app. Must run synchronously inside the
 * click handler so browsers don't block the new tab. On native (Capacitor)
 * the Browser plugin is used when present, otherwise the system browser.
 */
export function openExternal(url) {
  if (!url || !/^https:\/\//i.test(url)) return false
  try {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null
    const browser = cap?.isNativePlatform?.() ? cap?.Plugins?.Browser : null
    if (browser?.open) { browser.open({ url }); return true }
  } catch { /* fall through to window.open */ }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/** "posted 2d ago · checked 3h ago" */
export function freshness(job) {
  const p = job.posted_at ? `posted ${timeAgo(job.posted_at)}` : ''
  const c = job.last_checked_at ? `checked ${timeAgo(job.last_checked_at)}` : ''
  return [p, c].filter(Boolean).join(' · ').replace('posted just now', 'posted today')
}

export function LiveBadge({ job, compact }) {
  const src = (job.source_label || '').split(' · ').pop()
  return (
    <span className="st-live-badge" title={`${job.source_label} — official listing, apply on the company site`}>
      <Radio size={12} aria-hidden="true" />{compact ? 'Live' : `Live · ${src}`}
    </span>
  )
}

/**
 * Click-out + "Did you apply?" follow-up.
 * const ext = useExternalApply({ onChange }); ext.apply(job); {ext.prompt}
 */
export function useExternalApply({ onChange } = {}) {
  const api = useApi('candidate')
  const toast = useToast()
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  const apply = useCallback((job) => {
    const ok = openExternal(job.apply_url)
    if (!ok) return toast('This listing has no valid apply link any more', 'error')
    api.post(`/api/student/external-jobs/${job.external_job_id}/track`, { action: 'clicked' }).catch(() => {})
    if (!job.applied) setPending(job)
  }, [api, toast])

  const mark = useCallback(async (job, action = 'applied') => {
    setBusy(true)
    try {
      const r = await api.post(`/api/student/external-jobs/${job.external_job_id}/track`, { action })
      toast(action === 'applied' ? 'Marked as applied — find it under Applications' : 'Removed from your applied list', 'success')
      setPending(null)
      onChange?.(job, r)
      return r
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
    return null
  }, [api, toast, onChange])

  const prompt = pending ? (
    <div className="st-apply-prompt" role="status" aria-live="polite">
      <CheckCircle2 size={20} color="var(--cl-blue)" style={{ flex: '0 0 auto' }} />
      <div className="cl-grow" style={{ minWidth: 0 }}>
        <strong>Did you apply?</strong>
        <small className="cl-ellipsis">{pending.title} · {pending.company}</small>
      </div>
      <Button size="sm" loading={busy} onClick={() => mark(pending)}>Mark as applied</Button>
      <button type="button" className="cl-icon-btn" aria-label="Not yet" title="Not yet" onClick={() => setPending(null)}><X size={16} /></button>
    </div>
  ) : null

  return { apply, mark, prompt, pending }
}

/** Detail view for a live listing (opened from the opportunities list or saved jobs). */
export function ExternalJobModal({ jobId, onClose, saved, onToggleSave, onChanged }) {
  const api = useApi('candidate')
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const ext = useExternalApply({ onChange: (_j, r) => { setJob((j) => ({ ...j, applied: r.applied, applied_at: r.applied_at })); onChanged?.() } })
  const id = externalIdOf(jobId)

  useEffect(() => {
    if (!jobId) return
    setJob(null); setError(null)
    api.get(`/api/student/external-jobs/${id}`).then(setJob).catch(setError)
  }, [jobId, id, api])

  const salary = job && fmtSalary(job)
  const official = job?.posting_url || job?.apply_url
  return (
    <Modal open={!!jobId} onClose={onClose} size="lg" title={job ? job.title : 'Job details'}
      footer={job && !error && (
        <>
          {!job.expired && onToggleSave && <Button variant="secondary" icon={Bookmark} onClick={() => onToggleSave?.(`ext-${job.external_job_id}`)}>{saved ? 'Saved' : 'Save job'}</Button>}
          {job.applied
            ? <Button variant="outline" onClick={() => ext.mark(job, 'not_applied')}>Unmark applied</Button>
            : !job.expired && <Button variant="outline" icon={CheckCircle2} onClick={() => ext.mark(job)}>Mark as applied</Button>}
          {!job.expired && job.apply_url && <Button iconRight={ExternalLink} onClick={() => ext.apply(job)}>Apply on company site</Button>}
        </>
      )}>
      {error && <Alert tone="error">{error.message}</Alert>}
      {!job && !error && <div className="cl-col"><Skeleton h={22} w="60%" /><Skeleton h={14} /><Skeleton h={120} /></div>}
      {job && (
        <div className="cl-col" style={{ gap: 14 }}>
          <div className="cl-row" style={{ alignItems: 'flex-start' }}>
            <LogoTile name={job.company} size={52} />
            <div className="cl-grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--cl-ink)', fontSize: 16 }}>{job.company}</div>
              <div className="cl-meta" style={{ marginTop: 4 }}>
                <span><MapPin size={14} />{job.location || '—'}</span>
                {salary && <span>{salary}</span>}
                <span><Clock size={14} />{freshness(job)}</span>
              </div>
            </div>
            <LiveBadge job={job} />
          </div>
          <JobTags job={job} max={8} />
          {job.expired && <Alert tone="warn" icon={AlertCircle}>This listing has closed on the company site, so the apply link was removed.</Alert>}
          {job.applied && <Alert tone="success" icon={CheckCircle2}>You marked this as applied{job.applied_at ? ` on ${new Date(job.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}. Track it under <Link to="/candidate/applications?tab=external">Applications → Company sites</Link>.</Alert>}
          {!job.expired && !job.applied && (
            <Alert icon={ExternalLink}>You apply for this role directly on {job.company}’s official careers site. Come back and mark it as applied to keep track of it here.</Alert>
          )}
          {ext.prompt}
          <div>
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>About the role</h4>
            {job.description
              ? <div className="st-pre">{job.description}</div>
              : <p className="cl-muted">The full description is on the official listing.</p>}
          </div>
          {(job.skills || []).length > 0 && (
            <div>
              <h4 style={{ fontSize: 15, marginBottom: 8 }}>Skills mentioned</h4>
              <div className="st-tag-row">
                {job.skills_have.map((s) => <span key={s} className="st-tag green">{s}</span>)}
                {job.skills_missing.map((s) => <span key={s} className="st-tag">{s}</span>)}
              </div>
            </div>
          )}
          <div className="st-source-note">
            <ShieldCheck size={16} />
            <span>Source: <b>{job.source_label}</b> (official listing){official && !job.expired && <> · <a href={official} target="_blank" rel="noopener noreferrer">view original <ExternalLink size={12} /></a></>}<br />
              <small className="cl-muted">Re-checked against the source every sync; closed listings are removed automatically.</small></span>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function ExternalStatus({ job }) {
  if (job.applied) return <Badge tone="blue">Applied</Badge>
  return null
}
