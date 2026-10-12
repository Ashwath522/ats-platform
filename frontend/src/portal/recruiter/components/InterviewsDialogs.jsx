/** Dialogs for the Interviews page (18): pick candidates, reschedule/edit, feedback, details, cancel, round templates. */
import React, { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, ExternalLink, MapPin, Plus, Search, Trash2, Users, Video, XCircle } from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, EmptyState, Field, Input, Modal, Select, Skeleton, StatusPill, Textarea, useToast,
} from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import { BranchTag, H, ModeBadge, Stars, fmtD, fmtDT, fmtRange, inputDate, inputTime, roundColor, toIso } from './HiringCommon.jsx'

export const REC_LABEL = { strong_hire: 'Strong hire', hire: 'Hire', no_hire: 'No hire' }
export const REC_TONE = { strong_hire: 'green', hire: 'blue', no_hire: 'red' }
const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240]

/** Step 1 of "Schedule Interview": choose shortlisted / interview-stage applications of my jobs. */
export function InterviewsPickModal({ open, onClose, onPick }) {
  const api = useApi('recruiter')
  const q = useQuery(() => (open ? api.get(`${H}/applications?stage=interview`) : Promise.resolve(null)), [open, api])
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState(new Set())
  useEffect(() => { if (open) { setSel(new Set()); setSearch('') } }, [open])
  const items = (q.data?.items || []).filter((a) => !search || `${a.candidate_name} ${a.job_title} ${a.college || ''}`.toLowerCase().includes(search.toLowerCase()))
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const chosen = (q.data?.items || []).filter((a) => sel.has(a.application_id))
  return (
    <Modal open={open} onClose={onClose} title="Schedule interview — choose candidates" size="lg"
      footer={<><span className="hr-small" style={{ marginRight: 'auto' }}>{sel.size} selected</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!sel.size} onClick={() => onPick(chosen.map((a) => ({ application_id: a.application_id, candidate_name: a.candidate_name, job_title: a.job_title })))}>Continue</Button></>}>
      <p className="hr-sub">Shortlisted and interview-stage candidates across your jobs. Pick one, or several to book back-to-back slots.</p>
      <div style={{ marginTop: 12 }}><Input icon={Search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by candidate, job or college…" aria-label="Search candidates" /></div>
      {q.loading ? <div className="cl-col" style={{ marginTop: 12 }}><Skeleton h={54} /><Skeleton h={54} /><Skeleton h={54} /></div>
        : q.error ? <div style={{ marginTop: 12 }}><Alert tone="error">{q.error.message}</Alert></div>
        : items.length === 0 ? <EmptyState icon={Users} title="No shortlisted candidates" text="Shortlist applicants on the Applications page first." action={<Button size="sm" variant="outline" to="/recruiter/applications">Open Applications</Button>} />
        : (
          <div className="hr-pick" role="listbox" aria-multiselectable="true">
            {items.map((a) => (
              <label key={a.application_id} className={sel.has(a.application_id) ? 'on' : ''}>
                <input type="checkbox" className="cl-check" checked={sel.has(a.application_id)} onChange={() => toggle(a.application_id)} />
                <Avatar name={a.candidate_name} src={a.avatar_url} size={36} />
                <div className="cl-grow">
                  <strong className="hr-ink" style={{ display: 'block' }}>{a.candidate_name}</strong>
                  <span className="hr-small">{a.job_title}{a.college ? ` · ${a.college}` : ''}</span>
                </div>
                <BranchTag branch={a.branch} />
                {a.interviews > 0 && <Badge tone="blue">{a.interviews} round{a.interviews > 1 ? 's' : ''}</Badge>}
              </label>
            ))}
          </div>
        )}
    </Modal>
  )
}

