import React, { useEffect, useMemo, useState } from 'react'
import {
  Radio, RefreshCw, Briefcase, Archive, BookOpen, FileUp, KeyRound, CheckCircle2, XCircle, AlertTriangle, Plus, X, FlaskConical,
  Link2, Upload, Trash2, Eye, EyeOff, ExternalLink, Clock, Building2, Save, EyeOff as HideIcon,
} from 'lucide-react'
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusPill, Tabs,
  Textarea, Toggle, timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { mediaUrl } from '../../lib/api.js'
import { BRANCHES } from '../../branding/branches.js'
import { ConfirmModal, MiniStat, fmtDateTime, fmtNum, qs } from './components/adminKit.jsx'
import './components/liveData.css'
import DemoCompaniesCard from './components/DemoCompaniesCard.jsx'

const RUN_TONE = { ok: 'green', partial: 'amber', error: 'red', skipped: '', running: 'blue' }
const RUN_LABEL = { ok: 'Success', partial: 'Partial', error: 'Failed', skipped: 'Skipped', running: 'Running' }
const KIND_OPTS = [
  { value: 'notes', label: 'Notes' }, { value: 'paper', label: 'Paper' }, { value: 'video', label: 'Video' },
  { value: 'article', label: 'Article' }, { value: 'course', label: 'Course' },
]
const BRANCH_OPTS = [...BRANCHES.map((b) => ({ value: b.id, label: b.long })), { value: 'all', label: 'All branches' }]
const SOURCE_HELP = {
  smartrecruiters: 'Official career sites hosted on SmartRecruiters (no key needed). Add company ids below.',
  adzuna: 'Adzuna job search API — free key at developer.adzuna.com.',
  jooble: 'Jooble job search API — free key at jooble.org/api/about.',
  greenhouse: 'Greenhouse job boards (no key). Add board tokens below.',
  lever: 'Lever job sites (no key). Add company slugs below.',
  arxiv: 'Newest research papers per branch from arXiv (no key).',
  youtube: 'Newest lectures per branch — YouTube Data API v3 key (free).',
}

export function RunPill({ status }) {
  return <Badge tone={RUN_TONE[status] ?? ''} dot>{RUN_LABEL[status] || status}</Badge>
}

