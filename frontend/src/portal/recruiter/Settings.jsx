import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart3, Bell, Briefcase, CalendarDays, Camera, ChevronRight, Clock, FileText, Globe, Lock, Mail, Megaphone, MessageSquare, Monitor, Network,
  Plug, Save, ShieldCheck, UserPlus, Users, Workflow,
} from 'lucide-react'
import {
  Alert, Avatar, Button, Card, Field, Input, Skeleton, Tabs, Toggle, timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useRecruiter } from './RecruiterShell.jsx'
import { FilePick, H, downloadResponse } from './components/HiringCommon.jsx'
import { AddMemberModal, ACCESS_HELP, TeamTable } from './components/CompanyTeam.jsx'
import { ActivityModal, JobDefaultsModal, PasswordModal } from './components/SettingsDialogs.jsx'
import { InterviewsTemplatesModal } from './components/InterviewsDialogs.jsx'
import { OfferTemplatesModal } from './components/OffersDialogs.jsx'

const TABS = [
  { id: 'account', label: 'Account' }, { id: 'team', label: 'Team & Permissions' }, { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' }, { id: 'company', label: 'Company Settings' }, { id: 'security', label: 'Privacy & Security' },
]
const NOTIFS = [
  { key: 'new_applications', icon: Mail, title: 'New Applications', text: 'Get notified when new candidates apply.' },
  { key: 'interview_updates', icon: CalendarDays, title: 'Interview Updates', text: 'Receive updates about interview schedules and feedback.' },
  { key: 'offer_status', icon: FileText, title: 'Offer Status Updates', text: 'Get notified about offer acceptance, rejection or negotiation.' },
  { key: 'weekly_report', icon: BarChart3, title: 'Weekly Analytics Report', text: 'Receive a weekly summary of your hiring activity.' },
  { key: 'product_updates', icon: Megaphone, title: 'Product Updates', text: 'Get notified about new CoreLink features and improvements.' },
]
/** Third-party connectors that don't exist yet — shown disabled ("Coming soon"). Generic names/icons, no trademarks. */
const FUTURE_INTEGRATIONS = [
  { icon: Network, color: '#2563eb', name: 'Professional network', text: 'Import profiles and cross-post jobs' },
  { icon: MessageSquare, color: '#7c3aed', name: 'Team chat', text: 'Hiring alerts in your team channels' },
  { icon: Mail, color: '#0891b2', name: 'Email & calendar sync', text: 'Two-way sync of interview invites' },
  { icon: Workflow, color: '#ea580c', name: 'External ATS', text: 'Sync candidates with another ATS' },
]

function ProfileCard({ account, onSaved }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [f, setF] = useState(null)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  const [up, setUp] = useState(false)
  useEffect(() => {
    if (account) setF({ name: account.name || '', phone: account.phone || '', job_title: account.job_title || '', department: account.department || '', location: account.location || '' })
  }, [account])
  if (!f) return <Card title="Profile Settings"><Skeleton h={180} /></Card>
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save() {
    const e = {}
    if (!f.name.trim()) e.name = 'Enter your name'
    if (f.phone.trim() && !/^\+?[0-9][0-9 -]{6,18}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number'
    setErr(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const r = await api.put(`${H}/account`, { name: f.name.trim(), phone: f.phone.trim() || null, job_title: f.job_title, department: f.department, location: f.location })
      onSaved(r); toast('Profile saved', 'success')
    } catch (x) { setErr({ form: x.message }) } finally { setBusy(false) }
  }
  async function avatar(file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast('Use a PNG, JPG or WebP image', 'error')
    if (file.size > 5 * 1024 * 1024) return toast('Images must be under 5 MB', 'error')
    const fd = new FormData(); fd.append('file', file)
    setUp(true)
    try { const r = await api.post('/api/recruiter/profile/avatar', fd); onSaved({ ...account, avatar_url: r.avatar_url }); toast('Photo updated', 'success') } catch (x) { toast(x.message, 'error') } finally { setUp(false) }
  }
  return (
    <Card title="Profile Settings" subtitle="Manage your personal information and recruiter profile.">
      <div className="hr-profile">
        <div className="hr-avatar-edit">
          <Avatar name={account.name} src={account.avatar_url} size={104} />
          <FilePick onFile={avatar}>{(open) => <button type="button" className="cam" onClick={open} aria-label="Change profile photo" title="Change photo" disabled={up}><Camera size={15} /></button>}</FilePick>
        </div>
        <div className="cl-col" style={{ gap: 12, minWidth: 0 }}>
          <div className="cl-grid cl-grid-3">
            <Field label="Full Name" error={err.name}><Input value={f.name} maxLength={80} onChange={set('name')} autoComplete="name" /></Field>
            <Field label="Email"><Input value={account.email} readOnly aria-readonly="true" title="Your sign-in email can't be changed here" /></Field>
            <Field label="Phone Number" error={err.phone}><Input value={f.phone} maxLength={20} inputMode="tel" onChange={set('phone')} placeholder="+91 98765 43210" /></Field>
            <Field label="Job Title"><Input value={f.job_title} maxLength={80} onChange={set('job_title')} placeholder="Talent Acquisition Manager" /></Field>
            <Field label="Department"><Input value={f.department} maxLength={80} onChange={set('department')} placeholder="Engineering Recruitment" /></Field>
            <Field label="Location"><Input value={f.location} maxLength={120} onChange={set('location')} placeholder="Bangalore, Karnataka, India" /></Field>
          </div>
          {err.form && <Alert tone="error">{err.form}</Alert>}
          <div className="cl-row" style={{ justifyContent: 'flex-end' }}><Button icon={Save} loading={busy} onClick={save}>Save Changes</Button></div>
        </div>
      </div>
    </Card>
  )
}

function SecurityCard({ account, onPassword, onActivity }) {
  const changed = account?.password_changed_at
  return (
    <Card title="Account Security" subtitle="Manage your password, two-factor authentication and active sessions.">
      <div className="hr-set-row"><Lock size={22} /><div className="txt"><strong>Password</strong>{changed ? `Last updated ${timeAgo(changed)}` : 'Not changed since the account was created'}</div><Button size="sm" variant="outline" onClick={onPassword}>Change Password</Button></div>
      <div className="hr-set-row"><ShieldCheck size={22} /><div className="txt"><strong>Two-Factor Authentication (2FA) <span className="hr-soon">Coming soon</span></strong>Add an extra layer of security to your account.</div><Toggle checked={false} disabled label="Two-factor authentication (coming soon)" onChange={() => {}} /></div>
      <div className="hr-set-row"><Monitor size={22} /><div className="txt"><strong>Active Sessions</strong>See where you're signed in.</div><Button size="sm" variant="outline" onClick={() => onActivity('sessions')}>View Sessions</Button></div>
      <div className="hr-set-row"><Clock size={22} /><div className="txt"><strong>Login Activity</strong>{account?.last_login_at ? `Last sign-in ${timeAgo(account.last_login_at)}` : 'View recent account activity.'}</div><Button size="sm" variant="outline" onClick={() => onActivity('activity')}>View Activity</Button></div>
    </Card>
  )
}

function NotificationsCard({ account, setAccount }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [busy, setBusy] = useState(null)
  const n = account?.notifications || {}
  async function flip(key, v) {
    const prev = n
    setAccount((a) => ({ ...a, notifications: { ...a.notifications, [key]: v } }))
    setBusy(key)
    try {
      const r = await api.put(`${H}/account/notifications`, { [key]: v })
      setAccount((a) => ({ ...a, notifications: r.notifications }))
      toast('Notification preference saved', 'success')
    } catch (e) { setAccount((a) => ({ ...a, notifications: prev })); toast(e.message, 'error') } finally { setBusy(null) }
  }
  return (
    <Card title="Notification Preferences" subtitle="Choose which emails you want to receive.">
      {!account ? <Skeleton h={200} /> : NOTIFS.map((x) => (
        <div className="hr-set-row" key={x.key}>
          <x.icon size={22} />
          <div className="txt"><strong>{x.title}</strong>{x.text}</div>
          <Toggle checked={!!n[x.key]} disabled={busy === x.key} label={x.title} onChange={(v) => flip(x.key, v)} />
        </div>
      ))}
    </Card>
  )
}

function IntegrationsCard({ onExport, exporting }) {
  const navigate = useNavigate()
  return (
    <Card title="Integrations" subtitle="Connect tools you use for hiring and collaboration.">
      <div className="hr-integrations">
        <div className="hr-int">
          <span className="hr-int-ico" style={{ background: '#2563eb' }}><CalendarDays size={20} /></span>
          <div className="body"><strong>Calendar export (.ics)</strong><small>Add interviews to any calendar app</small>
            <div className="foot"><span className="cl-badge green dot">Available</span><Button size="sm" variant="outline" loading={exporting} onClick={onExport}>Export</Button></div></div>
        </div>
        <div className="hr-int">
          <span className="hr-int-ico" style={{ background: '#16a34a' }}><Bell size={20} /></span>
          <div className="body"><strong>Email notifications</strong><small>Candidate and team emails by CoreLink</small>
            <div className="foot"><span className="cl-badge green dot">Connected</span><Button size="sm" variant="outline" onClick={() => navigate('/recruiter/settings?tab=notifications')}>Manage</Button></div></div>
        </div>
        {FUTURE_INTEGRATIONS.map((i) => (
          <div className="hr-int" key={i.name} style={{ opacity: 0.85 }}>
            <span className="hr-int-ico" style={{ background: i.color }}><i.icon size={20} /></span>
            <div className="body"><strong>{i.name}</strong><small>{i.text}</small>
              <div className="foot"><span className="cl-badge dot">Not connected</span><Button size="sm" variant="outline" disabled title="This integration is coming soon">Coming soon</Button></div></div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CompanySettingsCard({ onOpen }) {
  const rows = [
    { id: 'defaults', icon: Briefcase, title: 'Job Posting Defaults', text: 'Set default settings for new job postings.' },
    { id: 'workflow', icon: Workflow, title: 'Application Workflow', text: 'Configure your interview rounds and hiring stages.' },
    { id: 'templates', icon: FileText, title: 'Candidate Communication Templates', text: 'Manage offer letter templates sent to candidates.' },
    { id: 'career', icon: Globe, title: 'Career Page Settings', text: 'Customise your company page on CoreLink.' },
  ]
  return (
    <Card title="Company Settings" subtitle="Manage company-wide recruitment settings.">
      {rows.map((r) => (
        <button type="button" key={r.id} className="hr-link-row" onClick={() => onOpen(r.id)}>
          <r.icon size={22} /><span className="txt"><strong>{r.title}</strong>{r.text}</span><ChevronRight size={18} />
        </button>
      ))}
    </Card>
  )
}

export default function Settings() {
  const api = useApi('recruiter')
  const toast = useToast()
  const navigate = useNavigate()
  const { company: shellCompany, setCompany: setShellCompany } = useRecruiter() || {}
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'account'
  const setTab = (t) => setParams({ tab: t }, { replace: true })
  const acc = useQuery(() => api.get(`${H}/account`), [api])
  const team = useQuery(() => api.get(`${H}/team`), [api])
  const co = useQuery(() => (shellCompany ? Promise.resolve(shellCompany) : api.get(`${H}/company`)), [api, !!shellCompany])
  const company = shellCompany || co.data
  const setOwn = co.setData
  const setCompany = useCallback((c) => { setOwn(c); setShellCompany?.(c) }, [setOwn, setShellCompany])
  const [dlg, setDlg] = useState(null)
  const [exporting, setExporting] = useState(false)
  const account = acc.data

  async function exportIcs() {
    setExporting(true)
    try { const res = await api.request('GET', `${H}/interviews/export.ics`, undefined, { raw: true }); await downloadResponse(res, 'corelink-interviews.ics'); toast('Calendar file downloaded', 'success') } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }
  async function savePrefs(prefs, msg) {
    const c = await api.put(`${H}/company`, { preferences: prefs })
    setCompany(c); toast(msg, 'success')
  }
  const openCompany = (id) => (id === 'career' ? navigate('/recruiter/company-profile?tab=settings') : setDlg(id))
  const show = (id) => tab === 'account' || tab === id

  const teamCard = (
    <Card title="Team & Permissions" subtitle="Manage your recruitment team and their access levels."
      action={<Button variant="outline" icon={UserPlus} onClick={() => setDlg('add')}>Add Team Member</Button>}>
      <TeamTable team={team} owner={account} />
      {tab === 'team' && (
        <div className="cl-grid cl-grid-3" style={{ marginTop: 16 }}>
          {Object.entries(ACCESS_HELP).map(([k, v]) => <div key={k} className="hr-fb"><strong className="hr-ink" style={{ textTransform: 'capitalize' }}><Users size={15} style={{ verticalAlign: -2 }} /> {k}</strong><span className="hr-small">{v}</span></div>)}
        </div>
      )}
    </Card>
  )

  return (
    <div className="hr-page">
      <div className="cl-page-head"><div><h1>Settings</h1><p>Manage your account, team, company settings, notifications and integrations.</p></div></div>
      <div className="hr-tabs-bar"><Tabs tabs={TABS} value={tab} onChange={setTab} /></div>
      {acc.error && <div style={{ marginBottom: 12 }}><Alert tone="error">{acc.error.message} <button type="button" className="cl-link" onClick={acc.reload}>Retry</button></Alert></div>}

      {tab === 'account' ? (
        <div className="hr-set-grid">
          <div className="cl-stack" style={{ minWidth: 0 }}>
            <ProfileCard account={account} onSaved={(a) => acc.setData(a)} />
            {teamCard}
            <IntegrationsCard onExport={exportIcs} exporting={exporting} />
          </div>
          <div className="cl-stack" style={{ minWidth: 0 }}>
            <SecurityCard account={account} onPassword={() => setDlg('password')} onActivity={setDlg} />
            <NotificationsCard account={account} setAccount={acc.setData} />
            <CompanySettingsCard onOpen={openCompany} />
          </div>
        </div>
      ) : (
        <div className="cl-stack">
          {show('team') && teamCard}
          {show('notifications') && <NotificationsCard account={account} setAccount={acc.setData} />}
          {show('integrations') && <IntegrationsCard onExport={exportIcs} exporting={exporting} />}
          {show('company') && <CompanySettingsCard onOpen={openCompany} />}
          {show('security') && <>
            <SecurityCard account={account} onPassword={() => setDlg('password')} onActivity={setDlg} />
            <Card title="Privacy" subtitle="How CoreLink uses your recruiter data.">
              <div className="hr-set-row"><Globe size={22} /><div className="txt"><strong>Company profile visibility</strong>Choose whether students can see your company page.</div><Button size="sm" variant="outline" to="/recruiter/company-profile?tab=settings">Manage</Button></div>
              <div className="hr-set-row"><Plug size={22} /><div className="txt"><strong>Data export & account deletion <span className="hr-soon">Coming soon</span></strong>Contact CoreLink support to export or delete your recruiter data.</div><Button size="sm" variant="outline" disabled>Coming soon</Button></div>
            </Card>
          </>}
        </div>
      )}

      <PasswordModal open={dlg === 'password'} onClose={() => setDlg(null)} onChanged={(r) => acc.setData((a) => ({ ...a, password_changed_at: r.password_changed_at }))} />
      <ActivityModal kind={dlg === 'sessions' || dlg === 'activity' ? dlg : null} account={account} onClose={() => setDlg(null)} />
      <AddMemberModal open={dlg === 'add'} onClose={() => setDlg(null)} onAdded={() => team.reload()} />
      <JobDefaultsModal open={dlg === 'defaults' && !!company} defaults={company?.job_defaults} onClose={() => setDlg(null)} onSave={(v) => savePrefs({ job_defaults: v }, 'Job posting defaults saved')} />
      <InterviewsTemplatesModal open={dlg === 'workflow' && !!company} rounds={company?.rounds || []} onClose={() => setDlg(null)} onSave={(r) => savePrefs({ rounds: r }, 'Interview workflow saved')} />
      <OfferTemplatesModal open={dlg === 'templates' && !!company} templates={company?.offer_templates} onClose={() => setDlg(null)} onSave={(t) => savePrefs({ offer_templates: t }, 'Communication templates saved')} />
    </div>
  )
}
