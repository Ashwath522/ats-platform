import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  X, Pencil, GraduationCap, BookOpen, BarChart3, MapPin, FileText, ShieldCheck, Ban, KeyRound, RotateCcw, Building2, Briefcase, Trash2, ExternalLink,
} from 'lucide-react'
import { Alert, Avatar, Button, Chip, Field, IconButton, Tabs, Textarea, useToast } from '../../../ui/index.jsx'
import { useQuery } from '../../../ui/useApi.js'
import VerificationReport from '../../../components/VerificationReport.jsx'
import { AccountPill, KV, Timeline, UserTypeBadge, VerificationPill, fmtDateTime } from './adminKit.jsx'
import { DetailSkeleton, EditUserModal, FullProfileModal } from './UserModals.jsx'
import { CollegeName } from '../../../ui/CollegePicker.jsx'

/**
 * Right-hand "User Details" panel on page 24 (slides over the page on
 * tablets / phones). `onAction(action, user)` is handled by the page so the
 * same confirm dialogs serve the table, the panel and bulk actions.
 */
export default function UserDetailsPanel({ uid, api, onClose, onAction, onChanged, version }) {
  const toast = useToast()
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [fullOpen, setFullOpen] = useState(false)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const q = useQuery(() => api.get(`/api/admin/portal/users/${uid}`), [api, uid, version])
  const d = q.data
  useEffect(() => { setTab('overview'); setNote('') }, [uid])

  const addNote = async () => {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      const res = await api.post(`/api/admin/portal/users/${uid}/notes`, { text: note.trim() })
      q.setData((x) => ({ ...x, notes: res.notes }))
      setNote('')
      toast('Note added', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSavingNote(false)
    }
  }
  const delNote = async (id) => {
    try {
      const res = await api.del(`/api/admin/portal/users/${uid}/notes/${id}`)
      q.setData((x) => ({ ...x, notes: res.notes }))
      toast('Note deleted', 'success')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const isReq = uid.startsWith('r-')
  const isCand = d?.type === 'candidate'
  const suspended = d?.status === 'suspended'

  return (
    <>
      <div className="adm-panel-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="adm-panel" aria-label="User details">
        <div className="cl-card">
          <div className="adm-panel-head">
            <h2>User Details</h2>
            <IconButton icon={X} label="Close user details" onClick={onClose} />
          </div>
          {q.error && <Alert tone="error">{q.error.message}</Alert>}
          {!d && !q.error && <DetailSkeleton />}
          {d && (
            <>
              <div className="adm-panel-id">
                <Avatar name={d.name} src={d.avatar} size={58} />
                <div className="cl-grow" style={{ minWidth: 0 }}>
                  <div className="cl-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <h3>{d.name}</h3>
                    <AccountPill value={d.status} />
                  </div>
                  <p>{d.email || 'No email on file'}</p>
                  <UserTypeBadge type={d.type} />
                </div>
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[
                { id: 'overview', label: 'Overview' }, { id: 'profile', label: 'Profile' },
                { id: 'activity', label: 'Activity' }, { id: 'notes', label: 'Notes', count: d.notes?.length || undefined },
              ]} />
            </>
          )}
        </div>

        {d && tab === 'overview' && (
          <>
            <div className="cl-card">
              <div className="adm-sec-head">
                <h4>Basic Information</h4>
                {!isReq && <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
              </div>
              <KV rows={[
                ['User ID', d.id.toUpperCase()], ['Full Name', d.name], ['Email', d.email], ['Phone', d.phone],
                ['User Type', d.type[0].toUpperCase() + d.type.slice(1)], ['Joined On', fmtDateTime(d.joined)],
                ['Verification Status', <VerificationPill key="v" value={d.verification} />], ['Account Status', <AccountPill key="s" value={d.status} />],
                ['Last Login', d.last_login ? fmtDateTime(d.last_login) : 'Never'],
              ]} />
            </div>
            <div className="cl-card">
              <h4 style={{ marginBottom: 10 }}>Profile Summary</h4>
              {isCand ? (
                <div className="adm-psum">
                  <div><GraduationCap size={16} /><span>College</span><strong>{d.college ? <CollegeName name={d.college} size={18} /> : '—'}</strong></div>
                  <div><BookOpen size={16} /><span>Branch</span><strong>{d.dept || '—'}</strong></div>
                  <div><BarChart3 size={16} /><span>CGPA</span><strong>{d.cgpa ?? '—'}</strong></div>
                  <div><MapPin size={16} /><span>Location</span><strong>{d.location || '—'}</strong></div>
                  <div><FileText size={16} /><span>Resume</span><strong>{d.has_resume ? 'Uploaded' : 'Not uploaded'}</strong></div>
                </div>
              ) : (
                <div className="adm-psum">
                  <div><Building2 size={16} /><span>Company</span><strong>{d.org || '—'}</strong></div>
                  <div><Briefcase size={16} /><span>Department</span><strong>{d.dept || '—'}</strong></div>
                  {d.stats?.jobs != null && <div><FileText size={16} /><span>Jobs</span><strong>{d.stats.jobs} posted · {d.stats.open_jobs} open</strong></div>}
                  {d.request && <div><ShieldCheck size={16} /><span>Request</span><strong>{d.request.status}{d.request.verdict ? ` · ${d.request.verdict.replace('_', ' ')}` : ''}{d.request.score != null ? ` (${d.request.score})` : ''}</strong></div>}
                </div>
              )}
            </div>
            <div className="cl-card">
              <h4 style={{ marginBottom: 10 }}>Quick Actions</h4>
              {isReq ? (
                <Button block variant="outline" to="/admin/moderation?tab=requests" icon={ShieldCheck}>Review request in Moderation</Button>
              ) : (
                <div className="adm-qa">
                  <Button variant="outline" icon={FileText} onClick={() => setFullOpen(true)}>View Full Profile</Button>
                  <Button variant="success" icon={ShieldCheck} disabled={d.verification === 'verified'} onClick={() => onAction('verify', d)}>{d.verification === 'verified' ? 'Verified' : 'Verify User'}</Button>
                  {suspended
                    ? <Button variant="success" icon={RotateCcw} disabled={d.is_self} onClick={() => onAction('reactivate', d)}>Reactivate</Button>
                    : <Button variant="danger" icon={Ban} disabled={d.is_self} onClick={() => onAction('suspend', d)}>Suspend User</Button>}
                  <Button variant="outline" icon={KeyRound} onClick={() => onAction('reset_password', d)}>Reset Password</Button>
                </div>
              )}
            </div>
            <div className="cl-card">
              <div className="adm-sec-head"><h4 style={{ fontSize: 15 }}>Recent Activity</h4><button type="button" className="cl-link" onClick={() => setTab('activity')}>View All</button></div>
              <Timeline items={d.activity || []} limit={4} />
            </div>
          </>
        )}

        {d && tab === 'profile' && (
          <div className="cl-card cl-stack" style={{ gap: 14 }}>
            {isCand ? (
              <>
                <KV rows={[['Degree', d.profile?.degree], ['Grad year', d.profile?.grad_year], ['Current year', d.profile?.current_year], ['Headline', d.profile?.headline],
                  ['LinkedIn', d.profile?.linkedin_url && <a href={d.profile.linkedin_url} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>],
                  ['GitHub', d.profile?.github_url && <a href={d.profile.github_url} target="_blank" rel="noreferrer">Open <ExternalLink size={11} /></a>]]} />
                {d.profile?.skills?.length > 0 && <div><h4 style={{ marginBottom: 8 }}>Skills</h4><div className="cl-chips">{d.profile.skills.slice(0, 16).map((s) => <Chip key={typeof s === 'string' ? s : s.name}>{typeof s === 'string' ? s : s.name}</Chip>)}</div></div>}
                {d.stats && <div className="cl-chips">{Object.entries(d.stats).map(([k, v]) => <Chip key={k} tone="soft">{k}: <strong>{v}</strong></Chip>)}</div>}
              </>
            ) : (
              <>
                <KV rows={[['Company', d.profile?.company], ['Department', d.profile?.department], ['Designation', d.profile?.designation], ['Website', d.profile?.company_website]]} />
                {d.stats && Object.keys(d.stats).length > 0 && <div className="cl-chips">{Object.entries(d.stats).map(([k, v]) => <Chip key={k} tone="soft">{k.replace('_', ' ')}: <strong>{v}</strong></Chip>)}</div>}
                {d.verification_report && <div className="adm-req-report"><VerificationReport verification={d.verification_report} compact /></div>}
              </>
            )}
            {!isReq && <Button variant="outline" icon={FileText} onClick={() => setFullOpen(true)}>View Full Profile</Button>}
          </div>
        )}

        {d && tab === 'activity' && (
          <div className="cl-card"><h4 style={{ marginBottom: 12 }}>Activity</h4><Timeline items={d.activity || []} /></div>
        )}

        {d && tab === 'notes' && (
          <div className="cl-card cl-stack" style={{ gap: 12 }}>
            <h4>Admin notes</h4>
            <p className="cl-muted" style={{ fontSize: 12.5 }}>Visible to admins only.</p>
            {isReq ? <p className="cl-muted">Notes are available once the account is approved.</p> : (
              <>
                <Field label="New note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="e.g. Called the TPO to confirm enrolment" /></Field>
                <Button size="sm" loading={savingNote} disabled={!note.trim()} onClick={addNote}>Add note</Button>
              </>
            )}
            {(d.notes || []).map((n) => (
              <div className="adm-note" key={n.id}>
                <p>{n.text}</p>
                <small><span>{n.by ? `${n.by} · ` : ''}{fmtDateTime(n.at)}</span><IconButton icon={Trash2} size={14} label="Delete note" onClick={() => delNote(n.id)} /></small>
              </div>
            ))}
            {!isReq && !(d.notes || []).length && <p className="cl-muted" style={{ fontSize: 13 }}>No notes yet.</p>}
          </div>
        )}
        {d && !isReq && (
          <Link className="cl-link" style={{ textAlign: 'center', fontSize: 12.5 }} to={`/admin/audit-logs?q=${encodeURIComponent(d.id)}`}>View admin audit trail for this user</Link>
        )}
      </aside>
      <EditUserModal open={editOpen} user={d} api={api} onClose={() => setEditOpen(false)} onSaved={() => { q.reload(); onChanged?.() }} />
      <FullProfileModal open={fullOpen} detail={d} onClose={() => setFullOpen(false)} />
    </>
  )
}