export default function AdminLiveData() {
  const api = useApi('admin')
  const toast = useToast()
  const q = useQuery(() => api.get('/api/admin/live-sync/status'), [api])
  const d = q.data
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState('sources')

  // Poll while a sync is running.
  useEffect(() => {
    if (!d?.running) return undefined
    const t = setInterval(() => q.reload(), 4000)
    return () => clearInterval(t)
  }, [d?.running]) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async (kind) => {
    setBusy(kind)
    try {
      const r = await api.post('/api/admin/live-sync', { kind })
      if (r.started) {
        const skipped = r.sources.filter((s) => s.state !== 'queued').length
        toast(`Sync started (${r.sources.length - skipped} source${r.sources.length - skipped === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''})`, 'success')
      } else toast(r.message || 'A sync is already running', 'info')
      setTimeout(() => q.reload(), 800)
    } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }

  const toggle = async (source, on) => {
    try {
      await api.put('/api/admin/live-sync/settings', { enabled: { [source]: on } })
      toast(`${on ? 'Enabled' : 'Disabled'} ${source}`, 'success')
      q.reload()
    } catch (e) { toast(e.message, 'error') }
  }

  const t = d?.totals || {}
  return (
    <div className="adm-page">
      <PageHeader title="Live Data" subtitle="Live jobs from official company career sites and job APIs, plus fresh learning resources. No scraping — official, documented APIs only."
        actions={<>
          <Button variant="secondary" icon={Briefcase} loading={busy === 'jobs'} disabled={d?.running} onClick={() => sync('jobs')}>Sync jobs</Button>
          <Button variant="secondary" icon={BookOpen} loading={busy === 'resources'} disabled={d?.running} onClick={() => sync('resources')}>Sync resources</Button>
          <Button icon={RefreshCw} loading={busy === 'all'} disabled={d?.running} onClick={() => sync('all')}>{d?.running ? 'Syncing…' : 'Sync now'}</Button>
        </>} />
      {q.error && <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>}
      {d?.running && <Alert icon={RefreshCw}>A sync is running. This page refreshes automatically.</Alert>}
      {d?.schedule && (d.schedule.auto ? (
        <Alert tone="success" icon={Clock}>
          Automatic sync is on: every {d.schedule.interval_hours} h, run by the server itself
          {d.schedule.last_success_at ? <> · last success {timeAgo(d.schedule.last_success_at)}</> : ' · first run starts shortly'}
          {d.schedule.next_run_at && d.schedule.last_success_at ? <> · next {fmtDateTime(d.schedule.next_run_at)}</> : null}
          {d.schedule.keep_awake ? ' · keep-awake ping on' : ' · server may sleep when idle (it syncs again as soon as it wakes)'}.
          New jobs are published company by company while a sync runs.
        </Alert>
      ) : (
        <Alert tone="warn" icon={AlertTriangle}>Automatic sync is off (<code>LIVE_SYNC_AUTO=false</code>). Use “Sync now”, or call <code>/api/internal/live-sync</code> from a scheduler with <code>LIVE_SYNC_TOKEN</code> (see DEPLOY.md).</Alert>
      ))}

      <div className="adm-mini-grid adm-mini-5">
        <MiniStat icon={Radio} tone="teal" value={fmtNum(t.active_jobs)} label="Live jobs shown" sub={`max ${fmtNum(d?.limits?.max_active_jobs)}`} />
        <MiniStat icon={Archive} tone="amber" value={fmtNum(t.expired_jobs)} label="Expired (hidden)" sub={`pruned after ${d?.limits?.prune_after_days ?? 30} days`} />
        <MiniStat icon={EyeOff} tone="red" value={fmtNum(t.hidden_jobs)} label="Hidden by admin" />
        <MiniStat icon={BookOpen} tone="purple" value={fmtNum(t.resources)} label="Live resources" />
        <MiniStat icon={FileUp} tone="green" value={fmtNum(t.admin_notes)} label="Admin notes & links" />
      </div>

      <Card flush><div style={{ padding: '0 10px' }}>
        <Tabs tabs={[
          { id: 'sources', label: 'Sources', icon: Radio },
          { id: 'history', label: 'Run history', icon: Clock, count: d?.runs?.length },
          { id: 'jobs', label: 'Live listings', icon: Briefcase, count: t.active_jobs },
          { id: 'resources', label: 'Resources & notes', icon: BookOpen },
        ]} value={tab} onChange={setTab} />
      </div></Card>

      {tab === 'sources' && (
        <>
          {!d ? <div className="ld-sources">{[0, 1, 2].map((i) => <Skeleton key={i} h={210} />)}</div> : (
            <div className="ld-sources">
              {d.sources.map((s) => <SourceCard key={s.source} s={s} onToggle={(on) => toggle(s.source, on)} />)}
            </div>
          )}
          <div className="ld-boards">
            <BoardEditor provider="smartrecruiters" title="SmartRecruiters companies" hint="Company identifier from the careers URL, e.g. jobs.smartrecruiters.com/BoschGroup → BoschGroup. Only India postings are synced."
              field="smartrecruiters_companies" settings={d?.settings} onSaved={q.reload} />
            <BoardEditor provider="greenhouse" title="Greenhouse boards" hint="Board token from boards.greenhouse.io/<token>. Leave empty to disable."
              field="greenhouse_boards" settings={d?.settings} onSaved={q.reload} />
            <BoardEditor provider="lever" title="Lever companies" hint="Company slug from jobs.lever.co/<company>. Leave empty to disable."
              field="lever_boards" settings={d?.settings} onSaved={q.reload} />
          </div>
          <Card title={<><KeyRound size={18} />API keys</>} subtitle="Set as environment variables on the server — values are never shown here.">
            {!d ? <Skeleton h={60} /> : (
              <div className="ld-keys">
                {Object.entries(d.keys).map(([k, v]) => (
                  <span key={k} className={`ld-key ${v ? 'on' : ''}`}>{v ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<code>{k}</code>{v ? 'set' : 'not set'}</span>
                ))}
              </div>
            )}
          </Card>
          <DemoCompaniesCard />
        </>
      )}
      {tab === 'history' && <RunHistory runs={d?.runs} loading={q.loading && !d} />}
      {tab === 'jobs' && <LiveListings />}
      {tab === 'resources' && <ResourceManager />}
    </div>
  )
}

function SourceCard({ s, onToggle }) {
  const r = s.last_run
  const state = !s.enabled ? ['', 'Disabled'] : s.configured ? ['green', 'Configured'] : ['amber', 'Not configured']
  return (
    <Card className="ld-source">
      <div className="ld-source-head">
        <div style={{ minWidth: 0 }}>
          <strong>{s.label}</strong>
          <div className="cl-row" style={{ gap: 6, marginTop: 4 }}>
            <Badge tone={s.kind === 'jobs' ? 'blue' : 'purple'}>{s.kind === 'jobs' ? 'Jobs' : 'Resources'}</Badge>
            <Badge tone={state[0]} dot>{state[1]}</Badge>
          </div>
        </div>
        <Toggle checked={s.enabled} onChange={onToggle} label={`${s.enabled ? 'Disable' : 'Enable'} ${s.label}`} />
      </div>
      <p className="ld-help">{SOURCE_HELP[s.source]}</p>
      {s.needs_key && (
        <div className="ld-keys">
          {Object.entries(s.keys).map(([k, v]) => <span key={k} className={`ld-key ${v ? 'on' : ''}`}>{v ? <CheckCircle2 size={14} /> : <XCircle size={14} />}<code>{k}</code></span>)}
        </div>
      )}
      <div className="ld-nums">
        <div><b>{fmtNum(s.active)}</b><small>{s.kind === 'jobs' ? 'active jobs' : 'items'}</small></div>
        <div><b>{r ? fmtNum(r.fetched) : '—'}</b><small>fetched</small></div>
        <div><b>{r ? fmtNum(r.added) : '—'}</b><small>added</small></div>
        <div><b>{r ? fmtNum(r.expired) : '—'}</b><small>{s.kind === 'jobs' ? 'expired' : 'pruned'}</small></div>
      </div>
      <div className="ld-last">
        {r ? <><RunPill status={r.status} /><span className="cl-muted">{timeAgo(r.started_at)}{r.duration_s != null ? ` · ${r.duration_s}s` : ''}</span></> : <span className="cl-muted">Never synced</span>}
      </div>
      {r?.error && <div className={`ld-error ${r.status === 'skipped' ? 'soft' : ''}`} title={r.error}>{r.error}</div>}
      {s.last_success && s.last_success.id !== r?.id && <small className="cl-muted">Last success {timeAgo(s.last_success.started_at)}</small>}
    </Card>
  )
}

function BoardEditor({ provider, title, hint, field, settings, onSaved }) {
  const api = useApi('admin')
  const toast = useToast()
  const [ids, setIds] = useState(null)
  const [input, setInput] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [tests, setTests] = useState({})
  useEffect(() => { if (settings) setIds(settings[field] || []) }, [settings, field])
  const dirty = ids && settings && JSON.stringify(ids) !== JSON.stringify(settings[field] || [])

  const add = () => {
    const v = input.trim()
    if (!v) return
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(v)) return setErr('Letters, digits, - _ . only')
    if (ids.some((x) => x.toLowerCase() === v.toLowerCase())) return setErr('Already in the list')
    if (ids.length >= 25) return setErr('At most 25 entries')
    setIds([...ids, v]); setInput(''); setErr('')
  }
  const test = async (id) => {
    setTests((t) => ({ ...t, [id]: { busy: true } }))
    try {
      const r = await api.post('/api/admin/live-sync/test-company', { provider, id })
      setTests((t) => ({ ...t, [id]: r }))
    } catch (e) { setTests((t) => ({ ...t, [id]: { ok: false, error: e.message } })) }
  }
  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/admin/live-sync/settings', { [field]: ids })
      toast(`${title} saved`, 'success')
      onSaved()
    } catch (e) { toast(e.message, 'error') } finally { setSaving(false) }
  }

  return (
    <Card title={<><Building2 size={18} />{title}</>} subtitle={hint}
      action={<Button size="sm" icon={Save} loading={saving} disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>}>
      {!ids ? <Skeleton h={80} /> : (
        <div className="cl-stack" style={{ gap: 10 }}>
          {ids.length === 0 && <p className="cl-muted" style={{ fontSize: 13.5 }}>None — this source is off.</p>}
          {ids.map((id) => {
            const r = tests[id]
            return (
              <div key={id} className="ld-board-row">
                <code>{id}</code>
                <span className="cl-grow ld-test">
                  {r?.busy ? 'Testing…' : r ? (r.ok ? <><CheckCircle2 size={14} color="var(--cl-green)" /> {fmtNum(r.count)} live posting{r.count === 1 ? '' : 's'}{r.company && r.company !== id ? ` · ${r.company}` : ''}</> : <><XCircle size={14} color="var(--cl-red)" /> {r.error}</>) : ''}
                </span>
                <Button size="sm" variant="ghost" icon={FlaskConical} onClick={() => test(id)} disabled={r?.busy} aria-label={`Test ${id}`}>Test</Button>
                <button type="button" className="cl-icon-btn" aria-label={`Remove ${id}`} onClick={() => setIds(ids.filter((x) => x !== id))}><X size={16} /></button>
              </div>
            )
          })}
          <form className="ld-add" onSubmit={(e) => { e.preventDefault(); add() }}>
            <Field label="Add id" error={err}><Input value={input} onChange={(e) => { setInput(e.target.value); setErr('') }} placeholder={provider === 'smartrecruiters' ? 'e.g. Continental' : 'board token'} maxLength={80} /></Field>
            <Button type="submit" variant="outline" icon={Plus}>Add</Button>
            {input.trim() && <Button type="button" variant="ghost" icon={FlaskConical} onClick={() => test(input.trim())}>Test</Button>}
          </form>
          {input.trim() && tests[input.trim()] && !tests[input.trim()].busy && (
            <small className="cl-muted">{tests[input.trim()].ok ? `${input.trim()}: ${fmtNum(tests[input.trim()].count)} live postings` : `${input.trim()}: ${tests[input.trim()].error}`}</small>
          )}
        </div>
      )}
    </Card>
  )
}

