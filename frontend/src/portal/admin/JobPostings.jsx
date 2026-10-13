import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Briefcase, CircleCheck, CirclePause, CircleX, Flag, FileText, Eye, Lock, Unlock, Building2 } from 'lucide-react'
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Field, LogoTile, Menu, Modal, PageHeader, Pagination, Select, Skeleton, StatusPill, fmtDate, statusLabel, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { BRANCHES } from '../../branding/branches.js'
import { ConfirmModal, FilterSelect, KV, MiniStat, NoteModal, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ExportButton, ListToolbar, useListState } from './components/ListKit.jsx'

const STATUS_OPTS = ['open', 'paused', 'draft', 'closed', 'archived'].map((s) => ({ value: s, label: statusLabel(s) }))
const BRANCH_OPTS = BRANCHES.map((b) => ({ value: b.id, label: b.label }))
const salary = (j) => {
  if (j.salary_min == null && j.salary_max == null) return null
  const f = (n) => (n >= 100000 ? `${Math.round(n / 10000) / 10}L` : Number(n).toLocaleString('en-IN'))
  return `${j.currency === 'INR' ? '₹' : `${j.currency} `}${[j.salary_min, j.salary_max].filter((x) => x != null).map(f).join(' – ')}`
}

export default function AdminJobPostings() {
  const api = useApi('admin')
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [status, setStatus] = useState(params.get('status') || '')
  const [branch, setBranch] = useState('')
  const [company, setCompany] = useState(params.get('company') || '')
  const [version, setVersion] = useState(0)
  const ls = useListState({ status, branch, company }, params.get('q') || '')
  const [open, setOpen] = useState(params.get('open'))
  const [flagFor, setFlagFor] = useState(null)
  const [severity, setSeverity] = useState('medium')
  const [toggle, setToggle] = useState(null)
  const [busy, setBusy] = useState(false)

  const filters = { q: ls.dq, status, branch, company }
  const list = useQuery(() => api.get(`/api/admin/portal/jobs${qs({ ...filters, page: ls.page, page_size: ls.pageSize })}`),
    [api, ls.dq, status, branch, company, ls.page, ls.pageSize, version])
  const d = list.data
  const k = d?.kpis
  const refresh = () => setVersion((v) => v + 1)
  const openDetail = (id) => { setOpen(id ? String(id) : null); navigate({ search: id ? `?open=${id}` : '' }, { replace: true }) }

  const setJobStatus = async () => {
    setBusy(true)
    const next = toggle.status === 'open' ? 'closed' : 'open'
    try {
      await api.post(`/api/admin/portal/jobs/${toggle.id}/status`, { status: next })
      toast(next === 'closed' ? 'Job closed — it no longer accepts applications' : 'Job reopened', 'success')
      setToggle(null)
      refresh()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const submitFlag = async (reason) => {
    setBusy(true)
    try {
      await api.post(`/api/admin/portal/jobs/${flagFor.id}/flag`, { reason, severity })
      toast('Job flagged — it now appears in Content Moderation', 'success')
      setFlagFor(null)
      refresh()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const columns = [
    { key: 'title', header: 'Job', render: (j) => (
      <span className="cl-row" style={{ gap: 10, minWidth: 0 }}>
        <LogoTile name={j.company} size={34} />
        <Cell2 main={<>{j.title}{j.flagged && <Badge tone="red" className="adm-flagtag"><Flag size={11} /> Flagged</Badge>}</>} sub={j.company} />
      </span>
    ) },
    { key: 'branch', header: 'Branch', render: (j) => j.branch_label || <span className="cl-faint">Any</span> },
    { key: 'location', header: 'Location', render: (j) => <span className="cl-muted">{j.location || '—'}{j.remote_type && j.remote_type !== 'onsite' ? ` · ${statusLabel(j.remote_type)}` : ''}</span>, hideOnMobile: true },
    { key: 'job_type', header: 'Type', render: (j) => (j.job_type ? statusLabel(j.job_type) : '—') },
    { key: 'applications', header: 'Applications', align: 'center' },
    { key: 'created_at', header: 'Posted On', render: (j) => fmtDate(j.created_at) },
    { key: 'status', header: 'Status', render: (j) => <StatusPill status={j.status} /> },
    { key: 'actions', header: 'Actions', render: (j) => (
      <span className="adm-actions" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={() => openDetail(j.id)}>View</Button>
        <Menu items={[
          { label: 'View details', icon: Eye, onClick: () => openDetail(j.id) },
          { label: 'View applications', icon: FileText, onClick: () => navigate(`/admin/applications?q=${encodeURIComponent(j.title)}`) },
          j.status === 'open' ? { label: 'Close job', icon: Lock, onClick: () => setToggle(j) } : { label: 'Reopen job', icon: Unlock, onClick: () => setToggle(j) },
          { label: 'Flag job', icon: Flag, danger: true, onClick: () => { setSeverity('medium'); setFlagFor(j) } },
        ]} />
      </span>
    ) },
  ]

  return (
    <div className="adm-page">
      <PageHeader
        title="Job Postings"
        subtitle="Moderate every job on the platform — review details, close or reopen postings and flag anything misleading."
        actions={<ExportButton api={api} url={`/api/admin/portal/jobs${qs({ ...filters, export: true })}`} filename="corelink-jobs.csv"
          columns={[['id', 'id'], ['title', 'title'], ['company', 'company'], ['branch', 'branch_label'], ['location', 'location'], ['type', 'job_type'], ['status', 'status'], ['applications', 'applications'], ['flagged', 'flagged'], ['posted', 'created_at']]}
        />}
      />
      <div className="adm-mini-grid">
        <MiniStat icon={Briefcase} value={k ? fmtNum(k.total) : '…'} label="Total postings" active={!status} onClick={() => setStatus('')} />
        <MiniStat icon={CircleCheck} tone="green" value={k ? fmtNum(k.open) : '…'} label="Open" active={status === 'open'} onClick={() => setStatus(status === 'open' ? '' : 'open')} />
        <MiniStat icon={CirclePause} tone="amber" value={k ? fmtNum(k.paused) : '…'} label="Paused / draft" />
        <MiniStat icon={CircleX} tone="purple" value={k ? fmtNum(k.closed) : '…'} label="Closed" active={status === 'closed'} onClick={() => setStatus(status === 'closed' ? '' : 'closed')} />
        <MiniStat icon={Flag} tone="red" value={k ? fmtNum(k.flagged) : '…'} label="Flagged (open)" onClick={() => navigate('/admin/moderation?tab=flags')} />
        <MiniStat icon={FileText} tone="teal" value={k ? fmtNum(k.applications) : '…'} label="Applications" onClick={() => navigate('/admin/applications')} />
      </div>

      <Card className="adm-listcard">
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search by title, company or location…">
          <FilterSelect label="All statuses" value={status} onChange={setStatus} options={STATUS_OPTS} />
          <FilterSelect label="All branches" value={branch} onChange={setBranch} options={BRANCH_OPTS} />
          <FilterSelect label="All companies" value={company} onChange={setCompany} options={d?.facets?.companies || (company ? [company] : [])} />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={d?.items || []} loading={list.loading && !d} onRowClick={(j) => openDetail(j.id)}
          empty={<EmptyState icon={Briefcase} title="No job postings match" text="Try clearing the filters." />} />
        <Pagination page={ls.page} pages={Math.max(1, Math.ceil((d?.total || 0) / ls.pageSize))} total={d?.total || 0} pageSize={ls.pageSize}
          setPage={ls.setPage} setPageSize={ls.setPageSize} noun="jobs" />
      </Card>

      <JobModal id={open} api={api} version={version} onClose={() => openDetail(null)} onToggle={setToggle} onFlag={(j) => { setSeverity('medium'); setFlagFor(j) }} />
      <ConfirmModal open={!!toggle} busy={busy} danger={toggle?.status === 'open'}
        title={toggle?.status === 'open' ? 'Close this job?' : 'Reopen this job?'}
        confirmLabel={toggle?.status === 'open' ? 'Close job' : 'Reopen job'}
        text={toggle?.status === 'open'
          ? `“${toggle?.title}” will stop accepting applications. Existing applicants keep their status. This is recorded in the audit log.`
          : `“${toggle?.title}” will be visible to students again and accept new applications.`}
        onConfirm={setJobStatus} onClose={() => setToggle(null)} />
      <NoteModal open={!!flagFor} title={`Flag “${flagFor?.title || 'job'}”`} label="Reason" required danger busy={busy} confirmLabel="Flag job"
        placeholder="e.g. Misleading salary, non-core role, duplicate posting…" onClose={() => setFlagFor(null)} onSubmit={submitFlag}
        extra={<Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value)} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} /></Field>} />
    </div>
  )
}

function JobModal({ id, api, version, onClose, onToggle, onFlag }) {
  const navigate = useNavigate()
  const q = useQuery(() => (id ? api.get(`/api/admin/portal/jobs/${encodeURIComponent(id)}`) : Promise.resolve(null)), [api, id, version])
  const j = q.data
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={j ? j.title : 'Job posting'}
      footer={j && <>
        <Button variant="secondary" icon={Flag} onClick={() => onFlag(j)}>Flag</Button>
        <Button variant={j.status === 'open' ? 'danger' : 'primary'} icon={j.status === 'open' ? Lock : Unlock} onClick={() => onToggle(j)}>{j.status === 'open' ? 'Close job' : 'Reopen job'}</Button>
      </>}>
      {q.loading && !j && <div className="cl-stack"><Skeleton h={40} /><Skeleton h={140} /></div>}
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      {j && (
        <div className="cl-stack" style={{ gap: 18 }}>
          <div className="cl-row cl-wrap" style={{ gap: 10 }}>
            <LogoTile name={j.company} size={44} />
            <div className="cl-grow"><strong style={{ fontSize: 16 }}>{j.company}</strong><div className="cl-muted" style={{ fontSize: 13 }}>Posted by {j.recruiter || 'unknown recruiter'} · {fmtDate(j.created_at)}</div></div>
            <StatusPill status={j.status} />
          </div>
          <KV wide rows={[
            ['Branch', j.branch_label || 'Any branch'], ['Location', j.location], ['Work mode', statusLabel(j.remote_type)],
            ['Job type', j.job_type && statusLabel(j.job_type)], ['Experience', j.experience_level], ['Openings', j.openings],
            ['Salary', salary(j)], ['Eligibility', j.eligibility],
          ]} />
          <div>
            <h4 className="adm-section-title">Applications ({j.applications})</h4>
            {j.applications === 0 ? <p className="cl-muted">No applications yet.</p> : (
              <div className="cl-row cl-wrap" style={{ gap: 8 }}>
                {Object.entries(j.status_counts).map(([s, n]) => <Badge key={s} tone="blue">{statusLabel(s)}: {n}</Badge>)}
                <Button size="sm" variant="ghost" icon={FileText} onClick={() => navigate(`/admin/applications?q=${encodeURIComponent(j.title)}`)}>Open applications</Button>
              </div>
            )}
          </div>
          {j.flags.length > 0 && (
            <div>
              <h4 className="adm-section-title">Moderation flags</h4>
              <div className="cl-stack" style={{ gap: 8 }}>
                {j.flags.map((f) => (
                  <div key={f.id} className="adm-note">
                    <p><strong>{f.title}</strong></p>
                    <small><span>{statusLabel(f.severity)} severity · {fmtDate(f.at)}</span><StatusPill status={f.status} /></small>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4 className="adm-section-title">Description</h4>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{j.description || '—'}</p>
          </div>
          {j.requirements && <div><h4 className="adm-section-title">Requirements</h4><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{j.requirements}</p></div>}
          <Button variant="ghost" icon={Building2} onClick={() => navigate(`/admin/companies?q=${encodeURIComponent(j.company)}`)} style={{ alignSelf: 'flex-start' }}>Company details</Button>
        </div>
      )}
    </Modal>
  )
}