/** Reschedule / edit an interview (PATCH). */
export function InterviewsEditModal({ iv, rounds = [], onClose, onSaved }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (iv) {
      setF({ date: inputDate(iv.starts_at), time: inputTime(iv.starts_at), duration_min: iv.duration_min || 60, round_name: iv.round_name, mode: iv.mode,
        meeting_link: iv.meeting_link || '', location: iv.location || '', interviewers: iv.interviewers || '', notify: true })
      setErr(null)
    }
  }, [iv])
  if (!iv || !f) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const roundOpts = [...new Set([...rounds.map((r) => r.name), iv.round_name])]
  async function save() {
    setErr(null)
    const start = new Date(`${f.date}T${f.time}`)
    if (Number.isNaN(start.getTime())) return setErr('Choose a valid date and time.')
    if (start.getTime() < Date.now()) return setErr('Choose a time in the future.')
    if (f.mode === 'online' && f.meeting_link && !/^https?:\/\/\S+\.\S+/.test(f.meeting_link)) return setErr('Meeting link must be a full URL (https://…).')
    setBusy(true)
    try {
      const body = { round_name: f.round_name, duration_min: Number(f.duration_min), mode: f.mode, meeting_link: f.mode === 'online' ? (f.meeting_link || null) : null,
        location: f.location || null, interviewers: f.interviewers, notify: f.notify }
      if (start.toISOString() !== new Date(iv.starts_at).toISOString()) body.starts_at = toIso(f.date, f.time)
      if (iv.status !== 'scheduled') body.status = 'scheduled'
      const r = await api.patch(`${H}/interviews/${iv.id}`, body)
      toast(body.starts_at ? `Interview rescheduled to ${fmtDT(r.starts_at)}${f.notify && r.email_id ? ' — candidate notified' : ''}` : 'Interview updated', 'success')
      onSaved?.(r)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Reschedule — ${iv.candidate_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CalendarClock} loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <p className="hr-sub">{iv.job_title} · currently {fmtDT(iv.starts_at)}</p>
        <div className="cl-grid cl-grid-2">
          <Field label="Round"><Select value={f.round_name} onChange={set('round_name')} options={roundOpts} /></Field>
          <Field label="Mode"><Select value={f.mode} onChange={set('mode')} options={[{ value: 'online', label: 'Online' }, { value: 'onsite', label: 'Onsite' }]} /></Field>
          <Field label="Date"><Input type="date" value={f.date} min={inputDate(new Date())} onChange={set('date')} /></Field>
          <Field label="Start time" hint="Your local time"><Input type="time" value={f.time} onChange={set('time')} /></Field>
          <Field label="Duration"><Select value={String(f.duration_min)} onChange={set('duration_min')} options={DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))} /></Field>
          {f.mode === 'online'
            ? <Field label="Meeting link"><Input value={f.meeting_link} onChange={set('meeting_link')} placeholder="https://…" inputMode="url" /></Field>
            : <Field label="Location"><Input value={f.location} onChange={set('location')} placeholder="Office address / room" /></Field>}
        </div>
        <Field label="Interviewers" hint="Names or emails, comma-separated"><Input value={f.interviewers} onChange={set('interviewers')} /></Field>
        <label className="cl-row" style={{ fontSize: 14 }}><input type="checkbox" className="cl-check" checked={f.notify} onChange={set('notify')} /> Email the candidate if the time changes</label>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