function RunHistory({ runs, loading }) {
  const columns = [
    { key: 'source', header: 'Source', sortable: true, render: (r) => <strong style={{ color: 'var(--cl-ink)' }}>{r.source}</strong> },
    { key: 'status', header: 'Status', render: (r) => <RunPill status={r.status} /> },
    { key: 'started_at', header: 'Started', sortable: true, render: (r) => <span title={fmtDateTime(r.started_at)}>{timeAgo(r.started_at)}</span> },
    { key: 'duration_s', header: 'Duration', render: (r) => (r.duration_s != null ? `${r.duration_s}s` : '—') },
    { key: 'fetched', header: 'Fetched', align: 'right' },
    { key: 'added', header: 'Added', align: 'right' },
    { key: 'updated', header: 'Updated', align: 'right' },
    { key: 'expired', header: 'Expired', align: 'right' },
    { key: 'triggered_by', header: 'Trigger', render: (r) => <span className="cl-muted">{(r.triggered_by || '').replace(/^admin:/, '')}</span> },
    { key: 'error', header: 'Notes', render: (r) => r.error ? <span className="ld-cell-err" title={r.error}>{r.error}</span> : <span className="cl-faint">—</span> },
  ]
  return (
    <Card title="Run history" subtitle="One row per source per sync (most recent 30).">
      <DataTable columns={columns} rows={runs || []} loading={loading}
        empty={<EmptyState icon={Clock} title="No syncs yet" text="Press “Sync now” or set up the scheduled sync." />} />
    </Card>
  )
}

