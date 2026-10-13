import React, { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  User, FileText, GraduationCap, Cog, Bell, Lock, ShieldCheck, Palette, Link2, Download, HelpCircle, Camera, Building, MapPin,
  Mail, Phone, CalendarDays, Layers, Briefcase, IndianRupee, Plane, KeyRound, Smartphone, MonitorSmartphone, Eye, UserRound,
  MessageSquare, Share2, Trash2, Check, Info, Code2, Globe, ChevronRight, BookOpen, Target,
} from 'lucide-react'
import {
  Alert, Avatar, Button, Card, Chip, Field, Hero, Input, Modal, Ring, Select, Skeleton, Toggle, fmtDate, useToast,
} from '../../ui/index.jsx'
import { useApi } from '../../ui/useApi.js'
import { useAuth } from '../../auth.jsx'
import { useStudent } from './StudentShell.jsx'
import { ChipsModal, IdentityModal, openAuthedFile, useProfileSave } from './components/editors.jsx'
import './components/student.css'

const SECTIONS = [
  { id: 'overview', label: 'Account Overview', icon: User },
  { id: 'personal', label: 'Personal Information', icon: FileText },
  { id: 'education', label: 'Education Details', icon: GraduationCap },
  { id: 'skills', label: 'Skills & Interests', icon: Cog },
  { id: 'notifications', label: 'Notification Preferences', icon: Bell },
  { id: 'privacy', label: 'Privacy & Visibility', icon: Lock },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'linked', label: 'Linked Accounts', icon: Link2 },
  { id: 'data', label: 'Data & Downloads', icon: Download },
  { id: 'help', label: 'Help & Support', icon: HelpCircle },
]

const NOTIFS = [
  { key: 'job_alerts', label: 'New job & internship matches', sub: 'Roles that match your branch and skills' },
  { key: 'application_updates', label: 'Application status updates', sub: 'Shortlists, rejections and next steps' },
  { key: 'interview_reminders', label: 'Interview reminders', sub: 'Scheduled interviews and AI interview invites' },
  { key: 'offers', label: 'Offers', sub: 'When a company sends or updates an offer' },
  { key: 'practice_reminders', label: 'Practice reminders', sub: 'Nudges to keep your interview prep streak' },
  { key: 'newsletter', label: 'Learning resources digest', sub: 'New notes, tutorials and career tips' },
]
const NOTIF_DEFAULTS = { email: true, job_alerts: true, application_updates: true, interview_reminders: true, offers: true, practice_reminders: false, newsletter: false }
const PRIVACY_DEFAULTS = { profile_visibility: 'recruiters', show_contact: 'shortlisted', allow_messages: true, share_profile: true }
const VISIBILITY = [{ value: 'recruiters', label: 'Visible to recruiters' }, { value: 'everyone', label: 'Visible to everyone' }, { value: 'hidden', label: 'Hidden' }]
const CONTACT = [{ value: 'shortlisted', label: 'Only to shortlisted companies' }, { value: 'recruiters', label: 'All recruiters' }, { value: 'hidden', label: 'Never' }]
const JOB_TYPES = ['Full-time', 'Internship', 'Part-time', 'Apprenticeship']

const labelOf = (opts, v) => opts.find((o) => o.value === v)?.label || v

function KV({ icon: I, label, value }) {
  return <div className="st-kv"><I size={17} /><span>{label}</span><span>{value || <span className="cl-muted">Not added</span>}</span></div>
}

