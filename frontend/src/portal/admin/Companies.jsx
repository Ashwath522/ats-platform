import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Building2, BadgeCheck, Clock3, Briefcase, UsersRound, FileText, Eye, Flag, ExternalLink, ShieldQuestion } from 'lucide-react'
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, LogoTile, Menu, Modal, PageHeader, Pagination, Skeleton, StatusPill, fmtDate, useToast,
} from '../../ui/index.jsx'
import { DemoBadge } from '../shared/companies.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import VerificationReport from '../../components/VerificationReport.jsx'
import { CompanyPill, FilterSelect, KV, MiniStat, NoteModal, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ExportButton, ListToolbar, useListState } from './components/ListKit.jsx'

const STATUS_OPTS = [
  { value: 'verified', label: 'Verified' }, { value: 'approved', label: 'Approved' }, { value: 'pending', label: 'Pending review' },
  { value: 'unverified', label: 'Unverified' },
]

export default function AdminCompanies() {
  const api = useApi('admin')
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [status, setStatus] = useState('')
  const ls = useListState({ status }, new URLSearchParams(location.search).get('q') || '')
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('open'))
  const [flagFor, setFlagFor] = useState(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery(() => api.get(`/api/admin/portal/companies${qs({ q: ls.dq, status })}`), [api, ls.dq, status])
  const items = list.data?.items || []
  const k = list.data?.kpis
  const pages = Math.max(1, Math.ceil(items.length / ls.pageSize))
  const slice = useMemo(() => items.slice((ls.page - 1) * ls.pageSize, ls.page * ls.pageSize), [items, ls.page, ls.pageSize])

  const openDetail = (id) => { setOpen(id); navigate({ search: id ? `?open=${encodeURIComponent(id)}` : '' }, { replace: true }) }

  const submitFlag = async (note, severity = 'medium') => {
    setBusy(true)
    try {
      await api.post('/api/admin/portal/flags', { kind: 'company', title: `Company flagged: ${flagFor.name}`.slice(0, 200), detail: note, severity })
      toast('Company flagged for moderation', 'success')
      setFlagFor(null)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const columns = [
    { key: 'name', header: 'Company', sortable: true, render: (c) => (
      <span className="cl-row" style={{ gap: 10, minWidth: 0 }}>
        <LogoTile name={c.name} src={c.logo} size={34} />
        <Cell2 main={<>{c.name}{c.is_demo && <> <DemoBadge compact /></>}</>} sub={c.website ? c.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null} />
      </span>
    ) },
    { key: 'industry', header: 'Industry', render: (c) => <span className="cl-muted">{c.industry || '—'}</span>, hideOnMobile: true },
    { key: 'location', header: 'Location', render: (c) => <span className="cl-muted">{c.location || '—'}</span> },
    { key: 'recruiter_count', header: 'Recruiters', sortable: true, align: 'center' },
    { key: 'jobs', header: 'Jobs (open)', sortable: true, align: 'center', render: (c) => `${c.jobs} (${c.open_jobs})` },
    { key: 'applications', header: 'Applications', sortable: true, align: 'center' },
    { key: 'registered', header: 'Registered On', sortable: true, render: (c) => fmtDate(c.registered) },
    { key: 'status', header: 'Status', render: (c) => <CompanyPill value={c.status} /> },
    { key: 'actions', header: 'Actions', render: (c) => (
      <span className="adm-actions" onClick={(e) => e.stopPropagation()}>
        {c.status === 'pending'
          ? <Button size="sm" variant="outline" to="/admin/moderation?tab=requests">Review</Button>
          : <Button size="sm" variant="outline" onClick={() => openDetail(c.id)}>View</Button>}
        <Menu items={[
          { label: 'View details', icon: Eye, onClick: () => openDetail(c.id) },
          { label: 'View job postings', icon: Briefcase, onClick: () => navigate(`/admin/jobs?company=${encodeURIComponent(c.name)}`) },
          { label: 'Flag company', icon: Flag, danger: true, onClick: () => setFlagFor(c) },
        ]} />
      </span>
    ) },
  ]

  return (
    <div className="adm-page">
      <PageHeader
        title="Companies"
        subtitle="Every employer on CoreLink — verification status, recruiters, job postings and applications."
        actions={<ExportButton api={api} url={`/api/admin/portal/companies${qs({ q: ls.dq, status })}`} filename="corelink-companies.csv"
          columns={[['name', 'name'], ['industry', 'industry'], ['location', 'location'], ['website', 'website'], ['status', 'status'], ['recruiters', 'recruiter_count'], ['jobs', 'jobs'], ['open_jobs', 'open_jobs'], ['applications', 'applications'], ['registered', 'registered']]} />}
      />
      <div className="adm-mini-grid">
        <MiniStat icon={Building2} value={k ? fmtNum(k.total) : '…'} label="Companies" active={!status} onClick={() => setStatus('')} />
        <MiniStat icon={BadgeCheck} tone="green" value={k ? fmtNum(k.verified) : '…'} label="Verified / approved" active={status === 'verified'} onClick={() => setStatus(status === 'verified' ? '' : 'verified')} />
        <MiniStat icon={Clock3} tone="amber" value={k ? fmtNum(k.pending) : '…'} label="Pending review" active={status === 'pending'} onClick={() => setStatus(status === 'pending' ? '' : 'pending')} />
        <MiniStat icon={UsersRound} tone="purple" value={k ? fmtNum(k.recruiters) : '…'} label="Recruiters" />
        <MiniStat icon={Briefcase} tone="teal" value={k ? fmtNum(k.jobs) : '…'} label="Job postings" />
        <MiniStat icon={FileText} tone="red" value={k ? fmtNum(k.applications) : '…'} label="Applications" />
      </div>

      <Card className="adm-listcard">
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search by company, industry or location…">
          <FilterSelect label="All statuses" value={status} onChange={setStatus} options={STATUS_OPTS} />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={slice} loading={list.loading && !list.data} onRowClick={(c) => openDetail(c.id)}
          empty={<EmptyState icon={Building2} title="No companies match" text="Companies appear here when a recruiter request is submitted or a recruiter sets up a company profile." />} />
        <Pagination page={ls.page} pages={pages} total={items.length} pageSize={ls.pageSize} setPage={ls.setPage} setPageSize={ls.setPageSize} noun="companies" />
      </Card>

      <CompanyModal id={open} api={api} onClose={() => openDetail(null)} onFlag={(c) => setFlagFor(c)} />
      <NoteModal open={!!flagFor} title={`Flag ${flagFor?.name || 'company'}`} label="Reason" required danger busy={busy} confirmLabel="Flag company"
        placeholder="e.g. Misleading company details, unverifiable registration…" onClose={() => setFlagFor(null)} onSubmit={(n) => submitFlag(n)} />
    </div>
  )
}

function CompanyModal({ id, api, onClose, onFlag }) {
  const navigate = useNavigate()
  const q = useQuery(() => (id ? api.get(`/api/admin/portal/companies/${encodeURIComponent(id)}`) : Promise.resolve(null)), [api, id])
  const c = q.data
  const p = c?.profile
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={c ? c.name : 'Company'}
      footer={c && <>
        <Button variant="secondary" icon={Flag} onClick={() => onFlag(c)}>Flag</Button>
        {c.status === 'pending' && <Button to="/admin/moderation?tab=requests" icon={ShieldQuestion}>Review request</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      {q.loading && <div className="cl-stack"><Skeleton h={40} /><Skeleton h={120} /></div>}
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      {c && (
        <div className="cl-stack" style={{ gap: 18 }}>
          <div className="cl-row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <LogoTile name={c.name} src={c.logo} size={56} />
            <div className="cl-grow" style={{ minWidth: 0 }}>
              <div className="cl-row cl-wrap" style={{ gap: 8 }}><strong style={{ fontSize: 17 }}>{c.name}</strong><CompanyPill value={c.status} /></div>
              {p?.tagline && <p className="cl-muted" style={{ marginTop: 4 }}>{p.tagline}</p>}
              {c.website && <a className="cl-link" href={c.website} target="_blank" rel="noreferrer">{c.website} <ExternalLink size={12} /></a>}
            </div>
          </div>
          <KV wide rows={[
            ['Industry', c.industry], ['Location', c.location], ['Company size', c.size], ['Registered on', fmtDate(c.registered)],
            p && ['Legal name', p.legal_name], p && ['Founded', p.founded], ['Recruiters', fmtNum(c.recruiter_count)],
            ['Job postings', `${c.jobs.length} total · ${c.open_jobs} open`], ['Applications received', fmtNum(c.applications)],
          ]} />
          {p?.about && <div><h4 className="adm-section-title">About</h4><p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{p.about}</p></div>}
          <div>
            <h4 className="adm-section-title">Recruiters ({c.recruiters.length})</h4>
            {c.recruiters.length === 0 ? <p className="cl-muted">No recruiter accounts yet.</p> : (
              <div className="cl-list">
                {c.recruiters.map((r) => (
                  <button key={r.id} type="button" className="cl-list-item adm-linkrow" onClick={() => navigate(`/admin/users?user=${r.id}`)}>
                    <Cell2 main={r.name || r.email} sub={r.email} />
                    <span className="cl-row" style={{ gap: 8 }}><StatusPill status={r.status} /><small className="cl-muted">Joined {fmtDate(r.joined)}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="adm-section-title">Job postings ({c.jobs.length})</h4>
            {!c.jobs.length ? <p className="cl-muted">No jobs posted yet.</p> : (
              <div className="cl-list">
                {c.jobs.slice(0, 12).map((j) => (
                  <button key={j.id} type="button" className="cl-list-item adm-linkrow" onClick={() => navigate(`/admin/jobs?open=${j.id}`)}>
                    <Cell2 main={j.title} sub={[j.branch, j.location, `${j.applications} applications`].filter(Boolean).join(' · ')} />
                    <StatusPill status={j.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
          {c.requests.length > 0 && (
            <div>
              <h4 className="adm-section-title">Access requests</h4>
              <div className="cl-stack" style={{ gap: 10 }}>
                {c.requests.map((r) => (
                  <div key={r.id} className="adm-req">
                    <div className="adm-req-head">
                      <div className="adm-req-meta"><strong style={{ color: 'var(--cl-ink)' }}>{r.name}</strong><span>{r.email}</span><span>Submitted {fmtDate(r.submitted_at)}{r.gstin ? ` · GSTIN ${r.gstin}` : ''}{r.cin ? ` · CIN ${r.cin}` : ''}</span></div>
                      <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'} dot>{r.status}</Badge>
                    </div>
                    {r.verification && <div className="adm-req-report"><VerificationReport verification={r.verification} compact /></div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