function LiveListings() {
  const api = useApi('admin')
  const toast = useToast()
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useQuery(() => api.get(`/api/admin/live-sync/jobs${qs({ status, q: search.trim() || undefined, page, page_size: 15 })}`), [api, status, search, page])
  const setStat = async (j, s) => {
    try {
      await api.patch(`/api/admin/live-sync/jobs/${j.id}`, { status: s })
      toast(s === 'hidden' ? 'Hidden from students' : 'Visible to students again', 'success')
      q.reload()
    } catch (e) { toast(e.message, 'error') }
  }
  const columns = [
    { key: 'title', header: 'Job', render: (j) => <div style={{ minWidth: 0 }}><strong style={{ color: 'var(--cl-ink)' }}>{j.title}</strong><small className="cl-muted" style={{ display: 'block' }}>{j.company} · {j.location}</small></div> },
    { key: 'source', header: 'Source', render: (j) => <span className="cl-muted">{j.source_label}</span> },
    { key: 'branch', header: 'Branch', render: (j) => BRANCHES.find((b) => b.id === j.branch)?.label || j.branch },
    { key: 'posted_at', header: 'Posted', render: (j) => timeAgo(j.posted_at) },
    { key: 'last_checked_at', header: 'Checked', render: (j) => timeAgo(j.last_checked_at) },
    { key: 'status', header: 'Status', render: (j) => <StatusPill status={j.status === 'active' ? 'active' : j.status === 'hidden' ? 'paused' : 'closed'} label={j.status} dot={false} /> },
    {
      key: 'act', header: '', align: 'right', render: (j) => (
        <div className="cl-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {j.apply_url && <Button size="sm" variant="ghost" href={j.apply_url} iconRight={ExternalLink} aria-label={`Open ${j.title} listing`}>Open</Button>}
          {j.status === 'active' && <Button size="sm" variant="outline" icon={HideIcon} onClick={() => setStat(j, 'hidden')}>Hide</Button>}
          {j.status === 'hidden' && <Button size="sm" variant="outline" icon={Eye} onClick={() => setStat(j, 'active')}>Unhide</Button>}
        </div>
      ),
    },
  ]
  const d = q.data
  return (
    <Card title="Live listings" subtitle="Everything students can see from external sources. Hide anything that looks wrong; expired listings return only if the source lists them again.">
      <div className="cl-row cl-wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div style={{ width: 280, maxWidth: '100%' }}><Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search title or company…" aria-label="Search live listings" maxLength={120} /></div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status" style={{ width: 'auto' }}
          options={[{ value: 'active', label: 'Active' }, { value: 'hidden', label: 'Hidden' }, { value: 'expired', label: 'Expired' }, { value: 'all', label: 'All' }]} />
      </div>
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      <DataTable columns={columns} rows={d?.items || []} loading={q.loading && !d}
        empty={<EmptyState icon={Briefcase} title="No listings" text="Nothing matches this filter yet." />} />
      {d && d.total > 0 && <Pagination page={d.page} pages={d.pages} total={d.total} pageSize={d.page_size} setPage={setPage} noun="listings" />}
    </Card>
  )
}

