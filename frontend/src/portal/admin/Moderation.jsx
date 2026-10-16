import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ShieldQuestion, FolderKanban, Flag, Check, X, RefreshCw, ChevronDown, ExternalLink, Plus, RotateCcw, Paperclip, Copy,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusPill, Tabs, Textarea, cx, fmtDate, statusLabel, timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { mediaUrl } from '../../lib/api.js'
import { branchThumb } from '../../branding/branches.js'
import VerificationReport, { VerdictBadge } from '../../components/VerificationReport.jsx'
import { ConfirmModal, MiniStat, NoteModal, fmtNum, qs } from './components/adminKit.jsx'

const TABS = ['requests', 'projects', 'flags']

export default function AdminModeration() {
  const api = useApi('admin')
  const location = useLocation()
  const navigate = useNavigate()
  const urlTab = new URLSearchParams(location.search).get('tab')
  const [tab, setTabState] = useState(TABS.includes(urlTab) ? urlTab : 'requests')
  useEffect(() => { if (TABS.includes(urlTab)) setTabState(urlTab) }, [urlTab])
  const setTab = (t) => { setTabState(t); navigate({ search: `?tab=${t}` }, { replace: true }) }
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const counts = useQuery(async () => {
    const [reqs, projects, flags] = await Promise.all([
      api.get('/api/admin/recruiter-requests'),
      api.get('/api/admin/portal/projects?status=under_review'),
      api.get('/api/admin/portal/flags?status=open'),
    ])
    return { requests: reqs.length, projects: projects.items.length, flags: flags.items.length, high: reqs.filter((r) => r.verification_verdict === 'high_risk').length }
  }, [api, version])
  const c = counts.data

  return (
    <div className="adm-page">
      <PageHeader title="Content Moderation" subtitle="Approve recruiter access, verify student projects and resolve reported content." />
      <div className="adm-mini-grid adm-mini-4">
        <MiniStat icon={ShieldQuestion} tone="amber" value={c ? fmtNum(c.requests) : '…'} label="Recruiter requests" sub="awaiting approval" active={tab === 'requests'} onClick={() => setTab('requests')} />
        <MiniStat icon={ShieldCheck} tone="red" value={c ? fmtNum(c.high) : '…'} label="High-risk requests" sub="failed company checks" onClick={() => setTab('requests')} />
        <MiniStat icon={FolderKanban} tone="purple" value={c ? fmtNum(c.projects) : '…'} label="Projects to verify" sub="submitted by students" active={tab === 'projects'} onClick={() => setTab('projects')} />
        <MiniStat icon={Flag} tone="red" value={c ? fmtNum(c.flags) : '…'} label="Open flags" sub="reported content" active={tab === 'flags'} onClick={() => setTab('flags')} />
      </div>
      <Card className="adm-listcard">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'requests', label: 'Recruiter Requests', count: c?.requests },
          { id: 'projects', label: 'Project Verification', count: c?.projects },
          { id: 'flags', label: 'Reports & Flags', count: c?.flags },
        ]} />
        {tab === 'requests' && <Requests api={api} version={version} onChanged={bump} />}
        {tab === 'projects' && <Projects api={api} version={version} onChanged={bump} />}
        {tab === 'flags' && <Flags api={api} version={version} onChanged={bump} />}
      </Card>
    </div>
  )
}

