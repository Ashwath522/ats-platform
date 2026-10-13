/** Recruiter team (TeamMember rows) — shared by Company Profile (20) and Settings (22). Backend: /api/recruiter/hiring/team. */
import React, { useState } from 'react'
import { MailPlus, Power, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react'
import {
  Alert, Avatar, Button, DataTable, EmptyState, Field, Input, Menu, Modal, Select, Skeleton, StatusPill, useToast,
} from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { H } from './HiringCommon.jsx'

export const ACCESS_OPTS = [{ value: 'admin', label: 'Admin' }, { value: 'recruiter', label: 'Recruiter' }, { value: 'viewer', label: 'Viewer' }]
export const ACCESS_HELP = {
  admin: 'Full access: jobs, candidates, offers, company profile and team.',
  recruiter: 'Manage jobs, candidates, interviews and offers.',
  viewer: 'Read-only access to jobs, candidates and analytics.',
}

export function AddMemberModal({ open, onClose, onAdded }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', title: '', access_level: 'recruiter', send_invite: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState({})
  if (!open) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  async function save() {
    const e = {}
    if (!f.name.trim()) e.name = 'Enter a name'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Enter a valid email address'
    setErr(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const m = await api.post(`${H}/team`, { ...f, name: f.name.trim(), email: f.email.trim(), title: f.title.trim() || null })
      toast(`${m.name} added${f.send_invite ? ' — invitation emailed' : ''}`, 'success')
      setF({ name: '', email: '', title: '', access_level: 'recruiter', send_invite: true })
      onAdded?.(m); onClose()
    } catch (x) { setErr({ form: x.message }) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add team member"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={UserPlus} loading={busy} onClick={save}>Add member</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <div className="cl-grid cl-grid-2">
          <Field label="Full name *" error={err.name}><Input value={f.name} maxLength={80} onChange={set('name')} autoFocus /></Field>
          <Field label="Work email *" error={err.email}><Input type="email" value={f.email} maxLength={160} onChange={set('email')} placeholder="name@company.com" /></Field>
          <Field label="Role / title"><Input value={f.title} maxLength={80} onChange={set('title')} placeholder="Campus Hiring Lead" /></Field>
          <Field label="Access level" hint={ACCESS_HELP[f.access_level]}><Select value={f.access_level} onChange={set('access_level')} options={ACCESS_OPTS} /></Field>
        </div>
        <label className="cl-row" style={{ fontSize: 14 }}><input type="checkbox" className="cl-check" checked={f.send_invite} onChange={set('send_invite')} /> Email an invitation to join CoreLink</label>
        {err.form && <Alert tone="error">{err.form}</Alert>}
      </div>
    </Modal>
  )
}

/** Full team table with inline access level, status and actions. `owner` = {name, email, job_title}. */
export function TeamTable({ team, owner, onChange }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [busy, setBusy] = useState(null)
  if (team.loading && !team.data) return <Skeleton h={180} />
  if (team.error) return <Alert tone="error">{team.error.message}</Alert>
  const items = team.data?.items || []
  async function patch(m, body, msg) {
    setBusy(m.id)
    try {
      const r = await api.patch(`${H}/team/${m.id}`, body)
      team.setData((d) => ({ ...d, items: d.items.map((x) => (x.id === m.id ? r : x)) }))
      toast(msg, 'success'); onChange?.()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  async function resend(m) {
    try { await api.post(`${H}/team/${m.id}/resend`); toast(`Invitation re-sent to ${m.email}`, 'success') } catch (e) { toast(e.message, 'error') }
  }
  async function remove(m) {
    if (!window.confirm(`Remove ${m.name} from your team?`)) return
    try {
      await api.del(`${H}/team/${m.id}`)
      team.setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== m.id) }))
      toast(`${m.name} removed`, 'success'); onChange?.()
    } catch (e) { toast(e.message, 'error') }
  }
  const rows = [
    ...(owner ? [{ id: 'me', name: owner.name || owner.email, email: owner.email, title: owner.job_title || 'Account owner', access_level: 'admin', status: 'active', me: true }] : []),
    ...items,
  ]
  const cols = [
    { key: 'name', header: 'Name', render: (m) => <span className="hr-cand"><Avatar name={m.name} size={30} /><span><strong>{m.name}{m.me && <small style={{ display: 'inline', marginLeft: 6 }}>(you)</small>}</strong></span></span> },
    { key: 'title', header: 'Role', render: (m) => <span className="cl-muted">{m.title || '—'}</span> },
    { key: 'email', header: 'Email', render: (m) => <span className="cl-muted cl-ellipsis" style={{ display: 'block', maxWidth: 170 }} title={m.email}>{m.email}</span>, hideOnMobile: true },
    { key: 'access_level', header: 'Access Level', render: (m) => (m.me ? <span className="hr-ink" style={{ fontWeight: 500 }}>Admin (owner)</span>
      : <Select className="hr-tbl-select" value={m.access_level} disabled={busy === m.id} aria-label={`Access level for ${m.name}`} options={ACCESS_OPTS}
        onChange={(e) => patch(m, { access_level: e.target.value }, `${m.name} is now ${e.target.value}`)} />) },
    { key: 'status', header: 'Status', render: (m) => <StatusPill status={m.status} /> },
    { key: 'actions', header: 'Actions', align: 'right', render: (m) => (m.me ? null : <Menu label={`Actions for ${m.name}`} items={[
      m.status === 'invited' && { label: 'Resend invitation', icon: RefreshCw, onClick: () => resend(m) },
      m.status !== 'inactive'
        ? { label: 'Deactivate', icon: Power, onClick: () => patch(m, { status: 'inactive' }, `${m.name} deactivated`) }
        : { label: 'Reactivate', icon: Power, onClick: () => patch(m, { status: 'active' }, `${m.name} reactivated`) },
      { label: 'Remove from team', icon: Trash2, danger: true, onClick: () => remove(m) },
    ]} />) },
  ]
  return (
    <div className="hr-tbl">
      <DataTable columns={cols} rows={rows} rowKey={(m) => m.id}
        empty={<EmptyState icon={Users} title="No team members" text="Invite colleagues to share the hiring workload." />} />
      {items.length === 0 && <p className="hr-small" style={{ padding: '10px 4px 0' }}><MailPlus size={13} style={{ verticalAlign: -2 }} /> Only you so far — add colleagues to collaborate on jobs, interviews and offers.</p>}
    </div>
  )
}
