/** Dialogs for Recruiter Settings (page 22): password, job defaults, login activity / session. */
import React, { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Monitor, Save } from 'lucide-react'
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { H, fmtDT } from './HiringCommon.jsx'

export function PasswordModal({ open, onClose, onChanged }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setF({ current: '', next: '', confirm: '' }); setErr({}) } }, [open])
  if (!open) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save() {
    const e = {}
    if (!f.current) e.current = 'Enter your current password'
    if (f.next.length < 8) e.next = 'At least 8 characters'
    else if (!/[A-Za-z]/.test(f.next) || !/\d/.test(f.next)) e.next = 'Use letters and numbers'
    else if (f.next === f.current) e.next = 'Must differ from the current password'
    if (f.confirm !== f.next) e.confirm = 'Passwords do not match'
    setErr(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const r = await api.post(`${H}/account/password`, { current_password: f.current, new_password: f.next })
      toast('Password changed', 'success'); onChanged?.(r); onClose()
    } catch (x) { setErr({ form: x.message }) } finally { setBusy(false) }
  }
  const type = show ? 'text' : 'password'
  const eye = <button type="button" className="cl-icon-btn" style={{ position: 'absolute', right: 6 }} onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide passwords' : 'Show passwords'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  return (
    <Modal open onClose={onClose} title="Change password"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={KeyRound} loading={busy} onClick={save}>Update password</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <Field label="Current password" error={err.current}><Input type={type} autoComplete="current-password" value={f.current} onChange={set('current')} right={eye} /></Field>
        <Field label="New password" hint="At least 8 characters with letters and numbers" error={err.next}><Input type={type} autoComplete="new-password" value={f.next} onChange={set('next')} /></Field>
        <Field label="Confirm new password" error={err.confirm}><Input type={type} autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
        {err.form && <Alert tone="error">{err.form}</Alert>}
      </div>
    </Modal>
  )
}

const JOB_TYPES = [{ value: 'full-time', label: 'Full-time' }, { value: 'internship', label: 'Internship' }, { value: 'part-time', label: 'Part-time' }, { value: 'apprenticeship', label: 'Apprenticeship' }]
const EXP = [{ value: 'fresher', label: 'Fresher' }, { value: '0-2', label: '0–2 years' }, { value: '2-5', label: '2–5 years' }, { value: '5+', label: '5+ years' }]
const REMOTE = [{ value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' }]

export function JobDefaultsModal({ open, defaults, onClose, onSave }) {
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (open) { setF({ ...defaults, openings: String(defaults?.openings ?? 1) }); setErr(null) } }, [open, defaults])
  if (!open || !f) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save() {
    const n = Number(f.openings)
    if (!Number.isInteger(n) || n < 1 || n > 500) return setErr('Openings must be a whole number from 1 to 500.')
    setBusy(true); setErr(null)
    try {
      await onSave({ job_type: f.job_type, experience_level: f.experience_level, remote_type: f.remote_type, openings: n, location: (f.location || '').trim(), eligibility: (f.eligibility || '').trim() })
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Job posting defaults"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Save} loading={busy} onClick={save}>Save defaults</Button></>}>
      <p className="hr-sub" style={{ marginBottom: 12 }}>Pre-filled when you create a new job. You can still change them on each job.</p>
      <div className="cl-grid cl-grid-2">
        <Field label="Job type"><Select value={f.job_type} onChange={set('job_type')} options={JOB_TYPES} /></Field>
        <Field label="Experience level"><Select value={f.experience_level} onChange={set('experience_level')} options={EXP} /></Field>
        <Field label="Work mode"><Select value={f.remote_type} onChange={set('remote_type')} options={REMOTE} /></Field>
        <Field label="Openings"><Input type="number" min="1" max="500" value={f.openings} onChange={set('openings')} /></Field>
        <Field label="Default location"><Input value={f.location || ''} maxLength={120} onChange={set('location')} placeholder="Pune, India" /></Field>
        <Field label="Eligibility"><Input value={f.eligibility || ''} maxLength={300} onChange={set('eligibility')} placeholder="B.E./B.Tech, CGPA 7.0+" /></Field>
      </div>
      {err && <div style={{ marginTop: 12 }}><Alert tone="error">{err}</Alert></div>}
    </Modal>
  )
}

function browserName() {
  const ua = navigator.userAgent
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return `${b}${os ? ` on ${os}` : ''}`
}

/** kind = 'sessions' | 'activity' — built from real account timestamps. */
export function ActivityModal({ kind, account, onClose }) {
  if (!kind) return null
  return (
    <Modal open onClose={onClose} title={kind === 'sessions' ? 'Active sessions' : 'Login activity'} footer={<Button onClick={onClose}>Close</Button>}>
      {kind === 'sessions' ? (
        <div className="cl-col" style={{ gap: 12 }}>
          <div className="hr-set-row" style={{ borderBottom: 0 }}>
            <Monitor size={22} />
            <div className="txt"><strong>{browserName()} — this device</strong>Signed in {account?.last_login_at ? fmtDT(account.last_login_at) : 'recently'}</div>
            <span className="cl-badge green dot">Current</span>
          </div>
          <Alert>Sessions on other devices end when their sign-in token expires. Remote sign-out of other devices is coming soon.</Alert>
        </div>
      ) : (
        <ul className="hr-timeline">
          <li><strong className="hr-ink">Last sign-in</strong><small>{account?.last_login_at ? fmtDT(account.last_login_at) : '—'}</small></li>
          <li><strong className="hr-ink">Password changed</strong><small>{account?.password_changed_at ? fmtDT(account.password_changed_at) : 'Never changed since the account was created'}</small></li>
          <li><strong className="hr-ink">Account created</strong><small>{account?.created_at ? fmtDT(account.created_at) : '—'}</small></li>
        </ul>
      )}
    </Modal>
  )
}
