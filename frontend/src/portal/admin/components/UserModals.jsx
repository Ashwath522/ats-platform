import React, { useEffect, useState } from 'react'
import { Copy, GraduationCap, Building2, ShieldCheck } from 'lucide-react'
import { Alert, Avatar, Button, Chip, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from '../../../ui/index.jsx'
import VerificationReport from '../../../components/VerificationReport.jsx'
import { CollegeName, CollegePicker } from '../../../ui/CollegePicker.jsx'
import { AccountPill, KV, Timeline, UserTypeBadge, VerificationPill, fmtDateTime } from './adminKit.jsx'

export const BRANCH_OPTIONS = [
  { value: 'mechanical', label: 'Mechanical Engineering' },
  { value: 'eee', label: 'Electrical & Electronics' },
  { value: 'ece', label: 'Electronics & Communication' },
  { value: 'civil', label: 'Civil Engineering' },
  { value: 'chemical', label: 'Chemical Engineering' },
  { value: 'aerospace', label: 'Aerospace Engineering' },
  { value: 'automobile', label: 'Automobile Engineering' },
  { value: 'metallurgy', label: 'Metallurgy & Materials' },
  { value: 'Computer Science', label: 'Computer Science' },
]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_RE = /^[+()\-\s0-9]{6,30}$/

function validate(form, type) {
  const e = {}
  if (!form.name || form.name.trim().length < 2) e.name = 'Enter the full name'
  if (!EMAIL_RE.test((form.email || '').trim())) e.email = 'Enter a valid email address'
  if (form.phone && !PHONE_RE.test(form.phone.trim())) e.phone = 'Digits, spaces, + and - only'
  if (type === 'recruiter' && !(form.company || '').trim()) e.company = 'Company is required for recruiters'
  return e
}

function CopyBtn({ value }) {
  const toast = useToast()
  return (
    <Button size="sm" variant="secondary" icon={Copy} onClick={() => { navigator.clipboard?.writeText(value).then(() => toast('Copied', 'success')).catch(() => toast('Copy failed', 'error')) }}>Copy</Button>
  )
}

/** Add Recruiter / Admin / Candidate. Shows the temporary password once in dev mode. */
export function AddUserModal({ open, type, api, onClose, onCreated }) {
  const toast = useToast()
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { if (open) { setForm({}); setErrors({}); setResult(null) } }, [open, type])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const title = { candidate: 'Add Candidate', recruiter: 'Add Recruiter', admin: 'Add Admin' }[type] || 'Add User'

  const submit = async (ev) => {
    ev?.preventDefault()
    const e = validate(form, type)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const res = await api.post('/api/admin/portal/users', { type, ...form, email: form.email.trim() })
      setResult(res)
      toast(`${res.user?.name || 'User'} added${res.email_sent ? ' — login details emailed' : ''}`, 'success')
      onCreated?.(res.user)
    } catch (err) {
      if (err.status === 409) setErrors({ email: err.message })
      else toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal open={open} onClose={onClose} title={`${title} — done`} footer={<Button onClick={onClose}>Close</Button>}>
        <div className="cl-stack" style={{ gap: 12 }}>
          <Alert tone="success">
            Account created for <strong>{result.user?.email}</strong>.{' '}
            {result.email_sent ? 'An email with a temporary password and a link to reset it has been sent.' : (result.warning || 'The email could not be delivered — share the login details another way.')}
          </Alert>
          {result.temporary_password && (
            <div className="adm-temp">
              <span>Temporary password (shown once, development mode only):</span>
              <code>{result.temporary_password}</code>
              <CopyBtn value={result.temporary_password} />
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Create account</Button></>}>
      <form className="cl-stack" style={{ gap: 12 }} onSubmit={submit} noValidate>
        <p className="cl-muted" style={{ fontSize: 13 }}>
          A random temporary password is generated and emailed to the user with a link to set their own password.
        </p>
        <div className="cl-grid cl-grid-2" style={{ gap: 12 }}>
          <Field label="Full name *" error={errors.name}><Input value={form.name || ''} onChange={set('name')} autoFocus maxLength={120} autoComplete="off" /></Field>
          <Field label="Email *" error={errors.email}><Input type="email" value={form.email || ''} onChange={set('email')} maxLength={254} autoComplete="off" /></Field>
          <Field label="Phone" error={errors.phone}><Input type="tel" value={form.phone || ''} onChange={set('phone')} maxLength={30} placeholder="+91 98765 43210" /></Field>
          {type === 'candidate' && <Field label="College"><CollegePicker value={form.college || ''} onChange={(name) => set('college')({ target: { value: name } })} maxLength={200} /></Field>}
          {type === 'candidate' && <Field label="Branch"><Select value={form.branch || ''} onChange={set('branch')} options={BRANCH_OPTIONS} placeholder="Select branch" /></Field>}
          {type === 'recruiter' && <Field label="Company *" error={errors.company}><Input value={form.company || ''} onChange={set('company')} maxLength={200} /></Field>}
          {type === 'recruiter' && <Field label="Designation"><Input value={form.designation || ''} onChange={set('designation')} maxLength={120} placeholder="Campus Hiring Lead" /></Field>}
        </div>
        {type === 'admin' && <Alert tone="warn">Admins have full access to every user, company and audit record on the platform.</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function EditUserModal({ open, user, api, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && user) { setForm({ name: user.name || '', email: user.email || '', phone: user.phone || '' }); setErrors({}) } }, [open, user])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = async (ev) => {
    ev?.preventDefault()
    const e = validate(form, 'any')
    setErrors(e)
    if (Object.keys(e).length) return
    const body = {}
    if (form.name.trim() !== (user.name || '')) body.name = form.name.trim()
    if (form.email.trim().toLowerCase() !== (user.email || '').toLowerCase()) body.email = form.email.trim()
    if ((form.phone || '') !== (user.phone || '')) body.phone = form.phone.trim()
    if (!Object.keys(body).length) return onClose()
    setBusy(true)
    try {
      const res = await api.patch(`/api/admin/portal/users/${user.id}`, body)
      toast('User details updated', 'success')
      onSaved?.(res.user)
      onClose()
    } catch (err) {
      if (err.status === 409) setErrors({ email: err.message })
      else toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit basic information"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}>
      <form className="cl-stack" style={{ gap: 12 }} onSubmit={save} noValidate>
        <Field label="Full name" error={errors.name}><Input value={form.name || ''} onChange={set('name')} maxLength={120} /></Field>
        <Field label="Email" error={errors.email} hint="Changing the email changes the login ID; existing sessions are signed out."><Input type="email" value={form.email || ''} onChange={set('email')} maxLength={254} /></Field>
        <Field label="Phone" error={errors.phone}><Input type="tel" value={form.phone || ''} onChange={set('phone')} maxLength={30} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function SendEmailModal({ open, count, onClose, onSend, busy }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState({})
  useEffect(() => { if (open) { setSubject(''); setBody(''); setErr({}) } }, [open])
  const send = () => {
    const e = {}
    if (subject.trim().length < 3) e.subject = 'Subject is required'
    if (body.trim().length < 5) e.body = 'Write a message (5+ characters)'
    setErr(e)
    if (!Object.keys(e).length) onSend({ subject: subject.trim(), body: body.trim() })
  }
  return (
    <Modal open={open} onClose={onClose} title={`Send email to ${count} user${count === 1 ? '' : 's'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}>Send email</Button></>}>
      <div className="cl-stack" style={{ gap: 12 }}>
        <Field label="Subject" error={err.subject}><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoFocus /></Field>
        <Field label="Message" error={err.body} hint="Each recipient gets a personal greeting. Separate paragraphs with a blank line."><Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={7} /></Field>
      </div>
    </Modal>
  )
}

/** Read-only full profile (opened from Quick Actions → View Full Profile). */
export function FullProfileModal({ open, detail, onClose }) {
  if (!detail) return null
  const p = detail.profile || {}
  const isCand = detail.type === 'candidate'
  return (
    <Modal open={open} onClose={onClose} title="Full profile" size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="cl-stack" style={{ gap: 16 }}>
        <div className="cl-row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <Avatar name={detail.name} src={detail.avatar} size={64} />
          <div className="cl-grow">
            <h3 style={{ fontSize: 19 }}>{detail.name}</h3>
            <p className="cl-muted" style={{ overflowWrap: 'anywhere' }}>{detail.email || 'No email on file'}{p.headline ? ` · ${p.headline}` : ''}</p>
            <div className="cl-row cl-wrap" style={{ gap: 6, marginTop: 6 }}>
              <UserTypeBadge type={detail.type} /><VerificationPill value={detail.verification} /><AccountPill value={detail.status} />
            </div>
          </div>
        </div>
        {detail.stats && Object.keys(detail.stats).length > 0 && (
          <div className="cl-chips">{Object.entries(detail.stats).map(([k, v]) => <Chip key={k} tone="soft">{k.replace(/_/g, ' ')}: <strong>{v}</strong></Chip>)}</div>
        )}
        {isCand ? (
          <>
            <KV wide rows={[
              ['College', detail.college && <CollegeName name={detail.college} size={18} />], ['Branch', detail.dept], ['Degree', p.degree], ['Graduation year', p.grad_year], ['Current year', p.current_year],
              ['CGPA', detail.cgpa], ['Location', detail.location], ['Resume', p.resume ? 'Uploaded' : 'Not uploaded'],
              ['LinkedIn', p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer">{p.linkedin_url}</a>],
              ['GitHub', p.github_url && <a href={p.github_url} target="_blank" rel="noreferrer">{p.github_url}</a>],
              ['Portfolio', p.portfolio_url && <a href={p.portfolio_url} target="_blank" rel="noreferrer">{p.portfolio_url}</a>],
            ]} />
            {p.bio && <section><h4 className="adm-section-title"><GraduationCap size={16} /> About</h4><p style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</p></section>}
            {p.skills?.length > 0 && <section><h4 className="adm-section-title">Skills</h4><div className="cl-chips">{p.skills.map((s) => <Chip key={typeof s === 'string' ? s : JSON.stringify(s)}>{typeof s === 'string' ? s : s.name}</Chip>)}</div></section>}
            {p.education?.length > 0 && (
              <section><h4 className="adm-section-title">Education</h4>
                {p.education.map((e, i) => <p key={i} style={{ fontSize: 13.5 }}><strong>{e.institution || e.level}</strong> {e.field_of_study ? `· ${e.field_of_study}` : ''} {e.start_year || ''}{e.end_year ? `–${e.end_year}` : ''} {e.grade ? `· ${e.grade}` : ''}</p>)}
              </section>
            )}
            {p.certifications?.length > 0 && (
              <section><h4 className="adm-section-title">Certifications</h4>
                {p.certifications.map((c, i) => <p key={i} style={{ fontSize: 13.5 }}>{c.name}{c.issuing_organization ? ` — ${c.issuing_organization}` : ''}</p>)}
              </section>
            )}
          </>
        ) : (
          <>
            <KV wide rows={[['Company', p.company], ['Department / designation', p.designation || p.department],
              ['Company website', p.company_website && <a href={/^https?:/.test(p.company_website) ? p.company_website : `https://${p.company_website}`} target="_blank" rel="noreferrer">{p.company_website}</a>],
              ['Phone', detail.phone], ['Joined', fmtDateTime(detail.joined)], ['Last login', fmtDateTime(detail.last_login)]]} />
            {detail.verification_report && (
              <section><h4 className="adm-section-title"><ShieldCheck size={16} /> Company verification report</h4>
                <div className="adm-req-report"><VerificationReport verification={detail.verification_report} compact /></div>
              </section>
            )}
            {detail.type === 'admin' && <Alert><Building2 size={14} /> Platform administrator — full access.</Alert>}
          </>
        )}
        <section><h4 className="adm-section-title">Recent activity</h4><Timeline items={detail.activity || []} limit={12} /></section>
      </div>
    </Modal>
  )
}

export function DetailSkeleton() {
  return <div className="cl-stack" style={{ gap: 10 }}><Skeleton h={60} /><Skeleton h={140} /><Skeleton h={120} /></div>
}

