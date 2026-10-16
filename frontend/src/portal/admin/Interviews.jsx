import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, CalendarClock, CheckCircle2, Bot, CircleX, Video, MapPin, Eye, ShieldAlert } from 'lucide-react'
import { Alert, Avatar, Badge, Card, DataTable, EmptyState, Menu, Modal, PageHeader, Pagination, StatusPill, Tabs, statusLabel } from '../../ui/index.jsx'
import ProctoringReview from '../shared/ProctoringReview.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { FilterSelect, MiniStat, fmtDateTime, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ListToolbar, useListState } from './components/ListKit.jsx'

const KIND_TABS = [{ id: '', label: 'All interviews' }, { id: 'scheduled', label: 'Recruiter rounds' }, { id: 'ai', label: 'AI interviews' }]

export default function AdminInterviews() {
  const api = useApi('admin')
  const navigate = useNavigate()
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [proctor, setProctor] = useState(null) // AI interview row being reviewed
  const ls = useListState({ kind, status })
  const list = useQuery(() => api.get(`/api/admin/portal/interviews${qs({ kind, status, q: ls.dq, page: ls.page, page_size: ls.pageSize })}`),
    [api, kind, status, ls.dq, ls.page, ls.pageSize])
  const d = list.data
  const k = d?.kpis

  const columns = [
    { key: 'candidate', header: 'Candidate', render: (r) => (
      <span className="cl-row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={r.candidate?.name} size={34} />
        <Cell2 main={r.candidate?.name} sub={[r.candidate?.college, r.candidate?.branch].filter(Boolean).join(' · ')} />
      </span>
    ) },
    { key: 'title', header: 'Round', render: (r) => (
      <span className="cl-row" style={{ gap: 6 }}>
        {r.kind === 'ai' ? <Badge tone="purple"><Bot size={12} /> AI</Badge> : null}
        <span>{r.title}</span>
      </span>
    ) },
    { key: 'job', header: 'Job / Company', render: (r) => <Cell2 main={r.job} sub={r.company} /> },
    { key: 'at', header: 'Date & Time', render: (r) => fmtDateTime(r.at) },
    { key: 'mode', header: 'Mode', render: (r) => (
      <span className="cl-row cl-muted" style={{ gap: 6 }}>{r.mode === 'onsite' ? <MapPin size={14} /> : <Video size={14} />}{statusLabel(r.mode)}{r.duration_min ? ` · ${r.duration_min} min` : ''}</span>
    ), hideOnMobile: true },
    { key: 'interviewers', header: 'Interviewers', render: (r) => <span className="cl-muted adm-clip">{r.interviewers || '—'}</span>, hideOnMobile: true },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'rating', header: 'Result', render: (r) => (r.rating != null ? <span><strong>{r.rating}</strong>{r.kind === 'ai' ? '/100' : '/5'}{r.recommendation ? <small className="cl-muted"> · {statusLabel(r.recommendation)}</small> : null}</span> : '—') },
    { key: 'actions', header: '', render: (r) => (
      <Menu items={[
        { label: 'View candidate', icon: Eye, onClick: () => navigate(`/admin/users?user=${r.candidate?.id}`), disabled: !r.candidate?.id },
        ...(r.kind === 'ai' ? [{ label: 'View proctoring', icon: ShieldAlert, onClick: () => setProctor(r) }] : []),
      ]} />
    ) },
  ]

  return (
    <div className="adm-page">
      <PageHeader title="Interviews" subtitle="Recruiter-run interview rounds and AI interviews across every company on CoreLink." />
      <div className="adm-mini-grid adm-mini-5">
        <MiniStat icon={CalendarDays} value={k ? fmtNum(k.total) : '…'} label="All interviews" active={!kind && !status} onClick={() => { setKind(''); setStatus('') }} />
        <MiniStat icon={CalendarClock} tone="teal" value={k ? fmtNum(k.upcoming) : '…'} label="Upcoming rounds" active={kind === 'scheduled' && status === 'scheduled'} onClick={() => { setKind('scheduled'); setStatus('scheduled') }} />
        <MiniStat icon={CheckCircle2} tone="green" value={k ? fmtNum(k.completed) : '…'} label="Completed" active={!kind && status === 'completed'} onClick={() => { setKind(''); setStatus('completed') }} />
        <MiniStat icon={Bot} tone="purple" value={k ? fmtNum(k.ai) : '…'} label="AI interviews" active={kind === 'ai' && !status} onClick={() => { setKind('ai'); setStatus('') }} />
        <MiniStat icon={CircleX} tone="red" value={k ? fmtNum(k.cancelled) : '…'} label="Cancelled / no-show" />
      </div>
      <Card className="adm-listcard">
        <Tabs tabs={KIND_TABS} value={kind} onChange={setKind} />
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search by candidate, job or company…">
          <FilterSelect label="All statuses" value={status} onChange={setStatus} options={(d?.facets?.statuses || (status ? [status] : [])).map((s) => ({ value: s, label: statusLabel(s) }))} />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={d?.items || []} loading={list.loading && !d}
          empty={<EmptyState icon={CalendarDays} title="No interviews match" text="Interviews appear when recruiters schedule rounds or candidates take AI interviews." />} />
        <Pagination page={ls.page} pages={Math.max(1, Math.ceil((d?.total || 0) / ls.pageSize))} total={d?.total || 0} pageSize={ls.pageSize}
          setPage={ls.setPage} setPageSize={ls.setPageSize} noun="interviews" />
      </Card>
      <Modal open={!!proctor} onClose={() => setProctor(null)} size="lg"
        title={proctor ? `Proctoring — ${proctor.candidate?.name || 'Candidate'} · ${proctor.job}` : ''}>
        {proctor && <ProctoringReview role="admin" sessionId={String(proctor.id).replace(/^a-/, '')} />}
      </Modal>
    </div>
  )
}
