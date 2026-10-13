import React, { useEffect, useState } from 'react'
import {
  Save, Megaphone, Mail, Database, Server, Cpu, ShieldCheck, Trash2, Send, KeyRound, MessageSquareText, CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Textarea, Toggle, fmtDate, timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { ConfirmModal, fmtDateTime, fmtDuration } from './components/adminKit.jsx'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function AdminSystemSettings() {
  const api = useApi('admin')
  const toast = useToast()
  const q = useQuery(() => api.get('/api/admin/portal/settings'), [api])
  const [form, setForm] = useState(null)
  const [err, setErr] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (q.data) setForm(q.data.settings) }, [q.data])
  const dirty = form && q.data && JSON.stringify(form) !== JSON.stringify(q.data.settings)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    const e = {}
    if (form.support_email && !EMAIL_RE.test(form.support_email.trim())) e.support_email = 'Enter a valid email address'
    if (form.announcement_enabled && (form.announcement_text || '').trim().length < 3) e.announcement_text = 'Write the announcement before turning it on'
    const days = Number(form.retention_days)
    if (!Number.isInteger(days) || days < 7 || days > 365) e.retention_days = 'Between 7 and 365 days'
    setErr(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      const res = await api.put('/api/admin/portal/settings', { ...form, support_email: form.support_email?.trim() || null, retention_days: days })
      q.setData({ ...q.data, settings: res.settings, updated_at: new Date().toISOString() })
      toast('Settings saved', 'success')
    } catch (x) { toast(x.message, 'error') } finally { setSaving(false) }
  }

  return (
    <div className="adm-page">
      <PageHeader title="System Settings" subtitle="Platform-wide configuration, announcements, email delivery, AI providers and data retention."
        actions={<Button icon={Save} loading={saving} disabled={!dirty} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</Button>} />
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      <div className="adm-settings-grid">
        <div className="cl-stack">
          <Card title="General" subtitle={q.data?.updated_at ? `Last changed ${timeAgo(q.data.updated_at)}` : 'Defaults in use'}>
            {!form ? <Skeleton h={120} /> : (
              <div className="cl-stack" style={{ gap: 14 }}>
                <Field label="Support email" hint="Shown on the login pages (e.g. for recruiters who forgot their password)." error={err.support_email}>
                  <Input type="email" icon={Mail} value={form.support_email || ''} onChange={(e) => set('support_email')(e.target.value)} placeholder="support@yourdomain.com" />
                </Field>
                <div className="adm-setting-row">
                  <div><strong>Show live platform numbers on the landing page</strong><small>Student, company and open-job counts from the database. Turn off while the platform is new.</small></div>
                  <Toggle checked={form.public_stats} onChange={set('public_stats')} label="Show live platform numbers" />
                </div>
              </div>
            )}
          </Card>

          <Card title="Announcement banner" icon={Megaphone} subtitle="A short message shown at the top of the landing and login pages.">
            {!form ? <Skeleton h={120} /> : (
              <div className="cl-stack" style={{ gap: 14 }}>
                <div className="adm-setting-row">
                  <div><strong>Show announcement</strong><small>{form.announcement_enabled ? 'Visible to everyone right now' : 'Hidden'}</small></div>
                  <Toggle checked={form.announcement_enabled} onChange={set('announcement_enabled')} label="Show announcement" />
                </div>
                <Field label="Message" error={err.announcement_text} hint={`${(form.announcement_text || '').length}/300`}>
                  <Textarea value={form.announcement_text || ''} maxLength={300} rows={3} onChange={(e) => set('announcement_text')(e.target.value)} placeholder="e.g. Campus hiring season is open — complete your profile to get matched." />
                </Field>
                <Field label="Style">
                  <Select value={form.announcement_tone} onChange={(e) => set('announcement_tone')(e.target.value)}
                    options={[{ value: 'info', label: 'Information (blue)' }, { value: 'success', label: 'Good news (green)' }, { value: 'warning', label: 'Warning (amber)' }]} />
                </Field>
                {form.announcement_text && <div className={`adm-announce ${form.announcement_tone}`} aria-label="Preview"><Megaphone size={15} /> {form.announcement_text}</div>}
              </div>
            )}
          </Card>

          <Retention api={api} form={form} set={set} err={err} />
          <Feedback api={api} />
        </div>

        <div className="cl-stack">
          <Health q={q} />
          <EmailCard api={api} />
          <AiCard api={api} />
          <Card title="Security" icon={ShieldCheck}>
            <div className="cl-stack" style={{ gap: 12 }}>
              <div className="adm-setting-row"><div><strong>Recruiter approval required</strong><small>Recruiter accounts are only created after an admin approves the access request.</small></div><Badge tone="green" dot>Always on</Badge></div>
              <div className="adm-setting-row"><div><strong>Suspended accounts</strong><small>Suspended students, recruiters and admins are refused at login and on every API call.</small></div><Badge tone="green" dot>Enforced</Badge></div>
              <div className="adm-setting-row"><div><strong>Two-factor authentication for admins</strong><small>Needs an authenticator integration.</small></div><Button size="sm" variant="secondary" disabled>Coming soon</Button></div>
              <div className="adm-setting-row"><div><strong>Single sign-on (SAML / Google Workspace)</strong><small>For colleges and enterprise recruiters.</small></div><Button size="sm" variant="secondary" disabled>Coming soon</Button></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Health({ q }) {
  const h = q.data?.health
  return (
    <Card title="System Health" action={<button type="button" className="cl-icon-btn" aria-label="Refresh" title="Refresh" onClick={q.reload}><RefreshCw size={16} /></button>}>
      {!h ? <Skeleton h={110} /> : (
        <div className="cl-stack" style={{ gap: 10 }}>
          <div className="adm-provider"><Database size={17} /><strong>Database</strong><span className="cl-muted">{h.database.engine} · {h.database.ping_ms} ms</span><Badge tone={h.database.ok ? 'green' : 'red'} dot>{h.database.ok ? 'Healthy' : 'Down'}</Badge></div>
          <div className="adm-provider"><Server size={17} /><strong>API process</strong><span className="cl-muted">up {fmtDuration(h.uptime_seconds)}</span><Badge tone="green" dot>Running</Badge></div>
          <div className="adm-provider"><Mail size={17} /><strong>Email ({h.email.provider})</strong><span className="cl-muted">{h.email.sent_7d} sent · {h.email.failed_7d} failed (7d)</span><Badge tone={h.email.failure_rate < 25 ? 'green' : 'amber'} dot>{h.email.failure_rate}% fail</Badge></div>
          <div className="adm-provider"><Cpu size={17} /><strong>AI providers</strong><span className="cl-muted">{h.llm_providers.length ? h.llm_providers.join(', ') : 'none configured'}</span><Badge tone={h.llm_providers.length ? 'green' : 'amber'} dot>{h.llm_providers.length ? 'Configured' : 'Fallback'}</Badge></div>
          {q.data.dev_mode && <Alert tone="warn" icon={AlertTriangle}>Development mode is on: temporary passwords and reset tokens are returned in API responses. Turn it off in production.</Alert>}
        </div>
      )}
    </Card>
  )
}

function EmailCard({ api }) {
  const toast = useToast()
  const st = useQuery(() => api.get('/api/admin/email/status'), [api])
  const [to, setTo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!EMAIL_RE.test(to.trim())) return setErr('Enter a valid email address')
    setErr('')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('to', to.trim())
      const r = await api.post('/api/admin/email/test', fd)
      toast(r.success ? `Test email sent to ${to.trim()} via ${r.provider}` : (r.error || 'Test email failed'), r.success ? 'success' : 'error')
      st.reload()
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  const s = st.data
  return (
    <Card title="Email Delivery" icon={Mail}>
      {!s ? <Skeleton h={90} /> : (
        <div className="cl-stack" style={{ gap: 12 }}>
          <div className="adm-provider"><strong>{s.provider}</strong><span className="cl-muted">{s.sender ? `${s.sender_name || ''} <${s.sender}>` : 'no sender address'}</span><Badge tone={s.configured ? 'green' : 'amber'} dot>{s.configured ? 'Configured' : 'Not configured'}</Badge></div>
          <div className="cl-row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Field label="Send a test email" error={err} className="cl-grow"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" /></Field>
            <Button icon={Send} loading={busy} onClick={send} style={{ marginTop: 22 }}>Send</Button>
          </div>
          {(s.logs || []).length > 0 && (
            <div className="adm-email-log">
              {(s.logs || []).slice(0, 6).map((l, i) => (
                <div key={l.id || i}><Badge tone={l.status === 'failed' ? 'red' : 'green'}>{l.status}</Badge><span className="cl-ellipsis">{l.subject || l.category}</span><small>{timeAgo(l.created_at)}</small></div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function AiCard({ api }) {
  const toast = useToast()
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    try { setRes(await api.get('/api/admin/ai-key-status')) } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Card title="AI Provider Keys" icon={KeyRound} action={<Button size="sm" variant="secondary" loading={busy} onClick={check}>Test keys</Button>}>
      {!res ? <p className="cl-muted" style={{ fontSize: 13 }}>Runs a live connection test against each configured provider. Keys are never shown.</p> : (
        <div>
          {Object.entries(res).map(([name, r]) => (
            <div key={name} className="adm-provider">
              {r.success ? <CheckCircle2 size={17} color="var(--cl-green)" /> : <AlertTriangle size={17} color="#d98b00" />}
              <strong>{name}</strong>
              <span className="cl-muted cl-ellipsis" style={{ maxWidth: 220 }}>{r.success ? 'Connected' : (r.error || 'Unavailable')}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Retention({ api, form, set, err }) {
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.post(`/api/admin/retention/purge?days=${Number(form.retention_days) || 30}`)
      setLast({ ...r, at: new Date().toISOString() })
      toast('Retention purge finished', 'success')
      setConfirm(false)
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Card title="Data Retention" icon={Trash2} subtitle="Proctoring recordings and snapshots from AI interviews.">
      {!form ? <Skeleton h={80} /> : (
        <div className="cl-stack" style={{ gap: 12 }}>
          <Field label="Keep proctoring data for (days)" error={err.retention_days} hint="Applications, scores and audit logs are kept; only raw proctoring evidence is purged.">
            <Input type="number" min={7} max={365} value={form.retention_days} onChange={(e) => set('retention_days')(e.target.value)} style={{ maxWidth: 160 }} />
          </Field>
          <div className="cl-row cl-wrap" style={{ gap: 10 }}>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>Purge expired data now</Button>
            {last && <span className="cl-muted" style={{ fontSize: 13 }}>Last run {fmtDateTime(last.at)} · {Object.entries(last).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ') || 'done'}</span>}
          </div>
        </div>
      )}
      <ConfirmModal open={confirm} busy={busy} danger title="Purge expired proctoring data?" confirmLabel="Purge now"
        text={`Proctoring evidence older than ${form?.retention_days} days is permanently deleted. This cannot be undone.`}
        onConfirm={run} onClose={() => setConfirm(false)} />
    </Card>
  )
}

function Feedback({ api }) {
  const q = useQuery(() => api.get('/api/admin/suggestions'), [api])
  const items = q.data?.suggestions || []
  return (
    <Card title="User Feedback" icon={MessageSquareText} subtitle="Suggestions sent from the feedback form.">
      {q.loading && !q.data ? <Skeleton h={80} /> : q.error ? <Alert tone="error">{q.error.message}</Alert> : items.length === 0 ? <p className="cl-muted">No feedback yet.</p> : (
        <div className="cl-stack" style={{ gap: 8, maxHeight: 360, overflowY: 'auto' }}>
          {items.slice(0, 30).map((s) => (
            <div key={s.id} className="adm-suggestion"><small><span>{s.submitter || 'Anonymous'}</span><span>{fmtDate(s.submitted_at)}</span></small><p>{s.text}</p></div>
          ))}
        </div>
      )}
    </Card>
  )
}
