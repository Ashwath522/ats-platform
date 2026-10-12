import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'

export const ROUNDS = ['Technical Round 1', 'Technical Round 2', 'Project Discussion', 'HR Round', 'Managerial Round']

/**
 * Shared "Schedule Interview" dialog (Candidates, Applications, Shortlisted,
 * Interviews pages). Contract: POST /api/recruiter/hiring/interviews
 *   {application_id, round_name, starts_at (ISO), duration_min, mode, meeting_link, location, interviewers, notify}
 * `applications`: [{application_id, candidate_name, job_title}] — one or many (bulk).
 */
export default function ScheduleInterviewModal({ open, onClose, applications = [], onScheduled }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const tomorrow = new Date(Date.now() + 86400000)
  const [form, setForm] = useState({
    round_name: ROUNDS[0],
    date: tomorrow.toISOString().slice(0, 10),
    time: '10:00',
    duration_min: 60,
    mode: 'online',
    meeting_link: '',
    location: '',
    interviewers: '',
    notify: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) setError(null) }, [open])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  async function submit() {
    setError(null)
    if (!applications.length) return setError('Pick at least one candidate.')
    if (form.mode === 'online' && form.meeting_link && !/^https?:\/\//.test(form.meeting_link)) return setError('Meeting link must start with http:// or https://')
    const starts = new Date(`${form.date}T${form.time}`)
    if (Number.isNaN(starts.getTime()) || starts.getTime() < Date.now() - 60000) return setError('Choose a date and time in the future.')
    setBusy(true)
    try {
      let n = 0
      for (const [i, a] of applications.entries()) {
        // Bulk: stagger slots back-to-back so candidates don't collide.
        const slot = new Date(starts.getTime() + i * Number(form.duration_min) * 60000)
        await api.post('/api/recruiter/hiring/interviews', {
          application_id: a.application_id,
          round_name: form.round_name,
          starts_at: slot.toISOString(),
          duration_min: Number(form.duration_min),
          mode: form.mode,
          meeting_link: form.meeting_link || null,
          location: form.location || null,
          interviewers: form.interviewers,
          notify: form.notify,
        })
        n += 1
      }
      toast(`Scheduled ${n} interview${n > 1 ? 's' : ''}${form.notify ? ' — invitations emailed' : ''}`, 'success')
      onScheduled?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={applications.length > 1 ? `Schedule ${applications.length} interviews` : `Schedule interview${applications[0]?.candidate_name ? ` — ${applications[0].candidate_name}` : ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CalendarDays} loading={busy} onClick={submit}>Schedule</Button></>}
    >
      <div className="cl-col" style={{ gap: 14 }}>
        {applications.length > 1 && <p className="cl-muted">Slots are booked back-to-back from the start time ({applications.length} × {form.duration_min} min).</p>}
        <div className="cl-grid cl-grid-2">
          <Field label="Round"><Select value={form.round_name} onChange={set('round_name')} options={ROUNDS} /></Field>
          <Field label="Mode"><Select value={form.mode} onChange={set('mode')} options={[{ value: 'online', label: 'Online' }, { value: 'onsite', label: 'Onsite' }]} /></Field>
          <Field label="Date"><Input type="date" value={form.date} onChange={set('date')} min={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="Start time"><Input type="time" value={form.time} onChange={set('time')} /></Field>
          <Field label="Duration"><Select value={String(form.duration_min)} onChange={set('duration_min')} options={['30', '45', '60', '90'].map((v) => ({ value: v, label: `${v} min` }))} /></Field>
          {form.mode === 'online'
            ? <Field label="Meeting link" hint="Google Meet / Teams / Zoom"><Input value={form.meeting_link} onChange={set('meeting_link')} placeholder="https://…" inputMode="url" /></Field>
            : <Field label="Location"><Input value={form.location} onChange={set('location')} placeholder="Office address / room" /></Field>}
        </div>
        <Field label="Interviewers" hint="Names or emails, comma-separated"><Textarea rows={2} value={form.interviewers} onChange={set('interviewers')} placeholder="P. Kumar, s.iyer@company.com" /></Field>
        <label className="cl-row" style={{ fontSize: 14 }}><input type="checkbox" className="cl-check" checked={form.notify} onChange={set('notify')} /> Email the invitation to the candidate</label>
        {error && <div className="cl-alert error" role="alert">{error}</div>}
      </div>
    </Modal>
  )
}
