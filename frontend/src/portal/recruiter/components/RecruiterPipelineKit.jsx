/**
 * Shared building blocks for recruiter pages 13–17 (Dashboard, Jobs,
 * Candidates, Applications, Shortlisted): branch badges, match pills, stage
 * pills, KPI tiles with real period deltas, bulk-action helpers and the
 * reject / email / AI-result dialogs.
 */
import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, BadgeCheck, Mail, XCircle } from 'lucide-react'
import {
  Alert, Badge, Button, Field, Input, Modal, Skeleton, StatusPill, Textarea, downloadCsv, fmtDate, fmtTime, useToast,
} from '../../../ui/index.jsx'
import { BRANCHES, BRANCH_BY_ID, getBranch } from '../../../branding/branches.js'
import './RecruiterPages.css'

export const API = '/api/recruiter/portal'

/* ── Branches ────────────────────────────────────────────────────────── */
const SOFTWARE = { id: 'software', label: 'CS / Software', long: 'Computer Science / Software', color: '#475569', soft: '#f1f5f9' }
const UNKNOWN = { id: null, label: '—', long: 'Not specified', color: '#64748b', soft: '#f1f5f9' }

/** Like getBranch() but never silently maps unknown / software values to Mechanical. */
export function branchMeta(value) {
  if (!value) return UNKNOWN
  const key = String(value).trim().toLowerCase()
  if (['software', 'cs', 'cse', 'computer science', 'it', 'cs / software'].includes(key)) return SOFTWARE
  if (BRANCH_BY_ID[key]) return BRANCH_BY_ID[key]
  const b = getBranch(key)
  if (b.id === 'mechanical' && !key.includes('mech')) return { ...UNKNOWN, label: value, long: value }
  return b
}

export const BRANCH_OPTIONS = BRANCHES.map((b) => ({ value: b.id, label: b.label }))

const SHORT_BRANCH = { ece: 'ECE', eee: 'Electrical', metallurgy: 'Metallurgy', software: 'CS / IT' }
export function BranchBadge({ branch, long }) {
  const b = branchMeta(branch)
  if (!b.id && !branch) return <span className="cl-muted">—</span>
  return <span className="rp-branch" title={b.long} style={{ color: b.color, background: b.soft }}>{long ? b.long : (SHORT_BRANCH[b.id] || b.label)}</span>
}

/* ── Scores / stages ─────────────────────────────────────────────────── */
export function matchTone(m) {
  if (m == null) return ''
  return m >= 80 ? 'green' : m >= 65 ? 'amber' : 'red'
}
export function MatchPill({ value, suffix = '' }) {
  if (value == null) return <span className="cl-muted" title="No score yet">—</span>
  return <Badge tone={matchTone(value)} className="rp-match">{Math.round(value)}%{suffix}</Badge>
}

const STAGE_STATUS = { under_review: 'under_review', shortlisted: 'shortlisted', interview: 'interview_scheduled', offer: 'offer', rejected: 'rejected', hired: 'hired' }
const STAGE_LABEL = { under_review: 'Under Review', shortlisted: 'Shortlisted', interview: 'Interview Scheduled', offer: 'Offer', rejected: 'Rejected', hired: 'Hired' }
export function StagePill({ stage }) {
  if (!stage) return <span className="cl-muted">—</span>
  return <StatusPill status={STAGE_STATUS[stage] || stage} label={STAGE_LABEL[stage]} />
}
const IV_LABEL = { interview_scheduled: 'Interview Scheduled', interview_completed: 'Interview Completed', under_review: 'Under Review' }
export function InterviewPill({ state }) {
  const status = state === 'interview_completed' ? 'completed' : state === 'interview_scheduled' ? 'interview_scheduled' : 'under_review'
  return <StatusPill status={status} label={IV_LABEL[state] || 'Under Review'} />
}

export const JOB_STATUS_LABEL = { open: 'Active', paused: 'Paused', closed: 'Closed', draft: 'Draft', archived: 'Archived' }
export function JobStatusPill({ status }) {
  return <StatusPill status={status} label={JOB_STATUS_LABEL[status] || status} />
}

export const JOB_TYPES = [
  { value: 'internship', label: 'Internship' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'apprenticeship', label: 'Apprenticeship' },
  { value: 'contract', label: 'Contract' },
]
export const EXPERIENCE = [
  { value: 'fresher', label: 'Fresher' },
  { value: '0-2', label: '0–2 years' },
  { value: '2-5', label: '2–5 years' },
  { value: '5+', label: '5+ years' },
]
export const jobTypeLabel = (t) => JOB_TYPES.find((x) => x.value === t)?.label || (t ? t : '—')
export const expLabel = (t) => EXPERIENCE.find((x) => x.value === t)?.label || (t || '—')