function ResourceManager() {
  const api = useApi('admin')
  const toast = useToast()
  const [f, setF] = useState({ branch: '', kind: '', source: '', status: 'all' })
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(null) // 'link' | 'pdf'
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const q = useQuery(() => api.get(`/api/admin/live-resources${qs({ ...f, branch: f.branch || undefined, kind: f.kind || undefined, source: f.source || undefined, page, page_size: 10 })}`), [api, f, page])
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setPage(1) }
  const patch = async (r, body, msg) => {
    try { await api.patch(`/api/admin/live-resources/${r.id}`, body); toast(msg, 'success'); q.reload() } catch (e) { toast(e.message, 'error') }
  }
  const del = async () => {
    setBusy(true)
    try { await api.del(`/api/admin/live-resources/${confirm.id}`); toast('Deleted', 'success'); setConfirm(null); q.reload() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const columns = [
    {
      key: 'title', header: 'Resource', render: (r) => (
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: 'var(--cl-ink)' }}>{r.title}</strong>
          <small className="cl-muted" style={{ display: 'block' }}>{r.author || r.created_by || ''}{r.file_url ? ' · PDF' : ''}</small>
        </div>
      ),
    },
    { key: 'branch', header: 'Branch', render: (r) => BRANCH_OPTS.find((b) => b.value === r.branch)?.label || r.branch },
    { key: 'kind', header: 'Type', render: (r) => <Badge>{r.kind}</Badge> },
    { key: 'source', header: 'Source', render: (r) => r.source_label },
    { key: 'published_at', header: 'Date', render: (r) => timeAgo(r.published_at || r.created_at) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status === 'active' ? 'active' : 'paused'} label={r.status === 'active' ? 'Visible' : 'Hidden'} dot={false} /> },
    {
      key: 'act', header: '', align: 'right', render: (r) => (
        <div className="cl-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" href={r.file_url ? mediaUrl(r.file_url) : r.url} iconRight={ExternalLink} aria-label={`Open ${r.title}`}>Open</Button>
          {r.status === 'active'
            ? <Button size="sm" variant="outline" icon={EyeOff} onClick={() => patch(r, { status: 'hidden' }, 'Hidden from students')}>Hide</Button>
            : <Button size="sm" variant="outline" icon={Eye} onClick={() => patch(r, { status: 'active' }, 'Visible to students')}>Show</Button>}
          <button type="button" className="cl-icon-btn" aria-label={`Delete ${r.title}`} onClick={() => setConfirm(r)}><Trash2 size={16} /></button>
        </div>
      ),
    },
  ]
  const d = q.data
  return (
    <Card title="Resources & notes" subtitle="arXiv papers and YouTube lectures arrive with each sync. Add your own links or PDF notes (max 10 MB) for any branch."
      action={<div className="cl-row" style={{ gap: 8 }}>
        <Button size="sm" variant="outline" icon={Link2} onClick={() => setAdding('link')}>Add link</Button>
        <Button size="sm" icon={Upload} onClick={() => setAdding('pdf')}>Upload PDF</Button>
      </div>}>
      <div className="cl-row cl-wrap" style={{ gap: 10, marginBottom: 12 }}>
        <Select value={f.branch} onChange={set('branch')} placeholder="All branches" options={BRANCH_OPTS} aria-label="Branch" style={{ width: 'auto' }} />
        <Select value={f.kind} onChange={set('kind')} placeholder="All types" options={KIND_OPTS} aria-label="Type" style={{ width: 'auto' }} />
        <Select value={f.source} onChange={set('source')} placeholder="All sources" options={[{ value: 'admin', label: 'Admin' }, { value: 'arxiv', label: 'arXiv' }, { value: 'youtube', label: 'YouTube' }]} aria-label="Source" style={{ width: 'auto' }} />
        <Select value={f.status} onChange={set('status')} options={[{ value: 'all', label: 'Any status' }, { value: 'active', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]} aria-label="Status" style={{ width: 'auto' }} />
      </div>
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      <DataTable columns={columns} rows={d?.items || []} loading={q.loading && !d}
        empty={<EmptyState icon={BookOpen} title="No resources" text="Sync resources or add a link / PDF." />} />
      {d && d.total > 0 && <Pagination page={d.page} pages={d.pages} total={d.total} pageSize={d.page_size} setPage={setPage} noun="resources" />}
      <AddResourceModal mode={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); setPage(1); q.reload() }} />
      <ConfirmModal open={!!confirm} title="Delete resource?" danger busy={busy} confirmLabel="Delete" onConfirm={del} onClose={() => setConfirm(null)}
        text={confirm ? `“${confirm.title}” will be removed for all students${confirm.file_url ? ' and the PDF deleted' : ''}. Synced items may return on the next sync — hide them instead to keep them out.` : ''} />
    </Card>
  )
}