export default function Settings() {
  const { profile, displayName, branch } = useStudent()
  const [params, setParams] = useSearchParams()
  const section = SECTIONS.some((s) => s.id === params.get('section')) ? params.get('section') : 'overview'
  const go = (id) => { setParams(id === 'overview' ? {} : { section: id }, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const [modal, setModal] = useState(null) // identity | contact | links | prefs | password | delete | skills | interests

  if (!profile) return <div className="st-page"><Skeleton h={200} /><Skeleton h={400} /></div>

  return (
    <div className="st-page">
      <div className="st-split">
        <div className="st-page">
          <Hero branch={branch} page="settings" title="Account Settings" text="Manage your profile, preferences and keep your account secure." />
          <div className="st-settings">
            <Card flush as="nav" aria-label="Settings sections">
              <div className="st-snav">
                {SECTIONS.map((s) => (
                  <button key={s.id} type="button" className={section === s.id ? 'active' : ''} aria-current={section === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                    <s.icon size={19} />{s.label}
                  </button>
                ))}
              </div>
            </Card>
            <div className="cl-col" style={{ gap: 18, minWidth: 0 }}>
              {section === 'overview' && <Overview profile={profile} displayName={displayName} branch={branch} setModal={setModal} />}
              {section === 'personal' && <PersonalCard profile={profile} branch={branch} onEdit={() => setModal('contact')} onEditIdentity={() => setModal('identity')} />}
              {section === 'education' && <EducationCard profile={profile} onEdit={() => setModal('identity')} />}
              {section === 'skills' && <SkillsCard profile={profile} setModal={setModal} />}
              {section === 'notifications' && <NotificationsCard profile={profile} />}
              {section === 'privacy' && <PrivacyCard profile={profile} full />}
              {section === 'security' && <SecurityCard full onPassword={() => setModal('password')} />}
              {section === 'appearance' && <AppearanceCard />}
              {section === 'linked' && <LinkedCard profile={profile} onEdit={() => setModal('links')} />}
              {section === 'data' && <DataCard profile={profile} onDelete={() => setModal('delete')} />}
              {section === 'help' && <HelpCard />}
            </div>
          </div>
        </div>

        <div className="st-right">
          <CompletionCard profile={profile} />
          <SecurityCard onPassword={() => setModal('password')} onGo={go} />
          <PrivacyCard profile={profile} />
          <Card className="st-danger">
            <div className="cl-row" style={{ gap: 14, alignItems: 'flex-start' }}>
              <span className="cl-ico red" style={{ background: 'transparent' }}><Trash2 size={24} /></span>
              <div className="cl-col cl-grow" style={{ gap: 6 }}>
                <strong style={{ color: 'var(--cl-red)', fontSize: 16 }}>Delete Account</strong>
                <span className="cl-muted" style={{ fontSize: 13.5 }}>Permanently delete your account and all data. This action cannot be undone.</span>
              </div>
            </div>
            <Button block variant="danger" style={{ marginTop: 12 }} onClick={() => setModal('delete')}>Delete Account</Button>
          </Card>
        </div>
      </div>

      <IdentityModal open={modal === 'identity'} onClose={() => setModal(null)} profile={profile} groups={['identity']} />
      <IdentityModal open={modal === 'contact'} onClose={() => setModal(null)} profile={profile} groups={['identity', 'contact']} />
      <IdentityModal open={modal === 'links'} onClose={() => setModal(null)} profile={profile} groups={['links']} />
      <PrefsModal open={modal === 'prefs'} onClose={() => setModal(null)} profile={profile} />
      <PasswordModal open={modal === 'password'} onClose={() => setModal(null)} />
      <DeleteModal open={modal === 'delete'} onClose={() => setModal(null)} />
      <SkillsModals modal={modal} setModal={setModal} profile={profile} branch={branch} />
    </div>
  )
}

/* ── Overview ─────────────────────────────────────────────────────── */
function Overview({ profile, displayName, branch, setModal }) {
  const api = useApi('candidate')
  const toast = useToast()
  const { setProfile } = useStudent()
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Choose an image file', 'error')
    if (file.size > 5 * 1024 * 1024) return toast('Image too large (max 5 MB)', 'error')
    const fd = new FormData()
    fd.append('file', file)
    setBusy(true)
    try { setProfile(await api.post('/api/candidate/profile/avatar', fd)); toast('Profile photo updated', 'success') } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <>
      <Card title="Account Overview" subtitle="Manage your basic account information and preferences." action={<Button onClick={() => setModal('identity')}>Edit Profile</Button>}>
        <div className="st-acct">
          <div className="st-acct-photo">
            <Avatar name={displayName} src={profile.avatar_url} size={112} />
            <button type="button" className="st-avatar-btn" aria-label="Change profile photo" onClick={() => ref.current?.click()} disabled={busy}><Camera size={16} /></button>
            <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <div className="cl-col" style={{ gap: 6, minWidth: 0 }}>
            <h3 style={{ fontSize: 19 }}>{displayName}</h3>
            <span className="cl-muted">Student{profile.headline ? ` · ${profile.headline}` : ''}</span>
            <div className="st-links" style={{ paddingTop: 6, gap: 8 }}>
              <span><Building size={16} />{profile.college || <span className="cl-muted">Add your college</span>}</span>
              <span><GraduationCap size={16} />{profile.degree || branch.long}{profile.grad_year ? ` (${profile.grad_year})` : ''}</span>
              <span><MapPin size={16} />{profile.location_text || <span className="cl-muted">Add your location</span>}</span>
            </div>
          </div>
        </div>
      </Card>
      <PersonalCard profile={profile} branch={branch} onEdit={() => setModal('contact')} />
      <PrefsCard profile={profile} onEdit={() => setModal('prefs')} />
    </>
  )
}

function PersonalCard({ profile, branch, onEdit }) {
  const { candidateUsername } = useAuth()
  return (
    <Card title="Personal Information" action={<Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>}>
      <div className="st-kv-box" style={{ padding: '0 14px' }}>
        <KV icon={User} label="Full Name" value={profile.full_name} />
        <KV icon={Mail} label="Email Address" value={profile.contact_email || candidateUsername} />
        <KV icon={Phone} label="Phone Number" value={profile.contact_phone} />
        <KV icon={CalendarDays} label="Date of Birth" value={profile.date_of_birth ? fmtDate(profile.date_of_birth) : null} />
        <KV icon={MapPin} label="Location" value={profile.location_text} />
        <KV icon={Layers} label="Engineering Branch" value={profile.branch ? branch.long : null} />
        <KV icon={CalendarDays} label="Current Year" value={profile.current_year ? `${profile.current_year}${profile.grad_year ? ` (graduating ${profile.grad_year})` : ''}` : null} />
      </div>
    </Card>
  )
}

function PrefsCard({ profile, onEdit }) {
  const p = profile.preferences || {}
  const salary = p.salary_min || p.salary_max ? `₹${p.salary_min || '?'} – ${p.salary_max || '?'} LPA${p.salary_flexible ? ' (Flexible)' : ''}` : null
  return (
    <Card title="Career Preferences" action={<Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>}>
      <div className="st-kv-box" style={{ padding: '0 14px' }}>
        <KV icon={Briefcase} label="Preferred Job Roles" value={(p.roles || []).join(', ')} />
        <KV icon={MapPin} label="Preferred Locations" value={(p.locations || []).join(', ')} />
        <KV icon={FileText} label="Job Type" value={(p.job_types || []).join(', ')} />
        <KV icon={IndianRupee} label="Expected Salary (Full-time)" value={salary} />
        <KV icon={Plane} label="Willing to Relocate" value={p.relocate == null ? null : p.relocate ? 'Yes' : 'No'} />
      </div>
    </Card>
  )
}

function PrefsModal({ open, onClose, profile }) {
  const [save, busy] = useProfileSave()
  const p = profile.preferences || {}
  const [f, setF] = useState(null)
  const [err, setErr] = useState('')
  React.useEffect(() => {
    if (open) {
      setErr('')
      setF({ roles: (p.roles || []).join(', '), locations: (p.locations || []).join(', '), job_types: p.job_types || [], salary_min: p.salary_min ?? '', salary_max: p.salary_max ?? '', salary_flexible: !!p.salary_flexible, relocate: p.relocate ?? true })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !f) return null
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 60))
  const submit = async () => {
    const lo = f.salary_min === '' ? null : Number(f.salary_min)
    const hi = f.salary_max === '' ? null : Number(f.salary_max)
    if ((lo != null && (lo < 0 || lo > 200)) || (hi != null && (hi < 0 || hi > 200))) return setErr('Salary must be between 0 and 200 LPA')
    if (lo != null && hi != null && lo > hi) return setErr('Minimum salary cannot be higher than maximum')
    try {
      await save({ preferences: { ...p, roles: list(f.roles), locations: list(f.locations), job_types: f.job_types, salary_min: lo, salary_max: hi, salary_flexible: f.salary_flexible, relocate: f.relocate } }, 'Career preferences saved')
      onClose()
    } catch { /* toast shown */ }
  }
  return (
    <Modal open onClose={onClose} title="Career preferences" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <Field label="Preferred job roles" hint="Comma separated, e.g. Design Engineer, CAE Analyst"><Input value={f.roles} onChange={(e) => setF({ ...f, roles: e.target.value })} maxLength={400} /></Field>
        <Field label="Preferred locations" hint="Comma separated, e.g. Bengaluru, Pune, Remote"><Input value={f.locations} onChange={(e) => setF({ ...f, locations: e.target.value })} maxLength={300} /></Field>
        <div className="cl-col" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Job type</span>
          <div className="cl-chips">
            {JOB_TYPES.map((t) => {
              const on = f.job_types.includes(t)
              return <Chip key={t} active={on} onClick={() => setF({ ...f, job_types: on ? f.job_types.filter((x) => x !== t) : [...f.job_types, t] })}>{on && <Check size={13} />}{t}</Chip>
            })}
          </div>
        </div>
        <div className="cl-grid cl-grid-2">
          <Field label="Expected salary min (LPA)" error={err}><Input type="number" min="0" step="0.5" value={f.salary_min} onChange={(e) => setF({ ...f, salary_min: e.target.value })} /></Field>
          <Field label="Expected salary max (LPA)"><Input type="number" min="0" step="0.5" value={f.salary_max} onChange={(e) => setF({ ...f, salary_max: e.target.value })} /></Field>
        </div>
        <div className="st-sec-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span>Salary is flexible</span><Toggle label="Salary is flexible" checked={f.salary_flexible} onChange={(v) => setF({ ...f, salary_flexible: v })} /></div>
        <div className="st-sec-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span>Willing to relocate</span><Toggle label="Willing to relocate" checked={f.relocate} onChange={(v) => setF({ ...f, relocate: v })} /></div>
      </div>
    </Modal>
  )
}

/* ── Other sections ───────────────────────────────────────────────── */
function EducationCard({ profile, onEdit }) {
  const edu = profile.education || []
  return (
    <Card title="Education Details" action={<Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>}>
      <div className="st-kv-box" style={{ padding: '0 14px' }}>
        <KV icon={Building} label="College / University" value={profile.college} />
        <KV icon={GraduationCap} label="Degree" value={profile.degree} />
        <KV icon={CalendarDays} label="Graduation Year" value={profile.grad_year} />
        <KV icon={CalendarDays} label="Current Year" value={profile.current_year} />
        <KV icon={Target} label="CGPA" value={profile.cgpa != null ? `${profile.cgpa} / 10` : null} />
      </div>
      {edu.length > 0 && <p className="cl-muted" style={{ fontSize: 13, marginTop: 10 }}>{edu.length} more education entr{edu.length === 1 ? 'y' : 'ies'} on your <a className="cl-link" href="/candidate/profile">profile</a>.</p>}
    </Card>
  )
}

function SkillsCard({ profile, setModal }) {
  return (
    <Card title="Skills & Interests">
      <div className="cl-col" style={{ gap: 18 }}>
        <div>
          <div className="cl-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h4>Skills ({(profile.skills || []).length})</h4><Button size="sm" variant="secondary" onClick={() => setModal('skills')}>Edit</Button></div>
          <div className="cl-chips">{(profile.skills || []).length ? profile.skills.map((s) => <Chip key={s} tone="blue">{s}</Chip>) : <span className="cl-muted">No skills added yet.</span>}</div>
        </div>
        <div>
          <div className="cl-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h4>Interests ({(profile.interests || []).length})</h4><Button size="sm" variant="secondary" onClick={() => setModal('interests')}>Edit</Button></div>
          <div className="cl-chips">{(profile.interests || []).length ? profile.interests.map((s) => <Chip key={s}>{s}</Chip>) : <span className="cl-muted">No interests added yet.</span>}</div>
        </div>
      </div>
    </Card>
  )
}

function SkillsModals({ modal, setModal, profile, branch }) {
  const [save] = useProfileSave()
  return (
    <>
      <ChipsModal open={modal === 'skills'} onClose={() => setModal(null)} title="Edit skills" values={profile.skills || []} suggestions={branch.skills}
        onSave={async (v) => { await save({ skills: v }, 'Skills updated'); setModal(null) }} />
      <ChipsModal open={modal === 'interests'} onClose={() => setModal(null)} title="Edit interests" values={profile.interests || []} suggestions={[...branch.domains, ...branch.topics]}
        onSave={async (v) => { await save({ interests: v }, 'Interests updated'); setModal(null) }} />
    </>
  )
}

function NotificationsCard({ profile }) {
  const [save, busy] = useProfileSave()
  const n = { ...NOTIF_DEFAULTS, ...(profile.notifications || {}) }
  const set = (k, v) => save({ notifications: { ...n, [k]: v } }, v ? 'Notifications on' : 'Notifications off').catch(() => {})
  return (
    <Card title="Notification Preferences" subtitle="Choose what CoreLink emails you about. In-app notifications in the bell are always on.">
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
        <Mail size={18} /><span><b style={{ color: 'var(--cl-ink)' }}>Email notifications</b><br /><small className="cl-muted" style={{ textAlign: 'left' }}>Master switch for all emails below</small></span>
        <Toggle label="Email notifications" checked={n.email} disabled={busy} onChange={(v) => set('email', v)} />
      </div>
      {NOTIFS.map((x) => (
        <div key={x.key} className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto', opacity: n.email ? 1 : 0.55 }}>
          <Bell size={17} /><span>{x.label}<br /><small className="cl-muted" style={{ textAlign: 'left' }}>{x.sub}</small></span>
          <Toggle label={x.label} checked={n.email && n[x.key]} disabled={busy || !n.email} onChange={(v) => set(x.key, v)} />
        </div>
      ))}
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
        <Smartphone size={17} /><span>Push notifications on phone<br /><small className="cl-muted" style={{ textAlign: 'left' }}>Mobile app push</small></span>
        <span className="cl-row" style={{ gap: 8 }}><small className="cl-muted">Coming soon</small><Toggle label="Push notifications (coming soon)" checked={false} disabled onChange={() => {}} /></span>
      </div>
    </Card>
  )
}

function PrivacyCard({ profile, full }) {
  const [save, busy] = useProfileSave()
  const p = { ...PRIVACY_DEFAULTS, ...(profile.privacy || {}) }
  const set = (k, v) => save({ privacy: { ...p, [k]: v } }, 'Privacy setting saved').catch(() => {})
  const row = (icon, label, ctrl) => (
    <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>{icon}<span>{label}</span>{ctrl}</div>
  )
  return (
    <Card title="Privacy & Visibility" subtitle={full ? 'Control who can see your profile and contact you.' : undefined}>
      {row(<Eye size={17} />, 'Profile Visibility',
        <Select aria-label="Profile visibility" className="st-mini-select" value={p.profile_visibility} disabled={busy} onChange={(e) => set('profile_visibility', e.target.value)} options={VISIBILITY} />)}
      {row(<UserRound size={17} />, 'Show Contact Information',
        <Select aria-label="Show contact information" className="st-mini-select" value={p.show_contact} disabled={busy} onChange={(e) => set('show_contact', e.target.value)} options={CONTACT} />)}
      {row(<MessageSquare size={17} />, 'Allow Direct Messages', <span className="cl-row" style={{ gap: 8 }}><small className="cl-muted">{p.allow_messages ? 'Enabled' : 'Disabled'}</small><Toggle label="Allow direct messages" checked={p.allow_messages} disabled={busy} onChange={(v) => set('allow_messages', v)} /></span>)}
      {row(<Share2 size={17} />, 'Share Profile for Opportunities', <span className="cl-row" style={{ gap: 8 }}><small className="cl-muted">{p.share_profile ? 'Enabled' : 'Disabled'}</small><Toggle label="Share profile for opportunities" checked={p.share_profile} disabled={busy} onChange={(v) => set('share_profile', v)} /></span>)}
      {full && <Alert icon={Info}>Currently: {labelOf(VISIBILITY, p.profile_visibility).toLowerCase()}; contact details shown {labelOf(CONTACT, p.show_contact).toLowerCase()}.</Alert>}
    </Card>
  )
}

function SecurityCard({ full, onPassword, onGo }) {
  return (
    <Card title={full ? 'Security' : 'Account & Security'}>
      <div className="st-sec-row"><KeyRound size={17} /><span>Password</span><small>••••••••</small><Button size="sm" variant="outline" onClick={onPassword}>Change</Button></div>
      <div className="st-sec-row"><ShieldCheck size={17} /><span>Two-Factor Authentication</span><small>Coming soon</small><Button size="sm" variant="outline" disabled title="Coming soon">Enable</Button></div>
      {onGo && <div className="st-sec-row"><Mail size={17} /><span>Email Notifications</span><small>Settings</small><Button size="sm" variant="outline" onClick={() => onGo('notifications')}>Manage</Button></div>}
      <div className="st-sec-row"><MonitorSmartphone size={17} /><span>Login Devices</span><small>Coming soon</small><Button size="sm" variant="outline" disabled title="Coming soon">View</Button></div>
      {full && <Alert>Use at least 8 characters with a mix of letters, numbers and symbols. Changing your password keeps you signed in on this device.</Alert>}
    </Card>
  )
}

function AppearanceCard() {
  return (
    <Card title="Appearance" subtitle="Personalise how CoreLink looks.">
      <div className="cl-grid cl-grid-2">
        <div className="st-mini-card" style={{ borderColor: 'var(--cl-blue)' }}><strong className="cl-row" style={{ gap: 8 }}><Palette size={17} /> Light theme</strong><small className="cl-muted">Active</small></div>
        <div className="st-mini-card" style={{ opacity: 0.6 }}><strong className="cl-row" style={{ gap: 8 }}><Palette size={17} /> Dark theme</strong><small className="cl-muted">Coming soon</small></div>
      </div>
    </Card>
  )
}

function LinkedCard({ profile, onEdit }) {
  const links = [
    { icon: Briefcase, label: 'LinkedIn', url: profile.linkedin_url },
    { icon: Code2, label: 'GitHub', url: profile.github_url },
    { icon: Globe, label: 'Portfolio', url: profile.portfolio_url },
  ]
  return (
    <Card title="Linked Accounts" subtitle="Profile links shown to recruiters." action={<Button size="sm" variant="secondary" onClick={onEdit}>Edit links</Button>}>
      {links.map((l) => (
        <div key={l.label} className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
          <l.icon size={17} />
          <span className="cl-ellipsis">{l.label}{l.url ? <><br /><a className="cl-link" href={l.url} target="_blank" rel="noreferrer">{l.url}</a></> : <><br /><small className="cl-muted" style={{ textAlign: 'left' }}>Not linked</small></>}</span>
          <Button size="sm" variant="outline" onClick={onEdit}>{l.url ? 'Change' : 'Add'}</Button>
        </div>
      ))}
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}><Link2 size={17} /><span>Sign in with Google / LinkedIn</span><small className="cl-muted">Coming soon</small></div>
    </Card>
  )
}

function DataCard({ profile, onDelete }) {
  const api = useApi('candidate')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const exportData = async () => {
    setBusy(true)
    try {
      const data = await api.get('/api/student/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `corelink-my-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('Your data export has been downloaded', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Card title="Data & Downloads" subtitle="Download a copy of your data or remove your account.">
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
        <Download size={17} /><span>Export my data<br /><small className="cl-muted" style={{ textAlign: 'left' }}>Profile, projects, applications, offers, interviews and practice sessions (JSON)</small></span>
        <Button size="sm" loading={busy} onClick={exportData}>Export</Button>
      </div>
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
        <FileText size={17} /><span>My resume<br /><small className="cl-muted" style={{ textAlign: 'left' }}>{profile.resume ? `${profile.resume.filename} · uploaded ${fmtDate(profile.resume.uploaded_at)}` : 'No resume uploaded'}</small></span>
        {profile.resume ? <Button size="sm" variant="outline" onClick={() => openAuthedFile(api, '/api/student/resume/file', toast)}>Download</Button> : <Button size="sm" variant="outline" to="/candidate/resume-skills">Upload</Button>}
      </div>
      <div className="st-sec-row" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
        <Trash2 size={17} color="var(--cl-red)" /><span>Delete account<br /><small className="cl-muted" style={{ textAlign: 'left' }}>Permanently remove your account and personal data</small></span>
        <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
      </div>
    </Card>
  )
}

const FAQ = [
  { q: 'How is my resume score calculated?', a: 'It compares your resume against skills and keywords for your branch and the roles you apply to. Open Resume & Skills for the breakdown.', to: '/candidate/resume-skills' },
  { q: 'Can recruiters see my practice interviews?', a: 'No. Practice sessions in AI Interview are private. Only interviews you take for an application are shared with that recruiter.', to: '/candidate/ai-interview' },
  { q: 'How do I respond to an offer?', a: 'Go to Applications, open the application with “Offer Received” and choose Accept or Decline.', to: '/candidate/applications?tab=offers' },
  { q: 'How do I get my projects verified?', a: 'Add evidence (images, files or links) and a description, then choose “Submit for verification” on the project.', to: '/candidate/projects' },
]
function HelpCard() {
  const navigate = useNavigate()
  return (
    <Card title="Help & Support" subtitle="Answers to common questions.">
      {FAQ.map((f) => (
        <button key={f.q} type="button" className="st-tip" style={{ width: '100%', alignItems: 'flex-start' }} onClick={() => navigate(f.to)}>
          <span className="cl-ico"><HelpCircle size={17} /></span>
          <span style={{ textAlign: 'left' }}><b style={{ display: 'block', color: 'var(--cl-ink)', fontSize: 14 }}>{f.q}</b><small className="cl-muted" style={{ fontSize: 13 }}>{f.a}</small></span>
          <ChevronRight size={17} />
        </button>
      ))}
      <button type="button" className="st-tip" style={{ width: '100%' }} onClick={() => navigate('/candidate/resources?tab=career')}>
        <span className="cl-ico green"><BookOpen size={17} /></span><span style={{ textAlign: 'left', fontSize: 14 }}>Browse career guides in Resources</span><ChevronRight size={17} />
      </button>
    </Card>
  )
}

function CompletionCard({ profile }) {
  const c = profile.completion || { percent: 0, items: [] }
  return (
    <Card title="Profile Completion">
      <div className="cl-row" style={{ gap: 18 }}>
        <Ring value={c.percent} size={126} stroke={12} color="var(--cl-green)" label={`${c.percent}%`} sub="Completed" />
        <ul className="cl-check-list cl-grow" style={{ gap: 9, fontSize: 13.5 }}>
          {c.items.map((it) => (
            <li key={it.key}><span className={`st-check-dot ${it.done ? 'ok' : 'todo'}`}><Check size={11} strokeWidth={3} /></span><span className={it.done ? '' : 'cl-muted'}>{it.label}</span></li>
          ))}
        </ul>
      </div>
      {c.percent < 100 && <Alert>Complete your profile to get better job recommendations and higher visibility to recruiters.</Alert>}
    </Card>
  )
}

/* ── Modals ───────────────────────────────────────────────────────── */
function PasswordModal({ open, onClose }) {
  const api = useApi('candidate')
  const toast = useToast()
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  React.useEffect(() => { if (open) { setF({ current: '', next: '', confirm: '' }); setErr({}) } }, [open])
  const strength = useMemo(() => {
    const p = f.next
    return [p.length >= 8, /[A-Z]/.test(p) && /[a-z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length
  }, [f.next])
  const submit = async (e) => {
    e?.preventDefault()
    const x = {}
    if (!f.current) x.current = 'Enter your current password'
    if (f.next.length < 8) x.next = 'Use at least 8 characters'
    else if (f.next === f.current) x.next = 'New password must be different'
    if (f.confirm !== f.next) x.confirm = 'Passwords do not match'
    setErr(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('current_password', f.current)
      fd.append('new_password', f.next)
      await api.post('/api/candidate/auth/change-password', fd)
      toast('Password changed', 'success')
      onClose()
    } catch (e2) {
      if (/current password/i.test(e2.message)) setErr({ current: e2.message }); else toast(e2.message, 'error')
    } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Change password" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Update password</Button></>}>
      <form className="cl-col" style={{ gap: 14 }} onSubmit={submit}>
        <Field label="Current password" error={err.current}><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label="New password" error={err.next} hint={f.next ? ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][strength] : 'At least 8 characters'}>
          <Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} maxLength={128} />
        </Field>
        <Field label="Confirm new password" error={err.confirm}><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} maxLength={128} /></Field>
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Modal>
  )
}

function DeleteModal({ open, onClose }) {
  const api = useApi('candidate')
  const toast = useToast()
  const navigate = useNavigate()
  const { logoutCandidate } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  React.useEffect(() => { if (open) setText('') }, [open])
  const confirm = async () => {
    setBusy(true)
    try {
      await api.request('DELETE', '/api/student/account', { confirm: text.trim() })
      toast('Your account has been deleted', 'success')
      logoutCandidate()
      navigate('/', { replace: true })
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Delete account"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" icon={Trash2} loading={busy} disabled={text.trim() !== 'DELETE'} onClick={confirm}>Delete permanently</Button></>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <Alert tone="error">This permanently deletes your profile, resume, projects, applications, offers, interviews and practice history. Recruiters will no longer see your applications. This cannot be undone.</Alert>
        <p style={{ fontSize: 14 }}>Tip: <button type="button" className="cl-link" onClick={() => { onClose(); navigate('/candidate/settings?section=data') }}>export your data</button> first.</p>
        <Field label='Type "DELETE" to confirm'><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" /></Field>
      </div>
    </Modal>
  )
}