export const yearLine = (r) => [r?.current_year, r?.grad_year ? `(${r.grad_year})` : null].filter(Boolean).join(' ') || (r?.grad_year ? `Class of ${r.grad_year}` : '')
export const cityOf = (s) => (s || '').split(',')[0].trim()

export function VerifiedTick({ show, size = 16 }) {
  if (!show) return null
  return <span className="rp-verified" title="Has verified projects" aria-label="Has verified projects" role="img"><BadgeCheck size={size} /></span>
}

/* ── KPI tile with a real period-over-period delta ─────────────────── */
export function Kpi({ icon: Icon, tone, label, kpi, loading, days = 30 }) {
  if (loading) return <div className="cl-card" style={{ padding: 16 }}><Skeleton h={46} /></div>
  const k = kpi || {}
  let delta = null
  let up = true
  let note = `vs prev ${days}d`
  if (k.delta_pct != null) { delta = `${Math.abs(k.delta_pct)}%`; up = k.delta_pct >= 0 }
  else if (k.current_period > 0) { delta = `+${k.current_period}`; note = `new · ${days}d` }
  return (
    <div className="cl-card rp-kpi">
      <div className={`cl-stat-icon ${tone || ''}`}>{Icon && <Icon size={22} />}</div>
      <div className="cl-grow" style={{ minWidth: 0 }}>
        <div className="cl-stat-value">{(k.value ?? 0).toLocaleString()}</div>
        <div className="cl-stat-label">{label}</div>
        {delta ? (
          <div className={`rp-kpi-delta ${up ? 'up' : 'down'}`} title={`${k.current_period ?? 0} in the last ${days} days vs ${k.previous_period ?? 0} in the ${days} days before`}>
            {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}<b>{delta}</b> <small>{note}</small>
          </div>
        ) : <div className="rp-kpi-delta flat"><small>No change · {days}d</small></div>}
      </div>
    </div>
  )
}

/* ── Pipeline bars ───────────────────────────────────────────────────── */
const BAR_COLORS = { rejected: '#ef4444', offer: '#64748b', hired: '#10b981', hr_round: '#3b82f6' }
export function PipelineBars({ rows = [], colors = {} }) {
  return (
    <div className="rp-pipe">
      {rows.map((r, i) => (
        <div className="rp-pipe-row" key={r.key}>
          <span>{r.label}</span>
          <div className="cl-progress"><div style={{ width: `${Math.max(r.count ? 3 : 0, r.pct)}%`, background: colors[r.key] || BAR_COLORS[r.key] || (i === 0 ? 'var(--cl-blue)' : '#5b8def') }} /></div>
          <b>{r.count} <small>({r.pct}%)</small></b>
        </div>
      ))}
    </div>
  )
}

/* ── Actions ─────────────────────────────────────────────────────────── */
/** Bulk / single application actions with consistent toasts + navigation. */
export function useAppActions(api, onDone) {
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const bulk = useCallback(async (ids, action, extra = {}) => {
    if (!ids?.length) { toast('Select at least one application first', 'error'); return null }
    setBusy(true)
    try {
      const r = await api.post(`${API}/applications/bulk`, { ids, action, ...extra })
      const anyFail = r.results?.some((x) => !x.ok)
      toast(r.message, r.ok ? (anyFail ? 'info' : 'success') : 'error')
      const nav = action === 'next_stage' && ids.length === 1 && r.results?.[0]?.navigate
      onDone?.(r)
      if (nav) navigate(nav)
      return r
    } catch (e) {
      toast(e.message, 'error')
      return null
    } finally { setBusy(false) }
  }, [api, toast, navigate, onDone])
  const nextStage = useCallback((id) => bulk([id], 'next_stage'), [bulk])
  const unlock = useCallback(async (row) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('notes', 'Unlocked from Applications Management')
      await api.post(`/api/recruiter/jobs/${row.job_id}/applicants/${row.application_id}/unlock-interview`, fd)
      toast(`AI interview unlocked for ${row.candidate_name}`, 'success')
      onDone?.()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }, [api, toast, onDone])
  return { bulk, nextStage, unlock, busy }
}

