import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileText, Clock3, Bot, BadgeCheck, CircleX, Eye, Briefcase } from 'lucide-react'
import { Alert, Avatar, Button, Card, DataTable, EmptyState, Menu, PageHeader, Pagination, StatusPill, fmtDate, statusLabel } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { DateRangePicker, FilterSelect, MiniStat, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ExportButton, ListToolbar, useListState } from './components/ListKit.jsx'

const score = (v) => (v == null ? <span className="cl-faint">—</span> : <strong className="adm-score" data-tone={v >= 75 ? 'good' : v >= 50 ? 'mid' : 'low'}>{Math.round(v)}</strong>)

export default function AdminApplications() {
  const api = useApi('admin')
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [status, setStatus] = useState(params.get('status') || '')
  const [company, setCompany] = useState('')
  const [range, setRange] = useState({ start: '', end: '', preset: '' })
  const ls = useListState({ status, company, range }, params.get('q') || '')
  const filters = { q: ls.dq, status, company, start: range.start, end: range.end }
  const list = useQuery(() => api.get(`/api/admin/portal/applications${qs({ ...filters, page: ls.page, page_size: ls.pageSize })}`),
    [api, ls.dq, status, company, range.start, range.end, ls.page, ls.pageSize])
  const d = list.data
  const k = d?.kpis
  const pick = (s) => () => setStatus(status === s ? '' : s)

  const columns = [
    { key: 'candidate', header: 'Candidate', render: (a) => (
      <span className="cl-row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={a.candidate.name} size={34} />
        <Cell2 main={a.candidate.name} sub={[a.candidate.college, a.candidate.branch].filter(Boolean).join(' · ') || a.candidate.email} />
      </span>
    ) },
    { key: 'job', header: 'Job / Company', render: (a) => <Cell2 main={a.job} sub={a.company} /> },
    { key: 'ats_score', header: 'ATS Score', align: 'center', render: (a) => score(a.ats_score) },
    { key: 'final_score', header: 'Final Score', align: 'center', render: (a) => score(a.final_score), hideOnMobile: true },
    { key: 'status', header: 'Pipeline Status', render: (a) => <StatusPill status={a.status} /> },
    { key: 'interview_status', header: 'AI Interview', render: (a) => (a.interview_status ? <span className="cl-muted">{statusLabel(a.interview_status)}{a.interview_score != null ? ` · ${a.interview_score}` : ''}</span> : '—'), hideOnMobile: true },
    { key: 'applied_at', header: 'Applied On', render: (a) => fmtDate(a.applied_at) },
    { key: 'actions', header: '', render: (a) => (
      <Menu items={[
        { label: 'View candidate', icon: Eye, onClick: () => navigate(`/admin/users?user=${a.candidate.id}`) },
        { label: 'View job posting', icon: Briefcase, onClick: () => navigate(`/admin/jobs?open=${a.job_id}`) },
      ]} />
    ) },
  ]

  return (
    <div className="adm-page">
      <PageHeader
        title="Applications"
        subtitle="Platform-wide view of every application and where it sits in the hiring pipeline."
        actions={<ExportButton api={api} url={`/api/admin/portal/applications${qs({ ...filters, export: true })}`} filename="corelink-applications.csv"
          columns={[['id', 'id'], ['candidate', (a) => a.candidate.name], ['email', (a) => a.candidate.email], ['college', (a) => a.candidate.college], ['branch', (a) => a.candidate.branch],
            ['job', 'job'], ['company', 'company'], ['status', 'status'], ['ats_score', 'ats_score'], ['final_score', 'final_score'], ['applied_at', 'applied_at']]} />}
      />
      <div className="adm-mini-grid adm-mini-5">
        <MiniStat icon={FileText} value={k ? fmtNum(k.total) : '…'} label="Total applications" active={!status} onClick={() => setStatus('')} />
        <MiniStat icon={Clock3} tone="amber" value={k ? fmtNum(k.in_review) : '…'} label="Under review" sub="ATS + project review" />
        <MiniStat icon={Bot} tone="purple" value={k ? fmtNum(k.interview) : '…'} label="AI interview stage" active={status === 'automated_interview'} onClick={pick('automated_interview')} />
        <MiniStat icon={BadgeCheck} tone="green" value={k ? fmtNum(k.shortlisted) : '…'} label="Shortlisted" active={status === 'shortlisted'} onClick={pick('shortlisted')} />
        <MiniStat icon={CircleX} tone="red" value={k ? fmtNum(k.rejected) : '…'} label="Rejected" active={status === 'rejected'} onClick={pick('rejected')} />
      </div>
      <Card className="adm-listcard">
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search by candidate, email, job or company…">
          <FilterSelect label="All statuses" value={status} onChange={setStatus} options={(d?.facets?.statuses || (status ? [status] : [])).map((s) => ({ value: s, label: statusLabel(s) }))} />
          <FilterSelect label="All companies" value={company} onChange={setCompany} options={d?.facets?.companies || []} />
          <DateRangePicker compact value={range} onChange={setRange} align="right" placeholder="Applied: any date" allowClear ariaLabel="Applied date range" />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={d?.items || []} loading={list.loading && !d} onRowClick={(a) => navigate(`/admin/users?user=${a.candidate.id}`)}
          empty={<EmptyState icon={FileText} title="No applications match" text="Try a different search or clear the filters." />} />
        <Pagination page={ls.page} pages={Math.max(1, Math.ceil((d?.total || 0) / ls.pageSize))} total={d?.total || 0} pageSize={ls.pageSize}
          setPage={ls.setPage} setPageSize={ls.setPageSize} noun="applications" />
      </Card>
      {d && !d.total && !ls.dq && !status && !company && !range.start && (
        <Button variant="ghost" to="/admin/jobs" icon={Briefcase} style={{ alignSelf: 'flex-start' }}>Review job postings</Button>
      )}
    </div>
  )
}
