import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bookmark, Briefcase, Building2, CalendarCheck, CalendarDays, Clock, Download, FileText, Handshake, Mail, MapPin, SlidersHorizontal, UserCheck, XCircle,
} from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Skeleton, Tabs, ViewAll,
  fmtDate, timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import ScheduleInterviewModal from './components/ScheduleInterviewModal.jsx'
import {
  API, AiResultModal, BRANCH_OPTIONS, BranchBadge, EXPERIENCE, EmailModal, Kpi, MatchPill, PipelineBars, RejectModal, StagePill, VerifiedTick,
  branchMeta, exportApplications, jobTypeLabel, useAppActions,
} from './components/RecruiterPipelineKit.jsx'
import { AppRowMenu, DateRangeFilter, qs, toSchedule, useDebounced, useUrlFilters } from './components/RecruiterListKit.jsx'

const TABS = [
  { id: '', label: 'All Applications', key: 'all' }, { id: 'under_review', label: 'Under Review' }, { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'interview', label: 'Interview' }, { id: 'offer', label: 'Offer' }, { id: 'rejected', label: 'Rejected' },
]
const STATUS_OPTIONS = [
  { value: 'under_review', label: 'Under Review' }, { value: 'shortlisted', label: 'Shortlisted' }, { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer / Hired' }, { value: 'hired', label: 'Hired' }, { value: 'rejected', label: 'Rejected' },
]
const SORTS = [
  { value: 'newest', label: 'Application Date (Newest)' }, { value: 'oldest', label: 'Application Date (Oldest)' },
  { value: 'match', label: 'Match Score (High to Low)' }, { value: 'match_asc', label: 'Match Score (Low to High)' },
  { value: 'cgpa', label: 'CGPA (High to Low)' }, { value: 'name', label: 'Candidate Name (A–Z)' },
]
const DEFAULTS = { job: '', branch: '', location: '', status: '', experience: '', date_from: '', date_to: '', q: '', min_match: '', min_cgpa: '', sort: 'newest', page: '1', size: '10' }

export default function Applications() {
  const api = useApi('recruiter')
  const toast = useToast()
  const navigate = useNavigate()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const [qInput, setQInput] = useState(f.q)
  const q = useDebounced(qInput, 300)
  useEffect(() => { if (q !== f.q) setF({ q }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState(Boolean(f.min_match || f.min_cgpa))

  const listQs = qs({ ...f, size: undefined, page_size: f.size })
  const { data, loading, error, reload } = useQuery(() => api.get(`${API}/applications?${listQs}`), [api, listQs])
  const jobsQ = useQuery(() => api.get(`${API}/jobs`), [api])
  const items = data?.items || []

  const [sel, setSel] = useState(() => new Map()) // application_id -> row
  const [reject, setReject] = useState(null) // rows[]
  const [email, setEmail] = useState(null) // rows[]
  const [schedule, setSchedule] = useState(null)
  const [ai, setAi] = useState(null)
  const [jobModal, setJobModal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const actions = useAppActions(api, () => { reload(); jobsQ.reload() })

  // DataTable works with a Set of keys; keep the row objects so selection survives paging.
  const selKeys = useMemo(() => new Set(sel.keys()), [sel])
  const onSelect = (keys) => setSel((m) => {
    const n = new Map()
    keys.forEach((k) => n.set(k, m.get(k) || items.find((r) => r.application_id === k)))
    return n
  })
  const selRows = [...sel.values()].filter(Boolean)
  const clearSel = () => setSel(new Map())

  const jobs = jobsQ.data?.jobs || []
  const ovJob = useMemo(() => {
    if (f.job) return jobs.find((j) => String(j.id) === f.job)
    return [...jobs].filter((j) => j.status === 'open').sort((a, b) => b.applications - a.applications)[0] || jobs[0]
  }, [jobs, f.job])

  const need = (rows) => { if (!rows.length) { toast('Select applications in the table first', 'info'); return false } return true }
  const bulkShortlist = async (rows) => { if (need(rows) && await actions.bulk(rows.map((r) => r.application_id), 'shortlist')) clearSel() }
  const openSchedule = (rows) => {
    if (!need(rows)) return
    const ok = toSchedule(rows)
    if (!ok.length) return toast('Rejected or hired candidates can’t be scheduled', 'info')
    setSchedule(ok)
  }
  async function exportAll() {
    setExporting(true)
    try {
      if (selRows.length) { exportApplications(selRows, `applications-selected-${new Date().toISOString().slice(0, 10)}.csv`); toast(`Exported ${selRows.length} selected applications`, 'success'); return }
      const r = await api.get(`${API}/applications?${qs({ ...f, size: undefined, page: 1, page_size: 500 })}`)
      if (!r.items.length) return toast('No applications match these filters', 'info')
      exportApplications(r.items, `applications-${new Date().toISOString().slice(0, 10)}.csv`)
      toast(`Exported ${r.items.length} applications${r.total > r.items.length ? ` (first ${r.items.length} of ${r.total})` : ''}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }

  const rowOn = {
    profile: (r) => navigate(`/recruiter/candidates?id=${r.candidate_id}`),
    shortlist: (r) => actions.bulk([r.application_id], 'shortlist'),
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
    { key: 'job_title', header: 'Applied for', render: (r) => <span className="rp-wrap-cell" style={{ display: 'block' }} title={r.job_code}>{r.job_title}</span> },
    { key: 'branch', header: 'Branch', render: (r) => <BranchBadge branch={r.branch} /> },
    { key: 'college', header: 'College', render: (r) => <span className="rp-wrap-cell" style={{ display: 'block' }}>{r.college || '—'}</span> },
    { key: 'match', header: 'Match', render: (r) => <MatchPill value={r.match} /> },
    { key: 'stage', header: 'Status', render: (r) => <StagePill stage={r.stage} /> },
    { key: 'applied_at', header: 'Applied On', render: (r) => fmtDate(r.applied_at) },
    { key: 'actions', header: 'Actions', align: 'center', render: (r) => <AppRowMenu row={r} on={rowOn} /> },
  ]

  const k = data?.kpis
  const counts = data?.counts || {}
  const kl = loading && !data
  const anyFilter = ['job', 'branch', 'location', 'status', 'experience', 'date_from', 'date_to', 'q', 'min_match', 'min_cgpa'].some((x) => f[x])

  return (
    <div className="rp-page">
      <PageHeader
        title="Applications Management"
        subtitle="Review and manage applications for all your job postings. Filter, shortlist, schedule interviews and track progress."
        actions={<>
          <Button variant="outline" icon={Download} loading={exporting} onClick={exportAll}>{selRows.length ? `Export Selected (${selRows.length})` : 'Export Applications'}</Button>
          <Button icon={Briefcase} disabled={!ovJob} onClick={() => setJobModal(true)}>View Job Details</Button>
        </>}
      />
      <div className="cl-grid-main">
        <div className="cl-stack" style={{ minWidth: 0 }}>
          <div className="cl-grid rp-kpis">
            <Kpi loading={kl} icon={FileText} label="Total Applications" kpi={k?.applications} />
            <Kpi loading={kl} icon={Bookmark} tone="green" label="Shortlisted" kpi={k?.shortlisted} />
            <Kpi loading={kl} icon={CalendarCheck} tone="orange" label="Interviews Scheduled" kpi={k?.interviews_scheduled} />
            <Kpi loading={kl} icon={Handshake} tone="red" label="Offers Made" kpi={k?.offers} />
            <Kpi loading={kl} icon={UserCheck} tone="teal" label="Hired" kpi={k?.hired} />
          </div>

          <Card className="rp-table-card rp-compact">
            <div className="rp-filterbar">
              <Select aria-label="Job" value={f.job} onChange={(e) => { setF({ job: e.target.value }); clearSel() }} placeholder="All Jobs" options={(data?.jobs || jobs).map((j) => ({ value: String(j.id), label: j.title }))} />
              <Select aria-label="Branch" value={f.branch} onChange={(e) => setF({ branch: e.target.value })} placeholder="All Branches" options={BRANCH_OPTIONS} />
              <Select aria-label="Location" value={f.location} onChange={(e) => setF({ location: e.target.value })} placeholder="All Locations" options={data?.locations || []} />
              <Select aria-label="Application status" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="All Application Status" options={STATUS_OPTIONS} />
              <Select aria-label="Experience level" value={f.experience} onChange={(e) => setF({ experience: e.target.value })} placeholder="All Experience Levels" options={EXPERIENCE} />
              <DateRangeFilter from={f.date_from} to={f.date_to} onChange={(a, b) => setF({ date_from: a, date_to: b })} />
            </div>
            <div className="rp-filterbar-2">
              <div className="rp-search"><SearchInput value={qInput} onChange={setQInput} placeholder="Search by name, skills, or keywords…" /></div>
              <Button variant="outline" icon={SlidersHorizontal} aria-expanded={more} onClick={() => setMore((m) => !m)}>More Filters{f.min_match || f.min_cgpa ? ' •' : ''}</Button>
              {anyFilter && <button type="button" className="cl-link" onClick={() => { setQInput(''); setF(Object.fromEntries(Object.keys(DEFAULTS).filter((x) => !['sort', 'size'].includes(x)).map((x) => [x, '']))) }}>Clear all</button>}
              <label className="rp-sort">Sort by: <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={SORTS} /></label>
            </div>
            {more && (
              <div className="rp-morefilters">
                <Field label="Minimum match %"><Input type="number" min={0} max={100} value={f.min_match} placeholder="e.g. 70" onChange={(e) => setF({ min_match: e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))) })} /></Field>
                <Field label="Minimum CGPA"><Input type="number" min={0} max={10} step="0.1" value={f.min_cgpa} placeholder="e.g. 7.5" onChange={(e) => setF({ min_cgpa: e.target.value === '' ? '' : Math.max(0, Math.min(10, Number(e.target.value))) })} /></Field>
                <div className="cl-row" style={{ alignItems: 'flex-end' }}><Button variant="ghost" onClick={() => setF({ min_match: '', min_cgpa: '' })}>Reset</Button></div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <Tabs tabs={TABS.map((t) => ({ ...t, count: counts[t.key || t.id] ?? (data ? 0 : undefined) }))} value={['hired'].includes(f.status) ? 'offer' : f.status} onChange={(id) => { setF({ status: id }); clearSel() }} />
            </div>

            {error && <div style={{ marginTop: 12 }}><Alert tone="error">{error.message} <button className="cl-link" onClick={reload}>Retry</button></Alert></div>}
            <div style={{ marginTop: 12 }}>
              {selRows.length > 0 && (
                <div className="rp-bulkbar" role="region" aria-label="Bulk actions">
                  <strong>{selRows.length} selected</strong>
                  <Button size="sm" variant="outline" icon={Bookmark} loading={actions.busy} onClick={() => bulkShortlist(selRows)}>Shortlist</Button>
                  <Button size="sm" variant="outline" icon={XCircle} onClick={() => setReject(selRows)}>Reject</Button>
                  <Button size="sm" variant="outline" icon={CalendarDays} onClick={() => openSchedule(selRows)}>Schedule</Button>
                  <Button size="sm" variant="outline" icon={Mail} onClick={() => setEmail(selRows)}>Email</Button>
                  <Button size="sm" variant="ghost" onClick={clearSel}>Clear</Button>
                </div>
              )}
              <DataTable columns={columns} rows={items} rowKey={(r) => r.application_id} loading={kl} selectable selected={selKeys} onSelect={onSelect}
                empty={<EmptyState icon={FileText} title={anyFilter ? 'No applications match these filters' : 'No applications yet'}
                  text={anyFilter ? 'Clear a filter or pick another tab.' : 'Applications appear here as candidates apply to your jobs.'}
                  action={!anyFilter && <Button size="sm" variant="outline" to="/recruiter/jobs">Manage jobs</Button>} />} />
              {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={Number(f.size)} setPage={(p) => setF({ page: String(p) })}
                setPageSize={(n) => setF({ size: String(n) })} noun="applications" />}
            </div>
          </Card>
        </div>

        <div className="cl-stack">
          <Card title="Job Overview" action={ovJob && <ViewAll onClick={() => setJobModal(true)}>View Job</ViewAll>} className="rp-job-ov">
            {jobsQ.loading && !jobsQ.data ? <Skeleton h={160} /> : !ovJob ? <EmptyState title="No jobs yet" text="Post a job to start receiving applications." action={<Button size="sm" to="/recruiter/jobs/new">Post a job</Button>} /> : (<>
              <div className="cl-row" style={{ alignItems: 'flex-start' }}>
                <span className="cl-ico"><Briefcase size={19} /></span>
                <div style={{ minWidth: 0 }}><h4>{ovJob.title}</h4><small className="cl-muted">ID: {ovJob.code}{!f.job ? ' · most applied open job' : ''}</small></div>
              </div>
              <div className="meta">
                <span><Building2 size={15} />{branchMeta(ovJob.branch).long}</span>
                <span><MapPin size={15} />{ovJob.location_text || '—'}{ovJob.remote_type ? ` (${ovJob.remote_type})` : ''}</span>
                <span><Clock size={15} />{jobTypeLabel(ovJob.job_type)}{ovJob.openings ? ` · ${ovJob.openings} opening${ovJob.openings === 1 ? '' : 's'}` : ''}</span>
                <span><CalendarDays size={15} />Posted on {fmtDate(ovJob.created_at)}</span>
              </div>
              <div className="rp-ministat">
                <div><b>{ovJob.applications}</b><small>Applications</small></div>
                <div><b>{ovJob.shortlisted}</b><small>Shortlisted</small></div>
                <div><b>{ovJob.interviews}</b><small>Interviews</small></div>
                <div><b>{ovJob.offers}</b><small>Offers</small></div>
              </div>
              {!f.job && <button type="button" className="cl-link" style={{ marginTop: 10, fontSize: 13 }} onClick={() => setF({ job: String(ovJob.id) })}>Filter table to this job</button>}
            </>)}
          </Card>

          <Card title="Application Pipeline" subtitle={f.job ? 'For the selected job' : 'Across all your jobs'} action={<ViewAll to="/recruiter/analytics" />}>
            {kl ? <Skeleton h={150} /> : data?.pipeline?.[0]?.count ? <PipelineBars rows={data.pipeline} /> : <p className="cl-muted">No applications yet.</p>}
          </Card>

          <Card title="Recent Applications" action={<ViewAll onClick={() => setF({ sort: 'newest', status: '', page: '1' })} />}>
            {kl ? <Skeleton h={150} /> : data?.recent?.length ? (
              <div className="cl-list rp-upcoming">
                {data.recent.slice(0, 4).map((r) => (
                  <button type="button" key={r.application_id} className="cl-list-item rp-list-btn" onClick={() => rowOn.profile(r)}>
                    <Avatar name={r.candidate_name} src={r.avatar_path} size={36} />
                    <div className="cl-grow" style={{ minWidth: 0 }}><strong>{r.candidate_name}</strong><small className="cl-ellipsis">Applied for {r.job_title}</small></div>
                    <time>{timeAgo(r.applied_at)}</time>
                  </button>
                ))}
              </div>
            ) : <p className="cl-muted">No applications yet.</p>}
          </Card>

          <Card title="Bulk Actions" subtitle={selRows.length ? `${selRows.length} application${selRows.length === 1 ? '' : 's'} selected` : 'Select rows in the table to act on them'}>
            <div className="rp-btn-grid">
              <Button variant="outline" icon={Bookmark} disabled={!selRows.length} onClick={() => bulkShortlist(selRows)}>Shortlist Selected</Button>
              <Button variant="outline" icon={XCircle} disabled={!selRows.length} onClick={() => setReject(selRows)}>Reject Selected</Button>
              <Button variant="outline" icon={CalendarDays} disabled={!selRows.length} onClick={() => openSchedule(selRows)}>Schedule Interview</Button>
              <Button variant="outline" icon={Mail} disabled={!selRows.length} onClick={() => setEmail(selRows)}>Send Email</Button>
            </div>
          </Card>
        </div>
      </div>

      <RejectModal open={!!reject} onClose={() => setReject(null)} count={reject?.length || 0} names={reject?.[0]?.candidate_name} busy={actions.busy}
        onConfirm={async (reason) => { const r = await actions.bulk(reject.map((x) => x.application_id), 'reject', { reason: reason || null }); if (r) { setReject(null); clearSel() } }} />
      <EmailModal open={!!email} onClose={() => setEmail(null)} count={email?.length || 0} busy={actions.busy}
        onSend={(m) => actions.bulk(email.map((x) => x.application_id), 'email', m)} />
      <ScheduleInterviewModal open={!!schedule} onClose={() => setSchedule(null)} applications={schedule || []} onScheduled={() => { reload(); clearSel() }} />
      <AiResultModal open={!!ai} onClose={() => setAi(null)} api={api} applicationId={ai} />
      <Modal open={jobModal && !!ovJob} onClose={() => setJobModal(false)} size="lg" title={ovJob ? `${ovJob.title} (${ovJob.code})` : 'Job'}
        footer={<><Button variant="secondary" onClick={() => setJobModal(false)}>Close</Button><Button variant="outline" to="/recruiter/jobs">Manage in Jobs</Button>
          {ovJob && String(ovJob.id) !== f.job && <Button onClick={() => { setF({ job: String(ovJob.id) }); setJobModal(false) }}>Show its applications</Button>}</>}>
        {ovJob && (
          <div className="cl-col" style={{ gap: 12 }}>
            <div className="cl-row cl-wrap" style={{ gap: 8 }}>
              <BranchBadge branch={ovJob.branch} long /><Badge tone="blue">{jobTypeLabel(ovJob.job_type)}</Badge>
              {ovJob.experience_level && <Badge>{EXPERIENCE.find((e) => e.value === ovJob.experience_level)?.label || ovJob.experience_level}</Badge>}
              <Badge tone={ovJob.status === 'open' ? 'green' : 'amber'}>{ovJob.status === 'open' ? 'Active' : ovJob.status}</Badge>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>{ovJob.description || <span className="cl-muted">No description.</span>}</p>
            {ovJob.skills?.length > 0 && <div><h4 style={{ fontSize: 14, marginBottom: 6 }}>Required skills</h4><div className="cl-chips">{ovJob.skills.map((s) => <span key={s} className="cl-chip blue">{s}</span>)}</div></div>}
            {ovJob.eligibility && <div><h4 style={{ fontSize: 14, marginBottom: 6 }}>Eligibility</h4><p style={{ fontSize: 14 }}>{ovJob.eligibility}</p></div>}
            {ovJob.target_colleges?.length > 0 && <div><h4 style={{ fontSize: 14, marginBottom: 6 }}>Target colleges</h4><div className="cl-chips">{ovJob.target_colleges.map((s) => <span key={s} className="cl-chip soft">{s}</span>)}</div></div>}
            <p className="cl-muted" style={{ fontSize: 13 }}>{ovJob.location_text || '—'} · Posted {fmtDate(ovJob.created_at)}{ovJob.salary_min ? ` · ${ovJob.currency || 'INR'} ${ovJob.salary_min.toLocaleString()}${ovJob.salary_max ? `–${ovJob.salary_max.toLocaleString()}` : ''}` : ''}</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