function AddResourceModal({ mode, onClose, onDone }) {
  const api = useApi('admin')
  const toast = useToast()
  const [form, setForm] = useState({})
  const [file, setFile] = useState(null)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (mode) { setForm({ branch: '', kind: mode === 'pdf' ? 'notes' : 'article', title: '', url: '', author: '', summary: '' }); setFile(null); setErr({}) } }, [mode])
  if (!mode) return null
  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const e = {}
    if (!form.branch) e.branch = 'Choose a branch'
    if ((form.title || '').trim().length < 3) e.title = 'At least 3 characters'
    if (mode === 'link' && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(form.url.trim())) e.url = 'Full https:// link'
    if (mode === 'pdf') {
      if (!file) e.file = 'Choose a PDF'
      else if (!/\.pdf$/i.test(file.name)) e.file = 'Only PDF files'
      else if (file.size > 10 * 1024 * 1024) e.file = 'Max 10 MB'
    }
    setErr(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      if (mode === 'link') {
        await api.post('/api/admin/live-resources', { ...form, title: form.title.trim(), url: form.url.trim(), author: form.author || null, summary: form.summary || null })
      } else {
        const fd = new FormData()
        fd.append('file', file)
        ;['branch', 'kind', 'title', 'author', 'summary'].forEach((k) => { if (form[k]) fd.append(k, form[k]) })
        await api.post('/api/admin/live-resources/upload', fd)
      }
      toast(mode === 'pdf' ? 'Notes uploaded' : 'Link added', 'success')
      onDone()
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'pdf' ? 'Upload PDF notes' : 'Add a resource link'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} icon={mode === 'pdf' ? Upload : Plus} onClick={submit}>{mode === 'pdf' ? 'Upload' : 'Add link'}</Button></>}>
      <div className="cl-stack" style={{ gap: 12 }}>
        <div className="cl-grid cl-grid-2" style={{ gap: 12 }}>
          <Field label="Branch" error={err.branch}><Select value={form.branch} onChange={set('branch')} placeholder="Choose…" options={BRANCH_OPTS} /></Field>
          <Field label="Type"><Select value={form.kind} onChange={set('kind')} options={KIND_OPTS} /></Field>
        </div>
        <Field label="Title" error={err.title}><Input value={form.title} onChange={set('title')} maxLength={300} placeholder="e.g. Strength of Materials — Unit 3 notes" /></Field>
        {mode === 'link'
          ? <Field label="Link (https)" error={err.url}><Input value={form.url} onChange={set('url')} maxLength={1000} placeholder="https://…" /></Field>
          : <Field label="PDF file" hint="PDF only · max 10 MB" error={err.file}><input type="file" className="cl-input" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>}
        <Field label="Author / source (optional)"><Input value={form.author} onChange={set('author')} maxLength={200} /></Field>
        <Field label="Short description (optional)"><Textarea value={form.summary} onChange={set('summary')} maxLength={1000} rows={3} /></Field>
      </div>
    </Modal>
  )
}
