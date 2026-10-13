import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, Bookmark, CalendarCheck, CalendarDays, Download, Handshake, Lightbulb, Mail, Scale, SlidersHorizontal, UserCheck,
} from 'lucide-react'
import {
  Alert, Avatar, Button, Card, DataTable, EmptyState, Field, Input, PageHeader, Pagination, SearchInput, Select, Skeleton, ViewAll,
  fmtDate, fmtTime, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import ScheduleInterviewModal from './components/ScheduleInterviewModal.jsx'
import DashboardSchedulePicker from './components/DashboardSchedulePicker.jsx'
import CandidateCompareModal from './components/CandidateCompareModal.jsx'
import {
  API, AiResultModal, BRANCH_OPTIONS, BranchBadge, EXPERIENCE, EmailModal, InterviewPill, Kpi, MatchPill, PipelineBars, RejectModal, VerifiedTick,
  exportApplications, useAppActions,
} from './components/RecruiterPipelineKit.jsx'
import { AppRowMenu, qs, toSchedule, useDebounced, useUrlFilters } from './components/RecruiterListKit.jsx'

const IV_OPTIONS = [
  { value: 'interview_scheduled', label: 'Interview Scheduled' }, { value: 'interview_completed', label: 'Interview Completed' }, { value: 'under_review', label: 'Under Review' },
]
const SORTS = [
  { value: 'match', label: 'Match Score (High to Low)' }, { value: 'match_asc', label: 'Match Score (Low to High)' },
  { value: 'newest', label: 'Applied (Newest)' }, { value: 'oldest', label: 'Applied (Oldest)' }, { value: 'cgpa', label: 'CGPA (High to Low)' }, { value: 'name', label: 'Name (A–Z)' },
]
const PIPE_COLORS = { shortlisted: 'var(--cl-blue)', interview_scheduled: '#3b82f6', interview_completed: '#5b8def', hr_round: '#5b8def', offer: '#f97316', hired: '#10b981' }
const DEFAULTS = { job: '', branch: '', location: '', experience: '', interview_status: '', q: '', min_match: '', min_cgpa: '', sort: 'match', page: '1', size: '10' }

function NextStep({ n }) {
  if (!n) return <span className="cl-muted">--</span>
  if (n.starts_at) return <div className="rp-next">{n.round_name}<small>{fmtDate(n.starts_at)} · {fmtTime(n.starts_at)}</small></div>
  return <div className="rp-next">{n.label}</div>
}

export default function Shortlisted() {
  const api = useApi('recruiter')
  const toast = useToast()
  const navigate = useNavigate()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const [qInput, setQInput] = useState(f.q)
  const q = useDebounced(qInput, 300)
  useEffect(() => { if (q !== f.q) setF({ q }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState(Boolean(f.min_match || f.min_cgpa))

  const listQs = qs({ ...f, size: undefined, page_size: f.size })
  const { data, loading, error, reload } = useQuery(() => api.get(`${API}/shortlisted?${listQs}`), [api, listQs])
  const items = data?.items || []

  const [sel, setSel] = useState(() => new Map())
  const [schedule, setSchedule] = useState(null)
  const [picker, setPicker] = useState(null) // options[]
  const [compare, setCompare] = useState(null)
  const [email, setEmail] = useState(null)
  const [reject, setReject] = useState(null)
  const [ai, setAi] = useState(null)
  const [exporting, setExporting] = useState(false)
  const actions = useAppActions(api, () => reload())

  const selKeys = useMemo(() => new Set(sel.keys()), [sel])
  const onSelect = (keys) => setSel((m) => { const n = new Map(); keys.forEach((k) => n.set(k, m.get(k) || items.find((r) => r.application_id === k))); return n })
  const selRows = [...sel.values()].filter(Boolean)
  const clearSel = () => setSel(new Map())
  const candIds = [...new Set(selRows.map((r) => r.candidate_id))]

  const fetchAll = () => api.get(`${API}/shortlisted?${qs({ ...f, size: undefined, page: 1, page_size: 500 })}`)

  async function scheduleInterviews() {
    if (selRows.length) {
      const ok = toSchedule(selRows)
      return ok.length ? setSchedule(ok) : toast('Hired candidates don’t need another interview', 'info')
    }
    try {
      const all = await fetchAll()
      const opts = toSchedule(all.items.filter((r) => r.stage !== 'offer'))
      if (!opts.length) return toast('No shortlisted candidates to schedule', 'info')
      setPicker(opts)
    } catch (e) { toast(e.message, 'error') }
  }
  function openCompare() {
    if (candIds.length < 2) return toast('Tick 2–3 candidates in the table to compare', 'info')
    if (candIds.length > 3) toast('Comparing the first 3 selected candidates', 'info')
    setCompare(candIds.slice(0, 3))
  }
  async function exportList() {
    setExporting(true)
    try {
      const rows = selRows.length ? selRows : (await fetchAll()).items
      if (!rows.length) return toast('Nothing to export', 'info')
      exportApplications(rows, `shortlisted-${new Date().toISOString().slice(0, 10)}.csv`)
      toast(`Exported ${rows.length} shortlisted candidate${rows.length === 1 ? '' : 's'}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }
  async function moveNext() {
    if (!selRows.length) return toast('Select candidates in the table first', 'info')
    if (await actions.bulk(selRows.map((r) => r.application_id), 'next_stage')) clearSel()
  }
  function invite() {
    if (!selRows.length) return toast('Select candidates in the table first', 'info')
    setEmail(selRows)
  }

  const rowOn = {
    profile: (r) => navigate(`/recruiter/candidates?id=${r.candidate_id}`),
    schedule: (r) => setSchedule(toSchedule([r])),
    next: (r) => actions.nextStage(r.application_id),
    unlock: (r) => actions.unlock(r),
    aiResult: (r) => setAi(r.application_id),
    offer: true,
    email: (r) => setEmail([r]),
    unshortlist: (r) => actions.bulk([r.application_id], 'unshortlist'),
    reject: (r) => setReject([r]),
  }
  const columns = [
    { key: 'candidate_name', header: 'Candidate', render: (r) => (
      <button type="button" className="rp-person rp-linkish" onClick={() => rowOn.profile(r)}>
        <Avatar name={r.candidate_name} src={r.avatar_path} size={32} />
        <span style={{ minWidth: 0 }}><strong>{r.candidate_name}<VerifiedTick show={r.verified} size={13} /></strong><small>CGPA: {r.cgpa ?? '—'}</small></span>
      </button>
    ) },
    { key: 'job_title', header: 'Job Role', render: (r) => <span className="rp-wrap-cell" style={{ display: 'block' }} title={r.job_code}>{r.job_title}</span> },
    { key: 'branch', header: 'Branch', render: (r) => <BranchBadge branch={r.branch} /> },
    { key: 'college', header: 'College', render: (r) => <span className="rp-wrap-cell" style={{ display: 'block' }}>{r.college || '—'}</span> },
    { key: 'match', header: 'Match', render: (r) => <MatchPill value={r.match} /> },
    { key: 'interview_state', header: 'Interview Status', render: (r) => <span className="rp-iv-pill">{r.stage === 'offer' || r.stage === 'hired' ? <InterviewPill state="interview_completed" /> : <InterviewPill state={r.interview_state} />}</span> },
    { key: 'next', header: 'Next Step', render: (r) => (r.stage === 'hired' ? <div className="rp-next">Hired</div> : r.stage === 'offer' ? <div className="rp-next">Offer {r.offer_status || 'made'}</div> : <NextStep n={r.next_step} />) },
    { key: 'actions', header: 'Actions', render: (r) => <div className="rp-actcell"><Button size="sm" variant="outline" onClick={() => rowOn.profile(r)}>View Profile</Button><AppRowMenu row={r} on={rowOn} /></div> },
  ]

  const k = data?.kpis
  const kl = loading && !data
  const anyFilter = ['job', 'branch', 'location', 'experience', 'interview_status', 'q', 'min_match', 'min_cgpa'].some((x) => f[x])
  const insights = data?.insights || []

  return (
    <div className="rp-page">
      <PageHeader
        title="Shortlisted Candidates"
        subtitle="Manage shortlisted candidates, review their profiles, schedule interviews and move them through the hiring process."
        actions={<>
          <Button variant="outline" icon={Scale} onClick={openCompare}>Compare Candidates ({Math.min(candIds.length, 3)})</Button>
          <Button variant="outline" icon={Download} loading={exporting} onClick={exportList}>{selRows.length ? `Export Selected (${selRows.length})` : 'Export List'}</Button>
          <Button icon={CalendarDays} onClick={scheduleInterviews}>Schedule Interviews</Button>
        </>}
      />
      <div className="cl-grid-main">
        <div className="cl-stack" style={{ minWidth: 0 }}>
          <div className="cl-grid rp-kpis four">
            <Kpi loading={kl} icon={Bookmark} tone="green" label="Shortlisted Candidates" kpi={k?.shortlisted} />
            <Kpi loading={kl} icon={CalendarCheck} label="Interviews Scheduled" kpi={k?.interviews_scheduled} />
            <Kpi loading={kl} icon={Handshake} tone="purple" label="Offers Made" kpi={k?.offers} />
            <Kpi loading={kl} icon={UserCheck} tone="orange" label="Hired" kpi={k?.hired} />
          </div>

          <Card className="rp-table-card rp-compact">
            <div className="rp-filterbar five">
              <Select aria-label="Job" value={f.job} onChange={(e) => setF({ job: e.target.value })} placeholder="All Jobs" options={(data?.jobs || []).map((j) => ({ value: String(j.id), label: j.title }))} />
              <Select aria-label="Branch" value={f.branch} onChange={(e) => setF({ branch: e.target.value })} placeholder="All Branches" options={BRANCH_OPTIONS} />
              <Select aria-label="Location" value={f.location} onChange={(e) => setF({ location: e.target.value })} placeholder="All Locations" options={data?.locations || []} />
              <Select aria-label="Experience level" value={f.experience} onChange={(e) => setF({ experience: e.target.value })} placeholder="All Experience Levels" options={EXPERIENCE} />
              <Select aria-label="Interview status" value={f.interview_status} onChange={(e) => setF({ interview_status: e.target.value })} placeholder="All Interview Status" options={IV_OPTIONS} />
            </div>
            <div className="rp-filterbar-2">
              <div className="rp-search"><SearchInput value={qInput} onChange={setQInput} placeholder="Search by name, skills, or keywords…" /></div>
              <Button variant="outline" icon={SlidersHorizontal} aria-expanded={more} onClick={() => setMore((m) => !m)}>More Filters{f.min_match || f.min_cgpa ? ' •' : ''}</Button>
              {anyFilter && <button type="button" className="cl-link" onClick={() => { setQInput(''); setF(Object.fromEntries(['job', 'branch', 'location', 'experience', 'interview_status', 'q', 'min_match', 'min_cgpa'].map((x) => [x, '']))) }}>Clear all</button>}
              <label className="rp-sort">Sort by: <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={SORTS} /></label>
            </div>
            {more && (
              <div className="rp-morefilters">
                <Field label="Minimum match %"><Input type="number" min={0} max={100} value={f.min_match} placeholder="e.g. 70" onChange={(e) => setF({ min_match: e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))) })} /></Field>
                <Field label="Minimum CGPA"><Input type="number" min={0} max={10} step="0.1" value={f.min_cgpa} placeholder="e.g. 7.5" onChange={(e) => setF({ min_cgpa: e.target.value === '' ? '' : Math.max(0, Math.min(10, Number(e.target.value))) })} /></Field>
                <div className="cl-row" style={{ alignItems: 'flex-end' }}><Button variant="ghost" onClick={() => setF({ min_match: '', min_cgpa: '' })}>Reset</Button></div>
              </div>
            )}

            {error && <div style={{ marginTop: 12 }}><Alert tone="error">{error.message} <button className="cl-link" onClick={reload}>Retry</button></Alert></div>}
            <div style={{ marginTop: 14 }}>
              {selRows.length > 0 && (
                <div className="rp-bulkbar" role="region" aria-label="Bulk actions">
                  <strong>{selRows.length} selected</strong>
                  <Button size="sm" variant="outline" icon={CalendarDays} onClick={scheduleInterviews}>Schedule</Button>
                  <Button size="sm" variant="outline" icon={ArrowRight} loading={actions.busy} onClick={moveNext}>Next stage</Button>
                  <Button size="sm" variant="outline" icon={Mail} onClick={invite}>Email</Button>
                  <Button size="sm" variant="ghost" onClick={clearSel}>Clear</Button>
                </div>
              )}
              <DataTable columns={columns} rows={items} rowKey={(r) => r.application_id} loading={kl} selectable selected={selKeys} onSelect={onSelect}
                empty={<EmptyState icon={Bookmark} title={anyFilter ? 'No shortlisted candidates match' : 'No shortlisted candidates yet'}
                  text={anyFilter ? 'Clear a filter to see more.' : 'Shortlist applicants from Applications or Candidate Management.'}
                  action={!anyFilter && <Button size="sm" variant="outline" to="/recruiter/applications?status=under_review">Review applications</Button>} />} />
              {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={Number(f.size)} setPage={(p) => setF({ page: String(p) })}
                setPageSize={(n) => setF({ size: String(n) })} noun="shortlisted candidates" />}
            </div>
          </Card>
        </div>

        <div className="cl-stack">
          <Card title="Shortlist Pipeline" action={<ViewAll to="/recruiter/analytics" />}>
            {kl ? <Skeleton h={150} /> : data?.pipeline?.[0]?.count ? <PipelineBars rows={data.pipeline} colors={PIPE_COLORS} /> : <p className="cl-muted">No shortlisted candidates yet.</p>}
          </Card>

          <Card title="Upcoming Interviews" action={<ViewAll to="/recruiter/interviews" />}>
            {kl ? <Skeleton h={150} /> : data?.upcoming?.length ? (
              <div className="cl-list rp-upcoming">
                {data.upcoming.slice(0, 5).map((s) => (
                  <button type="button" key={s.id} className="cl-list-item rp-list-btn" onClick={() => navigate(`/recruiter/candidates?id=${s.candidate_id}`)} title={`${s.round_name} · ${s.mode}`}>
                    <span className="cl-ico"><CalendarDays size={18} /></span>
                    <div className="cl-grow" style={{ minWidth: 0 }}><strong>{s.candidate_name}</strong><small className="cl-ellipsis">{s.job_title} · {s.round_name}</small></div>
                    <time>{fmtDate(s.starts_at)}<br />{fmtTime(s.starts_at)}</time>
                  </button>
                ))}
              </div>
            ) : <EmptyState icon={CalendarDays} title="Nothing scheduled" text="Schedule interviews for your shortlist." />}
          </Card>

          <Card title="Quick Actions" subtitle={selRows.length ? `${selRows.length} selected` : 'Tick candidates in the table first'}>
            <div className="rp-btn-grid">
              <Button variant="outline" icon={CalendarDays} onClick={scheduleInterviews}>Schedule Interviews</Button>
              <Button variant="outline" icon={Mail} disabled={!selRows.length} onClick={invite}>Send Invitations</Button>
              <Button variant="outline" icon={Scale} disabled={candIds.length < 2} onClick={openCompare}>Compare Candidates</Button>
              <Button variant="outline" icon={ArrowRight} disabled={!selRows.length} loading={actions.busy} onClick={moveNext}>Move to Next Stage</Button>
            </div>
          </Card>

          <Card title="Selection Insights" action={insights.length > 1 ? <ViewAll to="/recruiter/analytics" /> : null} className="rp-insight-card">
            {kl ? <Skeleton h={120} /> : insights.slice(0, 3).map((i) => (
              <div className="rp-insight" key={i.title}>
                <Lightbulb size={18} />
                <div><strong>{i.title}</strong><p>{i.text}</p></div>
              </div>
            ))}
            {!kl && insights.length > 0 && <p className="cl-faint" style={{ fontSize: 11.5, marginTop: 6 }}>Computed from your own applicants and shortlist.</p>}
          </Card>
        </div>
      </div>

      <ScheduleInterviewModal open={!!schedule} onClose={() => setSchedule(null)} applications={schedule || []} onScheduled={() => { reload(); clearSel() }} />
      <DashboardSchedulePicker open={!!picker} onClose={() => setPicker(null)} options={picker || []} onScheduled={() => reload()} />
      <CandidateCompareModal open={!!compare} onClose={() => setCompare(null)} api={api} candidateIds={compare || []} onView={(id) => navigate(`/recruiter/candidates?id=${id}`)} />
      <EmailModal open={!!email} onClose={() => setEmail(null)} count={email?.length || 0} busy={actions.busy} defaultSubject="Interview invitation"
        onSend={(m) => actions.bulk(email.map((x) => x.application_id), 'email', m)} />
      <RejectModal open={!!reject} onClose={() => setReject(null)} count={reject?.length || 0} names={reject?.[0]?.candidate_name} busy={actions.busy}
        onConfirm={async (reason) => { if (await actions.bulk(reject.map((x) => x.application_id), 'reject', { reason: reason || null })) setReject(null) }} />
      <AiResultModal open={!!ai} onClose={() => setAi(null)} api={api} applicationId={ai} />
    </div>
  )
}
