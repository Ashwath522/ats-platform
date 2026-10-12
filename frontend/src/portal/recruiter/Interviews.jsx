import React, { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bot, CalendarCheck, CalendarDays, CalendarPlus, CheckCircle2, ClipboardCheck, Clock, Download, LayoutTemplate, MessageSquare, Search, UserCheck,
} from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, Card, DataTable, Donut, EmptyState, Input, Legend, Menu, PageHeader, Pagination, Select, Skeleton, StatTile,
  StatusPill, Tabs, ViewAll, useToast, usePagination,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useRecruiter } from './RecruiterShell.jsx'
import ScheduleInterviewModal from './components/ScheduleInterviewModal.jsx'
import {
  DateRangePicker, H, ModeBadge, Stars, dayKey, downloadResponse, fmtD, fmtDT, fmtT, roundColor, todayKey,
} from './components/HiringCommon.jsx'
import InterviewsCalendar, { JoinOrView, interviewActions } from './components/InterviewsCalendar.jsx'
import {
  InterviewsCancelModal, InterviewsDetailsModal, InterviewsEditModal, InterviewsFeedbackModal, InterviewsPickModal, InterviewsTemplatesModal,
  REC_LABEL, REC_TONE,
} from './components/InterviewsDialogs.jsx'

const FALLBACK_ROUNDS = [
  { name: 'Technical Round 1', duration_min: 60, description: 'Core concepts, domain knowledge' },
  { name: 'Technical Round 2', duration_min: 60, description: 'Problem solving, hands-on skills' },
  { name: 'Project Discussion', duration_min: 45, description: 'Past projects, approach, teamwork' },
  { name: 'HR Round', duration_min: 30, description: 'Communication, culture fit, career goals' },
]
const TABS = [
  { id: 'calendar', label: 'Calendar View' },
  { id: 'list', label: 'Interview List' },
  { id: 'rounds', label: 'Interview Rounds' },
  { id: 'feedback', label: 'Feedback Management' },
]
const STATUS_OPTS = [
  { value: 'upcoming', label: 'Upcoming' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' },
  { value: 'pending_feedback', label: 'Pending feedback' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'no_show', label: 'No show' },
]
const KIND_OPTS = [{ value: 'human', label: 'Panel interviews' }, { value: 'ai', label: 'AI interviews' }]

function statusOf(iv) {
  if (iv.pending_feedback) return <StatusPill status="pending" label="Pending Feedback" />
  if (iv.kind === 'ai') return <StatusPill status="completed" label="AI Completed" />
  return <StatusPill status={iv.status} label={iv.status === 'no_show' ? 'No Show' : undefined} />
}

/** All Scheduled Interviews — filters (job, round, interviewer, status, kind, date range) + search + pagination. */
function InterviewsTable({ items, rounds, act, title = 'All Scheduled Interviews', initialStatus = '', withRange, pageSize = 5 }) {
  const [q, setQ] = useState('')
  const [job, setJob] = useState('')
  const [round, setRound] = useState('')
  const [who, setWho] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [kind, setKind] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })
  const jobs = useMemo(() => [...new Set(items.map((i) => i.job_title).filter(Boolean))].sort(), [items])
  const roundNames = useMemo(() => [...new Set([...rounds.map((r) => r.name), ...items.map((i) => i.round_name)])], [items, rounds])
  const people = useMemo(() => [...new Set(items.filter((i) => i.kind === 'human').flatMap((i) => (i.interviewers || '').split(',').map((s) => s.trim()).filter(Boolean)))].sort(), [items])
  const now = new Date().toISOString()
  const rows = items.filter((i) => {
    if (job && i.job_title !== job) return false
    if (round && i.round_name !== round) return false
    if (who && !(i.interviewers || '').toLowerCase().includes(who.toLowerCase())) return false
    if (kind && i.kind !== kind) return false
    if (status === 'upcoming' && !(i.status === 'scheduled' && i.starts_at >= now)) return false
    if (status === 'pending_feedback' && !i.pending_feedback) return false
    if (status && !['upcoming', 'pending_feedback'].includes(status) && i.status !== status) return false
    if (range.start && dayKey(i.starts_at) < range.start) return false
    if (range.end && dayKey(i.starts_at) > range.end) return false
    if (q && !`${i.candidate_name} ${i.job_title} ${i.interviewers} ${i.round_name}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const pg = usePagination(rows, pageSize)
  const cols = [
    { key: 'starts_at', header: 'Date & Time', sortable: true, render: (i) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDT(i.starts_at)}</span> },
    { key: 'candidate_name', header: 'Candidate', sortable: true, render: (i) => <span className="hr-cand"><Avatar name={i.candidate_name} src={i.candidate_avatar} size={30} /><strong>{i.candidate_name}</strong></span> },
    { key: 'job_title', header: 'Job Role', sortable: true, render: (i) => <span className="hr-wrap2 cl-muted">{i.job_title}</span> },
    { key: 'round_name', header: 'Round', sortable: true, render: (i) => (i.kind === 'ai'
      ? <span className="cl-row" style={{ gap: 6 }}><Bot size={15} color="#be185d" /> AI <span className="hr-score">{i.eval_score ?? '—'}</span></span>
      : <span className="cl-row" style={{ gap: 6, whiteSpace: 'nowrap' }}><i style={{ width: 8, height: 8, borderRadius: 9, background: roundColor(i.round_name, rounds), flex: '0 0 auto' }} />{i.round_name}</span>) },
    { key: 'interviewers', header: 'Interviewers', render: (i) => <span className="hr-wrap2 cl-muted">{i.interviewers || '—'}</span>, hideOnMobile: true },
    { key: 'mode', header: 'Mode', render: (i) => <ModeBadge mode={i.mode} /> },
    { key: 'status', header: 'Status', sortable: true, render: statusOf },
    { key: 'actions', header: 'Actions', align: 'right', render: (i) => <span className="cl-row" style={{ justifyContent: 'flex-end', gap: 4 }}><JoinOrView iv={i} act={act} /><Menu items={interviewActions(i, act)} label={`Actions for ${i.candidate_name}`} /></span> },
  ]
  return (
    <Card title={title} action={<span className="hr-small">{rows.length} of {items.length}</span>}>
      <div className="cl-filters" style={{ marginBottom: 12 }}>
        <div style={{ flex: '2 1 240px' }}><Input icon={Search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by candidate name, job, or interviewer…" aria-label="Search interviews" /></div>
        <Select value={job} onChange={(e) => setJob(e.target.value)} options={jobs} placeholder="All Jobs" aria-label="Filter by job" />
        <Select value={round} onChange={(e) => setRound(e.target.value)} options={roundNames} placeholder="All Rounds" aria-label="Filter by round" />
        <Select value={who} onChange={(e) => setWho(e.target.value)} options={people} placeholder="All Interviewers" aria-label="Filter by interviewer" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTS} placeholder="All Status" aria-label="Filter by status" />
        {withRange && <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTS} placeholder="All types" aria-label="Filter by interview type" />}
        {withRange && <DateRangePicker value={range} onChange={setRange} allowClear align="right" presets={[
          { label: 'Next 7 days', range: () => ({ start: todayKey(), end: dayKey(Date.now() + 6 * 864e5) }) },
          { label: 'This month', range: () => { const d = new Date(); return { start: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), end: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) } } },
          { label: 'Last 30 days', range: () => ({ start: dayKey(Date.now() - 29 * 864e5), end: todayKey() }) },
        ]} />}
      </div>
      <DataTable columns={cols} rows={pg.slice} rowKey={(r) => r.id} initialSort={{ key: 'starts_at', dir: 'asc' }}
        empty={<EmptyState icon={CalendarDays} title="No interviews match" text="Try clearing a filter." />} />
      <Pagination {...pg} noun="interviews" />
    </Card>
  )
}

export default function Interviews() {
  const api = useApi('recruiter')
  const toast = useToast()
  const { company, setCompany } = useRecruiter() || {}
  const [params, setParams] = useSearchParams()
  const list = useQuery(() => api.get(`${H}/interviews?limit=500`), [api])
  const stats = useQuery(() => api.get(`${H}/interviews/stats`), [api])
  const rounds = company?.rounds?.length ? company.rounds : FALLBACK_ROUNDS
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'calendar'
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('status'); return n }, { replace: true })
  const [view, setView] = useState('month')
  const [selDay, setSelDay] = useState(todayKey())
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [dlg, setDlg] = useState({})
  const [scheduleFor, setScheduleFor] = useState(null)
  const [exporting, setExporting] = useState(false)
  const items = list.data?.items || []
  const reload = useCallback(() => { list.reload(); stats.reload() }, [list, stats])

  const act = useCallback(async (kind, iv) => {
    if (kind === 'complete') {
      try {
        await api.patch(`${H}/interviews/${iv.id}`, { status: 'completed' })
        toast('Marked as completed — add feedback when ready', 'success')
        reload()
        setDlg({ feedback: { ...iv, status: 'completed' } })
      } catch (e) { toast(e.message, 'error') }
      return
    }
    setDlg({ [kind]: iv })
  }, [api, toast, reload])

  async function exportIcs() {
    setExporting(true)
    try {
      const res = await api.request('GET', `${H}/interviews/export.ics`, undefined, { raw: true })
      await downloadResponse(res, 'corelink-interviews.ics')
      toast('Calendar file downloaded — import it into Google Calendar or Outlook', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }
  async function saveRounds(r) {
    const c = await api.put(`${H}/company`, { preferences: { rounds: r } })
    setCompany?.(c)
    toast('Interview templates saved', 'success')
  }

  const k = stats.data?.kpis
  const an = stats.data?.analytics
  const nowIso = new Date().toISOString()
  const upcoming = items.filter((i) => i.kind === 'human' && i.status === 'scheduled' && i.starts_at >= nowIso).slice(0, 5)
  const donut = an ? [
    { label: 'Completed', value: an.completed, color: '#10b981' },
    { label: 'Scheduled', value: an.scheduled, color: '#2563eb' },
    { label: 'Pending Feedback', value: an.pending_feedback, color: '#f59e0b' },
    { label: 'Cancelled', value: an.cancelled, color: '#ef4444' },
  ] : []
  const donutTotal = donut.reduce((a, s) => a + s.value, 0)

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle="Schedule, manage and track interviews across all job roles. Conduct technical, HR and project interviews."
        actions={<>
          <Button variant="outline" icon={LayoutTemplate} onClick={() => setDlg({ templates: true })}>Interview Templates</Button>
          <Button variant="outline" icon={Download} loading={exporting} onClick={exportIcs} title="Download an .ics file of all upcoming interviews">Export to calendar (.ics)</Button>
          <Button icon={CalendarPlus} onClick={() => setDlg({ pick: true })}>Schedule Interview</Button>
        </>}
      />

      <div className="cl-grid-main">
        <div className="cl-stack">
          <div className="hr-kpis">
            {stats.loading && !k ? Array.from({ length: 4 }, (_, i) => <div key={i} className="cl-card"><Skeleton h={58} /></div>) : <>
              <StatTile icon={CalendarDays} tone="" value={k?.scheduled.value} label="Interviews Scheduled" delta={k?.scheduled.delta} />
              <StatTile icon={UserCheck} tone="green" value={k?.completed.value} label="Interviews Completed" delta={k?.completed.delta} />
              <StatTile icon={Clock} tone="red" value={k?.pending_feedback.value} label="Pending Feedback" delta={k?.pending_feedback.delta} />
              <StatTile icon={ClipboardCheck} tone="green" value={k?.selected.value} label="Selected / Offered" delta={k?.selected.delta} />
            </>}
          </div>
          {stats.error && <Alert tone="error">{stats.error.message}</Alert>}

          <section className="cl-card hr-card-tabs">
            <Tabs tabs={TABS} value={tab} onChange={setTab} />
            {list.error ? <div style={{ padding: 16 }}><Alert tone="error">{list.error.message} <button className="cl-link" onClick={list.reload}>Retry</button></Alert></div>
              : list.loading && !list.data ? <div style={{ padding: 16 }} className="cl-col"><Skeleton h={300} /></div>
              : tab === 'calendar' ? <InterviewsCalendar items={items} rounds={rounds} view={view} setView={setView} selDay={selDay} setSelDay={setSelDay} cursor={cursor} setCursor={setCursor} act={act} />
              : tab === 'rounds' ? <RoundsTab items={items} rounds={rounds} onManage={() => setDlg({ templates: true })} />
              : tab === 'feedback' ? <FeedbackTab items={items} act={act} />
              : null}
          </section>

          {(tab === 'calendar' || tab === 'list') && !list.error && (
            <InterviewsTable key={`${tab}-${params.get('status') || ''}`} items={items} rounds={rounds} act={act}
              title={tab === 'list' ? 'Interview List' : 'All Scheduled Interviews'}
              initialStatus={params.get('status') || (tab === 'calendar' ? '' : '')}
              withRange={tab === 'list'} pageSize={tab === 'list' ? 10 : 5} />
          )}
        </div>

        <aside className="cl-stack">
          <Card title="Upcoming Interviews" action={<ViewAll onClick={() => setParams({ tab: 'list', status: 'upcoming' }, { replace: true })} />}>
            {list.loading && !list.data ? <Skeleton h={200} /> : upcoming.length === 0
              ? <EmptyState icon={CalendarCheck} title="Nothing scheduled" text="Upcoming interviews appear here." />
              : upcoming.map((iv) => (
                <button key={iv.id} type="button" className="hr-upcoming" onClick={() => act('details', iv)} style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--cl-line-2)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
                  <span className="hr-datetile"><b>{new Date(iv.starts_at).getDate()}</b><span>{fmtD(iv.starts_at, { month: 'short' })}</span></span>
                  <span className="meta"><strong>{iv.candidate_name}</strong><span className="cl-ellipsis" style={{ display: 'block' }}>{iv.job_title}</span>{iv.round_name}</span>
                  <span className="right">{fmtT(iv.starts_at)}<ModeBadge mode={iv.mode} /></span>
                </button>
              ))}
          </Card>

          <Card title="Interview Rounds" action={<ViewAll onClick={() => setDlg({ templates: true })}>Manage Rounds</ViewAll>}>
            {rounds.map((r, i) => {
              const c = roundColor(r.name, rounds)
              return (
                <div className="hr-round" key={r.name}>
                  <span className="hr-round-num" style={{ background: `${c}1a`, color: c }}>{i + 1}</span>
                  <span className="txt"><strong>{r.name}</strong>{r.description}</span>
                  <span className="dur"><Clock size={14} />{r.duration_min} mins</span>
                </div>
              )
            })}
          </Card>

          <Card title="Interview Analytics" action={<ViewAll onClick={() => setTab('feedback')} />}>
            {!an ? <Skeleton h={150} /> : (
              <div className="hr-donut-row">
                <Donut segments={donut} size={136} stroke={18} center={an.total} sub="Total Interviews" />
                <Legend items={donut.map((s) => ({ ...s, value: s.value }))} showPct total={donutTotal} />
              </div>
            )}
            {an?.ai_completed > 0 && <p className="hr-small" style={{ marginTop: 10 }}>Includes {an.ai_completed} completed AI interview{an.ai_completed > 1 ? 's' : ''}.</p>}
          </Card>
        </aside>
      </div>

      <InterviewsPickModal open={!!dlg.pick} onClose={() => setDlg({})} onPick={(apps) => { setDlg({}); setScheduleFor(apps) }} />
      <ScheduleInterviewModal open={!!scheduleFor} applications={scheduleFor || []} onClose={() => setScheduleFor(null)} onScheduled={reload} />
      <InterviewsTemplatesModal open={!!dlg.templates} onClose={() => setDlg({})} rounds={rounds} onSave={saveRounds} />
      <InterviewsEditModal iv={dlg.reschedule} rounds={rounds} onClose={() => setDlg({})} onSaved={reload} />
      <InterviewsFeedbackModal iv={dlg.feedback} onClose={() => setDlg({})} onSaved={reload} />
      <InterviewsCancelModal iv={dlg.cancel} onClose={() => setDlg({})} onDone={reload} />
      <InterviewsDetailsModal iv={dlg.details} rounds={rounds} onClose={() => setDlg({})} onAction={(kind, iv) => act(kind, iv)} />
    </>
  )
}

function RoundsTab({ items, rounds, onManage }) {
  const used = [...new Set(items.filter((i) => i.kind === 'human').map((i) => i.round_name))].filter((n) => !rounds.some((r) => r.name === n))
  const all = [...rounds, ...used.map((n) => ({ name: n, duration_min: null, description: 'Used in scheduled interviews (not a template)' }))]
  const ai = items.filter((i) => i.kind === 'ai')
  const aiScores = ai.map((i) => i.eval_score).filter((x) => x != null)
  return (
    <div style={{ padding: 16 }} className="cl-col">
      <div className="cl-row" style={{ justifyContent: 'space-between' }}>
        <p className="hr-sub">Rounds in your hiring process and how many interviews each has.</p>
        <Button size="sm" variant="outline" icon={LayoutTemplate} onClick={onManage}>Manage templates</Button>
      </div>
      <div className="cl-grid cl-grid-2">
        {all.map((r, i) => {
          const mine = items.filter((x) => x.kind === 'human' && x.round_name === r.name)
          const c = roundColor(r.name, rounds)
          return (
            <div key={r.name} className="hr-fb" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <span className="hr-round-num" style={{ background: `${c}1a`, color: c }}>{i + 1}</span>
              <div className="cl-grow">
                <strong className="hr-ink">{r.name}</strong>
                <div className="hr-small">{r.description}{r.duration_min ? ` · ${r.duration_min} min` : ''}</div>
                <div className="cl-row cl-wrap" style={{ gap: 6, marginTop: 6 }}>
                  <Badge tone="blue">{mine.filter((x) => x.status === 'scheduled').length} scheduled</Badge>
                  <Badge tone="green">{mine.filter((x) => x.status === 'completed').length} completed</Badge>
                  {mine.some((x) => x.pending_feedback) && <Badge tone="amber">{mine.filter((x) => x.pending_feedback).length} feedback due</Badge>}
                </div>
              </div>
            </div>
          )
        })}
        <div className="hr-fb" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <span className="hr-round-num" style={{ background: '#fdf2f8', color: '#be185d' }}><Bot size={17} /></span>
          <div className="cl-grow">
            <strong className="hr-ink">AI Interview</strong>
            <div className="hr-small">Automated video interview run by CoreLink (read-only)</div>
            <div className="cl-row cl-wrap" style={{ gap: 6, marginTop: 6 }}>
              <Badge tone="green">{ai.length} completed</Badge>
              {aiScores.length > 0 && <span className="hr-score">avg {Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length)}/100</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedbackTab({ items, act }) {
  const now = Date.now()
  const due = items.filter((i) => i.kind === 'human' && (i.pending_feedback || (i.status === 'scheduled' && new Date(i.ends_at).getTime() < now)))
  const done = items.filter((i) => i.kind === 'human' && i.feedback).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  const ai = items.filter((i) => i.kind === 'ai')
  return (
    <div style={{ padding: 16 }} className="cl-col" >
      <h4 className="hr-section-title" style={{ fontSize: 15 }}>Awaiting feedback ({due.length})</h4>
      {due.length === 0 ? <p className="hr-sub">All caught up — every finished interview has feedback.</p> : due.map((iv) => (
        <div key={iv.id} className="cl-list-item" style={{ flexWrap: 'wrap' }}>
          <Avatar name={iv.candidate_name} src={iv.candidate_avatar} size={36} />
          <div className="cl-grow"><strong className="hr-ink">{iv.candidate_name}</strong><div className="hr-small">{iv.round_name} · {iv.job_title} · {fmtDT(iv.starts_at)}</div></div>
          {iv.status === 'scheduled' ? <Badge tone="amber">Not marked completed</Badge> : <Badge tone="amber" dot>Pending feedback</Badge>}
          <Button size="sm" icon={MessageSquare} onClick={() => act('feedback', iv)}>Add feedback</Button>
        </div>
      ))}
      <h4 className="hr-section-title" style={{ fontSize: 15, marginTop: 10 }}>Submitted feedback ({done.length})</h4>
      {done.length === 0 ? <p className="hr-sub">No feedback recorded yet.</p> : (
        <div className="cl-grid cl-grid-2">
          {done.map((iv) => (
            <div key={iv.id} className="hr-fb">
              <div className="cl-row"><Avatar name={iv.candidate_name} src={iv.candidate_avatar} size={32} /><div className="cl-grow"><strong className="hr-ink">{iv.candidate_name}</strong><div className="hr-small">{iv.round_name} · {fmtD(iv.starts_at)}</div></div><Badge tone={REC_TONE[iv.feedback.recommendation]}>{REC_LABEL[iv.feedback.recommendation]}</Badge></div>
              <Stars value={iv.feedback.rating} size={16} />
              {iv.feedback.notes && <p className="hr-sub" style={{ whiteSpace: 'pre-wrap', color: 'var(--cl-text)' }}>{iv.feedback.notes.length > 220 ? `${iv.feedback.notes.slice(0, 220)}…` : iv.feedback.notes}</p>}
              <div className="cl-row" style={{ justifyContent: 'space-between' }}><span className="hr-small">by {iv.feedback.by}</span><button className="cl-link" onClick={() => act('feedback', iv)}>Edit</button></div>
            </div>
          ))}
        </div>
      )}
      <h4 className="hr-section-title" style={{ fontSize: 15, marginTop: 10 }}>AI interview evaluations ({ai.length})</h4>
      {ai.length === 0 ? <p className="hr-sub">No AI interviews completed yet.</p> : ai.map((iv) => (
        <div key={iv.id} className="cl-list-item">
          <Avatar name={iv.candidate_name} src={iv.candidate_avatar} size={36} />
          <div className="cl-grow"><strong className="hr-ink">{iv.candidate_name}</strong><div className="hr-small">{iv.job_title} · completed {fmtD(iv.starts_at)}</div></div>
          <span className="hr-score"><Bot size={13} /> {iv.eval_score ?? '—'}/100</span>
          <Button size="sm" variant="outline" icon={CheckCircle2} onClick={() => act('details', iv)}>View</Button>
        </div>
      ))}
    </div>
  )
}