export function RejectModal({ open, onClose, count, names, onConfirm, busy }) {
  const [reason, setReason] = useState('')
  return (
    <Modal open={open} onClose={onClose} title={count > 1 ? `Reject ${count} applications` : `Reject ${names || 'application'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" icon={XCircle} loading={busy} onClick={async () => { await onConfirm(reason.trim()); setReason('') }}>Reject</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <Alert tone="warn">This is a human decision recorded in the audit log under your name. Candidates are never auto-rejected.</Alert>
        <Field label="Reason (optional)" hint="Saved with the decision; not emailed to the candidate."><Textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Location preference does not match" /></Field>
      </div>
    </Modal>
  )
}

export function EmailModal({ open, onClose, count, onSend, busy, defaultSubject = '' }) {
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState('')
  const [err, setErr] = useState(null)
  async function send() {
    setErr(null)
    if (!subject.trim()) return setErr('Add a subject line.')
    if (body.trim().length < 5) return setErr('Write a short message (at least 5 characters).')
    const r = await onSend({ subject: subject.trim(), body: body.trim() })
    if (r) { setBody(''); onClose() }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Email ${count} candidate${count === 1 ? '' : 's'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Mail} loading={busy} onClick={send}>Send email</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p className="cl-muted">Each candidate gets a personal copy at the email on their profile — addresses are never shown to other candidates.</p>
        <Field label="Subject"><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Update on your application" /></Field>
        <Field label="Message"><Textarea rows={6} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="Hi, thanks for applying…" /></Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

/** AI interview result: scores + transcript Q&A. */
export function AiResultModal({ open, onClose, api, applicationId }) {
  const [state, setState] = useState({ loading: true })
  React.useEffect(() => {
    if (!open || !applicationId) return
    let alive = true
    setState({ loading: true })
    api.get(`${API}/applications/${applicationId}`).then((d) => alive && setState({ data: d })).catch((e) => alive && setState({ error: e.message }))
    return () => { alive = false }
  }, [open, applicationId, api])
  const d = state.data
  return (
    <Modal open={open} onClose={onClose} size="lg" title={d ? `AI interview — ${d.candidate_name}` : 'AI interview result'}>
      {state.loading && <Skeleton h={120} />}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {d && <AiResultBody d={{ ...d, eval_score: d.interview_eval_score, recommendation: d.interview_recommendation, risk_level: d.interview_risk_level, status: d.interview_status }} />}
    </Modal>
  )
}

export function AiResultBody({ d }) {
  return (
    <div className="cl-col" style={{ gap: 14 }}>
      <div className="rp-mini-stats">
        <div><b>{d.eval_score ?? '—'}</b><span>Evaluation score</span></div>
        <div><b style={{ textTransform: 'capitalize' }}>{d.risk_level || '—'}</b><span>Integrity risk</span></div>
        <div><b style={{ textTransform: 'capitalize' }}>{(d.status || '—').replace('_', ' ')}</b><span>Status</span></div>
      </div>
      {d.recommendation && <Alert>{d.recommendation}</Alert>}
      {d.transcript?.length ? (
        <ol className="rp-transcript">
          {d.transcript.map((t, i) => (
            <li key={i}>
              <div className="q"><Badge tone="blue">{t.kind || 'Q'}</Badge> {t.question}</div>
              <div className="a">{t.answer || <span className="cl-muted">No answer recorded</span>}</div>
              {t.follow_ups?.map((f, j) => (
                <div key={j} className="fu"><div className="q">↳ {f.question}</div><div className="a">{f.answer || <span className="cl-muted">No answer</span>}</div></div>
              ))}
            </li>
          ))}
        </ol>
      ) : <p className="cl-muted">No transcript recorded yet.</p>}
      {d.evidence_url && <a href={d.evidence_url} target="_blank" rel="noreferrer" className="cl-link">Open interview evidence</a>}
    </div>
  )
}

/* ── CSV export ──────────────────────────────────────────────────────── */
export function exportApplications(rows, filename = 'applications.csv') {
  const out = rows.map((r) => ({
    'Application ID': r.application_id,
    Candidate: r.candidate_name,
    College: r.college || '',
    Branch: branchMeta(r.branch).label,
    CGPA: r.cgpa ?? '',
    'Applied For': r.job_title,
    'Job ID': r.job_code,
    'Match %': r.match ?? '',
    'ATS Score': r.ats_score ?? '',
    'Project Score': r.project_score ?? '',
    'Interview Score': r.interview_eval_score ?? '',
    Stage: STAGE_LABEL[r.stage] || r.stage,
    'Interview Status': IV_LABEL[r.interview_state] || '',
    'Next Step': r.next_step?.starts_at ? `${r.next_step.round_name} ${fmtDate(r.next_step.starts_at)} ${fmtTime(r.next_step.starts_at)}` : (r.next_step?.label || ''),
    'Applied On': fmtDate(r.applied_at),
  }))
  downloadCsv(filename, out)
}

export function nextStepText(n) {
  if (!n) return '—'
  if (n.starts_at) return `${n.round_name}`
  return n.label
}