/** Feedback: rating 1–5, recommendation, notes → marks the interview completed. */
export function InterviewsFeedbackModal({ iv, onClose, onSaved }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [rating, setRating] = useState(0)
  const [rec, setRec] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (iv) { setRating(iv.feedback?.rating || 0); setRec(iv.feedback?.recommendation || ''); setNotes(iv.feedback?.notes || ''); setErr(null) }
  }, [iv])
  if (!iv) return null
  async function save() {
    if (!rating) return setErr('Give a rating from 1 to 5.')
    if (!rec) return setErr('Choose a recommendation.')
    setBusy(true); setErr(null)
    try {
      const r = await api.patch(`${H}/interviews/${iv.id}`, { feedback: { rating, recommendation: rec, notes: notes.trim() } })
      toast('Feedback saved — interview marked completed', 'success')
      onSaved?.(r); onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Interview feedback"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CheckCircle2} loading={busy} onClick={save}>Save feedback</Button></>}>
      <div className="cl-col" style={{ gap: 16 }}>
        <div className="cl-row">
          <Avatar name={iv.candidate_name} src={iv.candidate_avatar} size={42} />
          <div><strong className="hr-ink">{iv.candidate_name}</strong><div className="hr-small">{iv.job_title} · {iv.round_name} · {fmtDT(iv.starts_at)}</div></div>
        </div>
        <Field label="Overall rating"><Stars value={rating} onChange={setRating} size={28} /></Field>
        <div className="cl-field"><span>Recommendation</span>
          <div className="hr-rec" role="radiogroup" aria-label="Recommendation">
            {Object.entries(REC_LABEL).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={rec === k} className={`${k} ${rec === k ? 'on' : ''}`} onClick={() => setRec(k)}>{l}</button>)}
          </div>
        </div>
        <Field label="Notes" hint="Strengths, concerns, topics covered (max 4000 characters)"><Textarea rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

/** Cancel with optional candidate email. */
export function InterviewsCancelModal({ iv, onClose, onDone }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!iv) return null
  async function go() {
    setBusy(true)
    try {
      await api.del(`${H}/interviews/${iv.id}?notify=${notify}`)
      toast(`Interview cancelled${notify ? ' — candidate notified' : ''}`, 'success')
      onDone?.(); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Cancel interview?"
      footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" icon={XCircle} loading={busy} onClick={go}>Cancel interview</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p>{iv.round_name} with <strong>{iv.candidate_name}</strong> on {fmtDT(iv.starts_at)} will be cancelled. It stays in the history as “Cancelled”.</p>
        <label className="cl-row" style={{ fontSize: 14 }}><input type="checkbox" className="cl-check" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the candidate about the cancellation</label>
      </div>
    </Modal>
  )
}

/** Details view for a human or AI interview. */
export function InterviewsDetailsModal({ iv, rounds, onClose, onAction }) {
  const api = useApi('recruiter')
  const detail = useQuery(() => (iv && iv.kind === 'human' ? api.get(`${H}/interviews/${iv.id}`) : Promise.resolve(null)), [iv?.id, api])
  if (!iv) return null
  const d = detail.data || iv
  const isAi = iv.kind === 'ai'
  const ended = new Date(d.ends_at || d.starts_at).getTime() < Date.now()
  return (
    <Modal open onClose={onClose} title={isAi ? 'AI interview result' : 'Interview details'} size="lg"
      footer={isAi
        ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button to="/recruiter/applications">Open in Applications</Button></>
        : <>
          {d.status === 'scheduled' && <Button variant="danger" icon={XCircle} onClick={() => onAction('cancel', d)}>Cancel</Button>}
          {d.status !== 'cancelled' && <Button variant="secondary" icon={CheckCircle2} onClick={() => onAction('feedback', d)}>{d.has_feedback ? 'Edit feedback' : 'Add feedback'}</Button>}
          {d.status !== 'completed' && <Button variant="secondary" icon={CalendarClock} onClick={() => onAction('reschedule', d)}>{d.status === 'cancelled' ? 'Re-schedule' : 'Reschedule'}</Button>}
          {d.status === 'scheduled' && d.mode === 'online' && d.meeting_link && !ended && <Button icon={Video} href={d.meeting_link}>Join</Button>}
        </>}>
      <div className="cl-col" style={{ gap: 16 }}>
        <div className="cl-row cl-wrap" style={{ gap: 14 }}>
          <Avatar name={d.candidate_name} src={d.candidate_avatar} size={52} />
          <div className="cl-grow">
            <h3 style={{ fontSize: 18 }}>{d.candidate_name}</h3>
            <div className="hr-small">{d.job_title}{d.college ? ` · ${d.college}` : ''}{d.candidate_email ? ` · ${d.candidate_email}` : ''}</div>
          </div>
          <BranchTag branch={d.branch} />
          {d.pending_feedback ? <StatusPill status="pending" label="Pending Feedback" /> : <StatusPill status={d.status} />}
        </div>
        <dl className="hr-info" style={{ gridTemplateColumns: '130px minmax(0,1fr)' }}>
          <dt>Round</dt><dd><span className="cl-row" style={{ gap: 6, display: 'inline-flex' }}><i style={{ width: 8, height: 8, borderRadius: 9, background: roundColor(d.round_name, rounds) }} />{d.round_name}</span></dd>
          <dt>{isAi ? 'Completed' : 'When'}</dt><dd>{fmtD(d.starts_at, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}{!isAi && `, ${fmtRange(d.starts_at, d.ends_at)}`} <span className="hr-small">({Intl.DateTimeFormat().resolvedOptions().timeZone})</span></dd>
          {!isAi && <><dt>Duration</dt><dd><Clock size={13} style={{ verticalAlign: -2 }} /> {d.duration_min} min</dd></>}
          {!isAi && <><dt>Mode</dt><dd><ModeBadge mode={d.mode} /></dd></>}
          {!isAi && d.mode === 'online' && <><dt>Meeting link</dt><dd>{d.meeting_link ? <a href={d.meeting_link} target="_blank" rel="noreferrer">{d.meeting_link} <ExternalLink size={12} /></a> : <span className="cl-muted">Not added yet</span>}</dd></>}
          {!isAi && d.mode === 'onsite' && <><dt>Location</dt><dd><MapPin size={13} style={{ verticalAlign: -2 }} /> {d.location || '—'}</dd></>}
          <dt>Interviewers</dt><dd>{d.interviewers || '—'}</dd>
          {isAi && <><dt>Evaluation score</dt><dd><span className="hr-score">{d.eval_score ?? '—'}{d.eval_score != null && '/100'}</span></dd></>}
          {isAi && d.recommendation && <><dt>AI recommendation</dt><dd>{d.recommendation}</dd></>}
          {isAi && d.risk_level && <><dt>Integrity risk</dt><dd><StatusPill status={d.risk_level === 'high' ? 'high_risk' : d.risk_level === 'medium' ? 'review' : 'active'} label={d.risk_level} /></dd></>}
        </dl>
        {isAi && <Alert>AI interview results are read-only here. Review the transcript and evidence from the application.</Alert>}
        {!isAi && d.feedback && (
          <div className="hr-fb">
            <div className="cl-row" style={{ justifyContent: 'space-between' }}><strong className="hr-ink">Feedback</strong><Badge tone={REC_TONE[d.feedback.recommendation]}>{REC_LABEL[d.feedback.recommendation]}</Badge></div>
            <Stars value={d.feedback.rating} size={18} />
            {d.feedback.notes && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{d.feedback.notes}</p>}
            <span className="hr-small">by {d.feedback.by}{d.feedback.at ? ` · ${fmtDT(d.feedback.at)}` : ''}</span>
          </div>
        )}
        {!isAi && detail.data?.rounds?.length > 1 && (
          <div>
            <strong className="hr-ink">All rounds for this application</strong>
            <div className="cl-list" style={{ marginTop: 6 }}>
              {detail.data.rounds.map((r) => (
                <div className="cl-list-item" key={r.id} style={{ padding: '8px 0' }}>
                  <i style={{ width: 8, height: 8, borderRadius: 9, background: roundColor(r.round_name, rounds) }} />
                  <span className="cl-grow">{r.round_name}</span>
                  <span className="hr-small">{fmtDT(r.starts_at)}</span>
                  <StatusPill status={r.status} />
                </div>
              ))}
            </div>
          </div>
        )}
        {detail.error && <Alert tone="error">{detail.error.message}</Alert>}
      </div>
    </Modal>
  )
}

/** Interview round templates (CompanyProfile.preferences_json.rounds). */
export function InterviewsTemplatesModal({ open, onClose, rounds = [], onSave }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (open) { setRows(rounds.map((r) => ({ ...r }))); setErr(null) } }, [open, rounds])
  const upd = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  async function save() {
    const clean = rows.map((r) => ({ name: r.name.trim(), duration_min: Number(r.duration_min), description: (r.description || '').trim() }))
    if (!clean.length) return setErr('Keep at least one round.')
    if (clean.some((r) => !r.name)) return setErr('Every round needs a name.')
    if (new Set(clean.map((r) => r.name.toLowerCase())).size !== clean.length) return setErr('Round names must be unique.')
    setBusy(true); setErr(null)
    try { await onSave(clean); onClose() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Interview templates" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save templates</Button></>}>
      <p className="hr-sub">Standard rounds for your hiring process. They power the round list, colours on the calendar and the reschedule dialog.</p>
      <div>
        {rows.map((r, i) => (
          <div className="hr-edit-row" key={i}>
            <Field label={i === 0 ? 'Round name' : undefined}><Input value={r.name} maxLength={60} onChange={(e) => upd(i, 'name', e.target.value)} aria-label={`Round ${i + 1} name`} /></Field>
            <Field label={i === 0 ? 'Duration' : undefined}><Select value={String(r.duration_min)} onChange={(e) => upd(i, 'duration_min', e.target.value)} aria-label={`Round ${i + 1} duration`} options={DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))} /></Field>
            <Field label={i === 0 ? 'Focus' : undefined}><Input value={r.description || ''} maxLength={200} onChange={(e) => upd(i, 'description', e.target.value)} aria-label={`Round ${i + 1} focus`} placeholder="What this round covers" /></Field>
            <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${r.name || 'round'}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="cl-row" style={{ marginTop: 12 }}>
        <Button variant="outline" size="sm" icon={Plus} disabled={rows.length >= 12} onClick={() => setRows((rs) => [...rs, { name: '', duration_min: 60, description: '' }])}>Add round</Button>
        <span className="hr-small">{rows.length}/12 rounds</span>
      </div>
      {err && <div style={{ marginTop: 12 }}><Alert tone="error">{err}</Alert></div>}
    </Modal>
  )
}