/* ── recruiter access requests ───────────────────────────────────── */
function Requests({ api, version, onChanged }) {
  const toast = useToast()
  const pending = useQuery(() => api.get('/api/admin/recruiter-requests'), [api, version])
  const history = useQuery(() => api.get('/api/admin/portal/recruiter-requests?status=decided'), [api, version])
  const [expanded, setExpanded] = useState(() => new Set())
  const [approve, setApprove] = useState(null)
  const [reject, setReject] = useState(null)
  const [busy, setBusy] = useState(null)
  const [created, setCreated] = useState(null)

  const reverify = async (r) => {
    setBusy(`v${r.id}`)
    try {
      const res = await api.post(`/api/admin/recruiter-requests/${r.id}/reverify`)
      toast(`Re-checked ${r.company_name || r.email}: score ${res.verification_score}`, 'success')
      pending.reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const doApprove = async () => {
    setBusy('approve')
    try {
      const res = await api.post(`/api/admin/portal/recruiter-requests/${approve.id}/approve`)
      setCreated({ ...res, name: approve.name, email: approve.email })
      toast(`${approve.name} approved — recruiter account created`, 'success')
      setApprove(null)
      onChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const doReject = async (reason) => {
    setBusy('reject')
    try {
      await api.post(`/api/admin/portal/recruiter-requests/${reject.id}/reject`, { reason: reason || null })
      toast(`Request from ${reject.name} rejected`, 'success')
      setReject(null)
      onChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const toggle = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="cl-stack" style={{ gap: 14 }}>
      {pending.error && <Alert tone="error">{pending.error.message}</Alert>}
      {pending.loading && !pending.data && <><Skeleton h={90} /><Skeleton h={90} /></>}
      {pending.data && pending.data.length === 0 && <EmptyState icon={ShieldCheck} title="No pending recruiter requests" text="New requests from the recruiter sign-in page land here for review." />}
      {(pending.data || []).map((r) => (
        <article key={r.id} className="adm-req">
          <div className="adm-req-head">
            <div className="adm-req-meta">
              <strong style={{ color: 'var(--cl-ink)', fontSize: 15 }}>{r.name}{r.designation ? <span className="cl-muted" style={{ fontWeight: 400 }}> · {r.designation}</span> : null}</strong>
              <span>{r.email} · {r.phone}</span>
              <span><strong style={{ color: 'var(--cl-text)' }}>{r.company_name || 'Company not given'}</strong>{r.company_website ? <> · <a className="cl-link" href={r.company_website} target="_blank" rel="noreferrer">{r.company_website.replace(/^https?:\/\//, '')} <ExternalLink size={11} /></a></> : null}</span>
              <span>Submitted {fmtDate(r.submitted_at)} ({timeAgo(r.submitted_at)}){r.gstin ? ` · GSTIN ${r.gstin}` : ''}{r.cin ? ` · CIN ${r.cin}` : ''}</span>
            </div>
            <div className="cl-row cl-wrap" style={{ gap: 8 }}>
              <VerdictBadge verdict={r.verification_verdict} score={r.verification_score} />
            </div>
          </div>
          <div className="cl-row cl-wrap" style={{ gap: 8 }}>
            <Button size="sm" icon={Check} onClick={() => setApprove(r)}>Approve</Button>
            <Button size="sm" variant="danger" icon={X} onClick={() => setReject(r)}>Reject</Button>
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === `v${r.id}`} onClick={() => reverify(r)}>Re-run checks</Button>
            <Button size="sm" variant="ghost" iconRight={ChevronDown} aria-expanded={expanded.has(r.id)} onClick={() => toggle(r.id)}>
              {expanded.has(r.id) ? 'Hide' : 'Show'} verification report
            </Button>
          </div>
          {expanded.has(r.id) && <div className="adm-req-report"><VerificationReport verification={r.verification} /></div>}
        </article>
      ))}

      <h3 className="adm-section-title" style={{ marginTop: 8 }}>Recently decided</h3>
      {history.loading && !history.data ? <Skeleton h={60} /> : (history.data?.items || []).length === 0 ? <p className="cl-muted">No decisions yet.</p> : (
        <div className="cl-table-wrap">
          <table className="cl-table cards">
            <thead><tr><th>Name</th><th>Company</th><th>Check</th><th>Submitted</th><th>Decided</th><th>Status</th></tr></thead>
            <tbody>
              {history.data.items.slice(0, 15).map((h) => (
                <tr key={h.id}>
                  <td data-label="Name"><strong>{h.name}</strong><div className="cl-muted" style={{ fontSize: 12 }}>{h.email}</div></td>
                  <td data-label="Company">{h.company_name || '—'}</td>
                  <td data-label="Check"><VerdictBadge verdict={h.verdict} score={h.score} /></td>
                  <td data-label="Submitted">{fmtDate(h.submitted_at)}</td>
                  <td data-label="Decided">{fmtDate(h.decided_at)}</td>
                  <td data-label="Status"><StatusPill status={h.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal open={!!approve} busy={busy === 'approve'} title={`Approve ${approve?.name}?`} confirmLabel="Approve & create account"
        text={`A recruiter account is created for ${approve?.email} and login details are emailed to them.${approve?.verification_verdict === 'high_risk' ? ' This request FAILED the automatic company checks — make sure you have verified the company yourself.' : ''}`}
        onConfirm={doApprove} onClose={() => setApprove(null)} />
      <NoteModal open={!!reject} busy={busy === 'reject'} danger title={`Reject request from ${reject?.name}?`} label="Reason (included in the email, optional)" confirmLabel="Reject request"
        placeholder="e.g. We could not verify the company website." onSubmit={doReject} onClose={() => setReject(null)} />
      <Modal open={!!created} onClose={() => setCreated(null)} title="Recruiter account created"
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
        {created && (
          <div className="cl-stack" style={{ gap: 12 }}>
            <p>{created.name} ({created.email}) can now sign in at the recruiter login page.</p>
            {created.email_sent === false && <Alert tone="warn">{created.warning || 'The credentials email could not be delivered — share the password securely.'}</Alert>}
            {created.temporary_password && (
              <div className="adm-temp">Temporary password (shown only once — copy it now): <code>{created.temporary_password}</code>
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard?.writeText(created.temporary_password)}>Copy</Button></div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── student project verification ────────────────────────────────── */
const PROJECT_FILTERS = [{ value: 'under_review', label: 'Awaiting review' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Needs changes' }, { value: 'all', label: 'All projects' }]

function Projects({ api, version, onChanged }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState('under_review')
  const list = useQuery(() => api.get(`/api/admin/portal/projects${qs({ status })}`), [api, status, version])
  const [decide, setDecide] = useState(null) // {project, verified}
  const [busy, setBusy] = useState(false)
  const submit = async (note) => {
    setBusy(true)
    try {
      await api.post(`/api/admin/portal/projects/${decide.project.id}/${decide.verified ? 'verify' : 'reject'}`, { note: note || null })
      toast(decide.verified ? 'Project verified — the student has been notified' : 'Sent back to the student with your note', 'success')
      setDecide(null)
      onChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const items = list.data?.items || []
  return (
    <div className="cl-stack" style={{ gap: 14 }}>
      <div className="cl-row cl-wrap" style={{ gap: 10, justifyContent: 'space-between' }}>
        <label className="adm-fsel" style={{ minWidth: 200 }}>
          <span className="cl-sr">Project status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={PROJECT_FILTERS} aria-label="Project status" />
        </label>
        <span className="cl-muted" style={{ fontSize: 13 }}>
          {Object.entries(list.data?.counts || {}).map(([s, n]) => `${statusLabel(s)}: ${n}`).join(' · ')}
        </span>
      </div>
      {list.error && <Alert tone="error">{list.error.message}</Alert>}
      {list.loading && !list.data && <><Skeleton h={100} /><Skeleton h={100} /></>}
      {list.data && items.length === 0 && <EmptyState icon={FolderKanban} title={status === 'under_review' ? 'No projects waiting for review' : 'No projects here'} text="Students submit projects for verification from their Projects page." />}
      {items.map((p, i) => (
        <article key={p.id} className="adm-req adm-proj">
          <img src={p.image ? mediaUrl(p.image) : branchThumb(p.candidate.branch, i)} alt={p.image ? p.title : ''} loading="lazy" />
          <div className="cl-stack" style={{ gap: 6, minWidth: 0 }}>
            <div className="cl-row cl-wrap" style={{ gap: 8 }}><strong style={{ fontSize: 15 }}>{p.title}</strong><StatusPill status={p.status} />{p.category && <Badge>{p.category}</Badge>}</div>
            <button type="button" className="cl-link" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => navigate(`/admin/users?user=${p.candidate.id}`)}>
              {p.candidate.name}{p.candidate.college ? ` · ${p.candidate.college}` : ''}{p.candidate.branch_label ? ` · ${p.candidate.branch_label}` : ''}
            </button>
            {p.description && <p className="cl-muted adm-clamp" style={{ fontSize: 13.5 }}>{p.description}</p>}
            <div className="cl-chips">{[...(p.tools || []), ...(p.tags || [])].slice(0, 8).map((t) => <span key={t} className="cl-chip">{t}</span>)}</div>
            <div className="cl-row cl-wrap" style={{ gap: 12, fontSize: 13 }}>
              {(p.links || []).filter((l) => (l?.url || l)).slice(0, 3).map((l, j) => {
                const url = typeof l === 'string' ? l : l.url
                return <a key={j} className="cl-link" href={url} target="_blank" rel="noreferrer">{(typeof l === 'string' ? '' : l.label) || url.replace(/^https?:\/\//, '').slice(0, 40)} <ExternalLink size={11} /></a>
              })}
              {p.file && <a className="cl-link" href={mediaUrl(p.file)} target="_blank" rel="noreferrer"><Paperclip size={12} /> Attachment</a>}
              <span className="cl-muted">Updated {timeAgo(p.updated_at)}</span>
            </div>
            {p.note && <div className="adm-note"><p>{p.note}</p><small>Reviewer note</small></div>}
          </div>
          <div className="adm-proj-actions">
            {p.status !== 'verified' && <Button size="sm" icon={Check} onClick={() => setDecide({ project: p, verified: true })}>Verify</Button>}
            {p.status !== 'rejected' && <Button size="sm" variant="danger" icon={X} onClick={() => setDecide({ project: p, verified: false })}>Request changes</Button>}
          </div>
        </article>
      ))}
      <NoteModal open={!!decide} busy={busy} danger={decide && !decide.verified}
        title={decide?.verified ? `Verify “${decide?.project.title}”` : `Request changes to “${decide?.project.title}”`}
        label={decide?.verified ? 'Note to the student (optional)' : 'What needs to change?'} required={decide && !decide.verified}
        confirmLabel={decide?.verified ? 'Verify project' : 'Send back'} onSubmit={submit} onClose={() => setDecide(null)} />
    </div>
  )
}

/* ── reports & flags ─────────────────────────────────────────────── */
const FLAG_STATUS = [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }, { value: '', label: 'All' }]
const KINDS = [{ value: 'job', label: 'Job posting' }, { value: 'profile', label: 'Student profile' }, { value: 'company', label: 'Company' }, { value: 'application', label: 'Application' }, { value: 'other', label: 'Other' }]

function Flags({ api, version, onChanged }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [status, setStatus] = useState('open')
  const list = useQuery(() => api.get(`/api/admin/portal/flags${qs({ status })}`), [api, status, version])
  const [busy, setBusy] = useState(null)
  const [adding, setAdding] = useState(false)
  const setFlag = async (f, next) => {
    setBusy(`${f.id}${next}`)
    try {
      await api.post(`/api/admin/portal/flags/${f.id}`, { status: next })
      toast(next === 'open' ? 'Flag reopened' : `Flag ${next}`, 'success')
      onChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const target = (f) => {
    if (f.kind === 'job' && f.target_id) return () => navigate(`/admin/jobs?open=${f.target_id}`)
    if (f.kind === 'profile' && f.target_id) return () => navigate(`/admin/users?user=c-${f.target_id}`)
    if (f.kind === 'application') return () => navigate('/admin/applications')
    if (f.kind === 'company') return () => navigate(`/admin/companies?q=${encodeURIComponent(f.title.replace(/^Company flagged:\s*/, ''))}`)
    return null
  }
  const items = list.data?.items || []
  return (
    <div className="cl-stack" style={{ gap: 14 }}>
      <div className="cl-row cl-wrap" style={{ gap: 10, justifyContent: 'space-between' }}>
        <div className="cl-seg" role="group" aria-label="Flag status">
          {FLAG_STATUS.map((o) => (
            <button key={o.value || 'all'} type="button" className={status === o.value ? 'active' : ''} aria-pressed={status === o.value} onClick={() => setStatus(o.value)}>
              {o.label}{o.value && list.data?.counts?.[o.value] != null ? ` (${list.data.counts[o.value]})` : ''}
            </button>
          ))}
        </div>
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>New flag</Button>
      </div>
      {list.error && <Alert tone="error">{list.error.message}</Alert>}
      {list.loading && !list.data && <Skeleton h={80} />}
      {list.data && items.length === 0 && <EmptyState icon={Flag} title={status === 'open' ? 'No open flags' : 'Nothing here'} text="Flag jobs from Job Postings, companies from Companies, or add one manually." />}
      {items.map((f) => {
        const go = target(f)
        return (
          <article key={f.id} className="adm-req">
            <div className="adm-req-head">
              <div className="cl-row" style={{ gap: 12, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
                <span className={cx('adm-flag-ico', f.severity)}><Flag size={17} /></span>
                <div className="adm-req-meta" style={{ minWidth: 0 }}>
                  <strong style={{ color: 'var(--cl-ink)', fontSize: 14.5 }}>{f.title}</strong>
                  {f.detail && <span style={{ whiteSpace: 'pre-wrap' }}>{f.detail}</span>}
                  <span>{statusLabel(f.kind)} · {statusLabel(f.severity)} severity · reported by {f.reported_by || 'system'} · {timeAgo(f.created_at)}{f.resolved_at ? ` · closed ${fmtDate(f.resolved_at)}` : ''}</span>
                </div>
              </div>
              <StatusPill status={f.status === 'open' ? 'pending' : f.status === 'resolved' ? 'completed' : 'archived'} label={statusLabel(f.status)} />
            </div>
            <div className="cl-row cl-wrap" style={{ gap: 8 }}>
              {go && <Button size="sm" variant="secondary" icon={ExternalLink} onClick={go}>Open {statusLabel(f.kind).toLowerCase()}</Button>}
              {f.status === 'open' ? <>
                <Button size="sm" icon={Check} loading={busy === `${f.id}resolved`} onClick={() => setFlag(f, 'resolved')}>Resolve</Button>
                <Button size="sm" variant="ghost" icon={X} loading={busy === `${f.id}dismissed`} onClick={() => setFlag(f, 'dismissed')}>Dismiss</Button>
              </> : <Button size="sm" variant="ghost" icon={RotateCcw} loading={busy === `${f.id}open`} onClick={() => setFlag(f, 'open')}>Reopen</Button>}
            </div>
          </article>
        )
      })}
      <NewFlagModal open={adding} api={api} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); onChanged() }} />
    </div>
  )
}

function NewFlagModal({ open, api, onClose, onCreated }) {
  const toast = useToast()
  const [f, setF] = useState({ kind: 'job', target_id: '', title: '', detail: '', severity: 'medium' })
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setF({ kind: 'job', target_id: '', title: '', detail: '', severity: 'medium' }); setErr({}) } }, [open])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const e = {}
    if (f.title.trim().length < 3) e.title = 'Give the flag a short title'
    if (f.target_id && !/^\d+$/.test(f.target_id.trim())) e.target_id = 'Use the numeric ID (e.g. job #12 → 12)'
    setErr(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      await api.post('/api/admin/portal/flags', { ...f, title: f.title.trim(), target_id: f.target_id ? Number(f.target_id) : null })
      toast('Flag created', 'success')
      onCreated()
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="New moderation flag"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Create flag</Button></>}>
      <div className="cl-stack" style={{ gap: 12 }}>
        <div className="cl-grid cl-grid-2">
          <Field label="Type"><Select value={f.kind} onChange={set('kind')} options={KINDS} /></Field>
          <Field label="Severity"><Select value={f.severity} onChange={set('severity')} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} /></Field>
        </div>
        <Field label="Target ID (optional)" hint="Job ID, or the number in a student's c-<id>" error={err.target_id}><Input value={f.target_id} onChange={set('target_id')} inputMode="numeric" /></Field>
        <Field label="Title" error={err.title}><Input value={f.title} onChange={set('title')} maxLength={200} placeholder="e.g. Spam applications from one account" /></Field>
        <Field label="Details"><Textarea value={f.detail} onChange={set('detail')} maxLength={2000} placeholder="What was reported and what should be checked" /></Field>
      </div>
    </Modal>
  )
}
