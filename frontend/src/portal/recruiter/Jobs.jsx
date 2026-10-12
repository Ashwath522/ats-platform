import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive, ArrowRight, Ban, Bookmark, Briefcase, CalendarCheck, Copy, FileClock, FilePlus2, FileText, Handshake, LayoutGrid, MapPin,
  Pause, Pencil, Play, Target, Trash2, Users,
} from 'lucide-react'
import {
  Alert, Button, Card, DataTable, EmptyState, Field, Hero, LogoTile, Menu, Modal, Pagination, SearchInput, Select, Skeleton, Tabs, ViewAll,
  fmtDate, usePagination, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import JobsFormModal from './components/JobsFormModal.jsx'
import { GuideList, GuidelineModal, TEMPLATE_GROUPS, TemplatePickerModal, groupRoles } from './components/JobsTemplates.jsx'
import { API, BRANCH_OPTIONS, BranchBadge, JOB_TYPES, JobStatusPill, Kpi, cityOf, jobTypeLabel } from './components/RecruiterPipelineKit.jsx'

const TABS = [
  { id: 'all', label: 'All Jobs', icon: LayoutGrid },
  { id: 'draft', label: 'Drafts', icon: FileText },
  { id: 'closed', label: 'Closed', icon: FileClock },
  { id: 'archived', label: 'Archived', icon: Archive },
]
const STATUS_OPTIONS = [
  { value: 'open', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived' },
]

export default function Jobs({ create = false }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useQuery(() => api.get(`${API}/jobs`), [api])
  const roles = useQuery(() => api.get('/api/candidate/roles'), [api])
  const colleges = useQuery(() => api.get(`${API}/jobs/colleges`), [api])

  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [branch, setBranch] = useState('')
  const [type, setType] = useState('')
  const [loc, setLoc] = useState('')
  const [status, setStatus] = useState('')
  const [sel, setSel] = useState(new Set())
  const [form, setForm] = useState(create ? { open: true } : null) // {open, job?, prefill?}
  const [tplPicker, setTplPicker] = useState(null)
  const [guide, setGuide] = useState(null)
  const [confirm, setConfirm] = useState(null) // {job}
  const [target, setTarget] = useState(null) // {college}
  const [targetJob, setTargetJob] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (create) setForm({ open: true }) }, [create])
  const closeForm = () => { setForm(null); if (create) navigate('/recruiter/jobs', { replace: true }) }

  const jobs = data?.jobs || []
  const locations = useMemo(() => [...new Set(jobs.map((j) => cityOf(j.location_text)).filter(Boolean))].sort(), [jobs])
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return jobs.filter((j) => {
      if (tab === 'all' ? j.status === 'archived' : j.status !== tab) return false
      if (branch && j.branch !== branch) return false
      if (type && j.job_type !== type) return false
      if (loc && cityOf(j.location_text) !== loc) return false
      if (status && j.status !== status) return false
      if (qq && !`${j.title} ${j.code} ${j.location_text} ${(j.skills || []).join(' ')}`.toLowerCase().includes(qq)) return false
      return true
    })
  }, [jobs, tab, q, branch, type, loc, status])
  const pg = usePagination(filtered, 10)
  useEffect(() => { pg.setPage(1) }, [tab, q, branch, type, loc, status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(new Set()) }, [tab])

  const grouped = useMemo(() => groupRoles(roles.data || []), [roles.data])

  async function setJobStatus(ids, st, label) {
    setBusy(true)
    try {
      const r = await api.post(`${API}/jobs/bulk-status`, { ids, status: st })
      toast(`${r.updated} job${r.updated === 1 ? '' : 's'} ${label}`, 'success')
      setSel(new Set())
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  async function duplicate(job) {
    try {
      const r = await api.post(`${API}/jobs/${job.id}/duplicate`)
      toast(`${r.message} (${r.code})`, 'success')
      reload()
    } catch (e) { toast(e.message, 'error') }
  }
  async function del(job) {
    setBusy(true)
    try {
      await api.del(`${API}/jobs/${job.id}`)
      toast(`Deleted “${job.title}”`, 'success')
      setConfirm(null)
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  async function addTarget() {
    if (!targetJob) return toast('Pick a job first', 'error')
    setBusy(true)
    try {
      await api.post(`${API}/jobs/${targetJob}/target-colleges`, { college: target.college })
      toast(`${target.college} added to the job's target colleges`, 'success')
      setTarget(null); setTargetJob('')
      reload(); colleges.reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const columns = [
    { key: 'title', header: 'Job Title', sortable: true, render: (j) => <div className="rp-job-title"><strong>{j.title}</strong><small>ID: {j.code}</small></div> },
    { key: 'branch', header: 'Branch / Domain', sortable: true, render: (j) => <BranchBadge branch={j.branch} /> },
    { key: 'location_text', header: 'Location', sortable: true, render: (j) => <span className="rp-loc"><MapPin size={14} />{cityOf(j.location_text) || (j.remote_type === 'remote' ? 'Remote' : '—')}</span> },
    { key: 'job_type', header: 'Type', sortable: true, render: (j) => jobTypeLabel(j.job_type) },
    { key: 'applications', header: 'Applications', sortable: true, render: (j) => <a className="rp-applinks" href={`/recruiter/applications?job=${j.id}`} onClick={(e) => { e.preventDefault(); navigate(`/recruiter/applications?job=${j.id}`) }}><Users size={15} />{j.applications}</a> },
    { key: 'status', header: 'Status', sortable: true, render: (j) => <JobStatusPill status={j.status} /> },
    { key: 'created_at', header: 'Posted On', sortable: true, render: (j) => fmtDate(j.created_at) },
    {
      key: 'actions', header: 'Actions', align: 'center', render: (j) => (
        <Menu label={`Actions for ${j.title}`} items={[
          { label: 'Edit', icon: Pencil, onClick: () => setForm({ open: true, job: j }) },
          { label: 'Duplicate', icon: Copy, onClick: () => duplicate(j) },
          j.status === 'open' && { label: 'Pause', icon: Pause, onClick: () => setJobStatus([j.id], 'paused', 'paused') },
          (j.status === 'paused' || j.status === 'closed' || j.status === 'archived') && { label: j.status === 'paused' ? 'Resume' : 'Reopen', icon: Play, onClick: () => setJobStatus([j.id], 'open', 'reopened') },
          j.status === 'draft' && { label: 'Publish', icon: Play, onClick: () => setJobStatus([j.id], 'open', 'published') },
          (j.status === 'open' || j.status === 'paused') && { label: 'Close', icon: Ban, onClick: () => setJobStatus([j.id], 'closed', 'closed') },
          j.status !== 'archived' && { label: 'Archive', icon: Archive, onClick: () => setJobStatus([j.id], 'archived', 'archived') },
          { label: 'View applicants', icon: Users, to: `/recruiter/applications?job=${j.id}` },
          { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirm({ job: j }) },
        ]} />
      ),
    },
  ]

  const k = data?.kpis
  const counts = data?.counts || {}
  const openForTarget = jobs.filter((j) => ['open', 'draft', 'paused'].includes(j.status))

  return (
    <div className="cl-grid-main rp-page">
      <div className="cl-stack">
        <Hero
          src="/assets/images/crops/hero-recruiter-jobs.jpg"
          title={<h1>Post Engineering Jobs<br />Find the Right Talent</h1>}
          text="Create job postings, manage requisitions and attract top engineering talent from leading colleges."
          actions={<>
            <Button size="lg" iconRight={ArrowRight} onClick={() => setForm({ open: true })}>Create a New Job</Button>
            <Button size="lg" variant="white" onClick={() => setTplPicker('intern')}>Use Template</Button>
          </>}
        />
        {error && <Alert tone="error">{error.message} <button className="cl-link" onClick={reload}>Retry</button></Alert>}
        <div className="cl-grid rp-kpis">
          <Kpi loading={loading && !data} icon={Briefcase} label="Active Jobs" kpi={k?.active_jobs} />
          <Kpi loading={loading && !data} icon={Briefcase} tone="purple" label="Total Applications" kpi={k?.applications} />
          <Kpi loading={loading && !data} icon={Bookmark} tone="green" label="Candidates Shortlisted" kpi={k?.shortlisted} />
          <Kpi loading={loading && !data} icon={CalendarCheck} tone="orange" label="Interviews Scheduled" kpi={k?.interviews_scheduled} />
          <Kpi loading={loading && !data} icon={Handshake} tone="red" label="Offers Made" kpi={k?.offers} />
        </div>

        <Card className="rp-table-card rp-compact">
          <Tabs tabs={TABS.map((t) => ({ ...t, count: counts[t.id] ?? 0 }))} value={tab} onChange={setTab} />
          <div className="rp-filterbar five" style={{ marginTop: 14 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search by job title, skills, or location…" />
            <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="All Branches" options={BRANCH_OPTIONS} />
            <Select aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)} placeholder="All Job Types" options={JOB_TYPES} />
            <Select aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="All Locations" options={locations} />
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All Status" options={STATUS_OPTIONS} />
          </div>
          <div style={{ marginTop: 12 }}>
            {sel.size > 0 && (
              <div className="rp-bulkbar" role="region" aria-label="Bulk actions">
                <strong>{sel.size} selected</strong>
                <Button size="sm" variant="outline" icon={Ban} loading={busy} onClick={() => setJobStatus([...sel], 'closed', 'closed')}>Close</Button>
                <Button size="sm" variant="outline" icon={Archive} loading={busy} onClick={() => setJobStatus([...sel], 'archived', 'archived')}>Archive</Button>
                <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
              </div>
            )}
            <DataTable columns={columns} rows={pg.slice} loading={loading && !data} selectable selected={sel} onSelect={setSel}
              empty={<EmptyState icon={Briefcase} title={jobs.length ? 'No jobs match these filters' : 'No jobs yet'} text={jobs.length ? 'Clear a filter or switch tabs.' : 'Create your first requisition to start receiving applications.'}
                action={!jobs.length && <Button size="sm" icon={FilePlus2} onClick={() => setForm({ open: true })}>Create a job</Button>} />} />
            <Pagination {...pg} noun="jobs" />
          </div>
        </Card>
      </div>

      <div className="cl-stack">
        <Card title="Create a New Job">
          <div className="rp-create-card">
            <span className="cl-ico" style={{ width: 52, height: 52 }}><FileText size={26} /></span>
            <div><h4>Post a Job / Requisition</h4><p className="cl-muted" style={{ fontSize: 13 }}>Define role, eligibility, skills and hiring process to reach the right engineering talent.</p></div>
          </div>
          <Button block iconRight={ArrowRight} onClick={() => setForm({ open: true })}>Create Job</Button>
        </Card>

        <Card title="Job Templates" action={<ViewAll onClick={() => setTplPicker('intern')} />}>
          {roles.loading ? <Skeleton h={180} /> : roles.error ? <Alert tone="error">Templates unavailable: {roles.error.message}</Alert> : (
            <div className="cl-list rp-tpl">
              {TEMPLATE_GROUPS.map((g) => {
                const I = g.icon
                return (
                  <div className="cl-list-item" key={g.id}>
                    <span className={`cl-ico ${g.tone}`}><I size={19} /></span>
                    <div className="cl-grow"><strong>{g.label}</strong><small>{g.desc} · {(grouped[g.id] || []).length} templates</small></div>
                    <Button size="sm" variant="outline" disabled={!(grouped[g.id] || []).length} onClick={() => setTplPicker(g.id)}>Use</Button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="Hiring Guidelines" action={<ViewAll onClick={() => setGuide('jd')} />}>
          <GuideList onOpen={setGuide} />
        </Card>

        <Card title="Recommended Colleges" subtitle={colleges.data?.branches?.length ? 'Where candidates in your hiring branches study' : undefined}>
          {colleges.loading ? <Skeleton h={200} /> : colleges.data?.colleges?.length ? (
            <div className="cl-list rp-colleges">
              {colleges.data.colleges.slice(0, 5).map((c) => (
                <div className="cl-list-item" key={c.college}>
                  <LogoTile name={c.college} size={38} />
                  <div className="cl-grow"><strong>{c.college}</strong><small>{c.branch_labels.slice(0, 3).join(', ')} · {c.candidates} candidate{c.candidates === 1 ? '' : 's'}</small></div>
                  <Button size="sm" variant={c.targeted ? 'success' : 'outline'} icon={c.targeted ? Target : undefined} onClick={() => { setTarget(c); setTargetJob(openForTarget[0] ? String(openForTarget[0].id) : '') }}>{c.targeted ? 'Targeted' : 'Target'}</Button>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No colleges yet" text="As students in your branches join CoreLink, their colleges show up here." />}
        </Card>
      </div>

      <JobsFormModal open={!!form?.open} onClose={closeForm} api={api} job={form?.job} prefill={form?.prefill}
        colleges={(colleges.data?.colleges || []).map((c) => c.college)} locations={jobs.map((j) => j.location_text).filter(Boolean)}
        onSaved={() => { reload(); colleges.reload() }} />
      <TemplatePickerModal open={!!tplPicker} initialGroup={tplPicker || 'intern'} onClose={() => setTplPicker(null)} roles={roles.data || []} loading={roles.loading}
        onUse={(prefill) => setForm({ open: true, prefill })} />
      <GuidelineModal id={guide} onClose={() => setGuide(null)} jobs={jobs} />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete job?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          {confirm?.job?.applications > 0
            ? <Button icon={Archive} loading={busy} onClick={async () => { await setJobStatus([confirm.job.id], 'archived', 'archived'); setConfirm(null) }}>Archive instead</Button>
            : <Button variant="danger" icon={Trash2} loading={busy} onClick={() => del(confirm.job)}>Delete permanently</Button>}
        </>}>
        {confirm?.job && (confirm.job.applications > 0
          ? <Alert tone="warn">“{confirm.job.title}” has {confirm.job.applications} application{confirm.job.applications === 1 ? '' : 's'}. To keep the audited hiring history, jobs with applicants can't be deleted — archive it instead.</Alert>
          : <p>“{confirm.job.title}” ({confirm.job.code}) will be removed permanently. This can't be undone.</p>)}
      </Modal>

      <Modal open={!!target} onClose={() => setTarget(null)} title={`Target ${target?.college || ''}`}
        footer={<><Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button><Button icon={Target} loading={busy} disabled={!openForTarget.length} onClick={addTarget}>Add to job</Button></>}>
        {openForTarget.length ? (
          <div className="cl-col" style={{ gap: 12 }}>
            <p className="cl-muted">Add this college to a job's target list. It shows on the posting and helps you track campus hiring.</p>
            <Field label="Job"><Select value={targetJob} onChange={(e) => setTargetJob(e.target.value)} options={openForTarget.map((j) => ({ value: String(j.id), label: `${j.title} (${j.code})${j.target_colleges?.some((c) => c.toLowerCase() === target?.college?.toLowerCase()) ? ' — already targeted' : ''}` }))} /></Field>
          </div>
        ) : <EmptyState title="No active jobs" text="Create or reopen a job to target colleges." />}
      </Modal>
    </div>
  )
}
