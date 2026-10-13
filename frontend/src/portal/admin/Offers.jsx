import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Handshake, CheckCircle2, Hourglass, CircleX, UserCheck, IndianRupee, Eye } from 'lucide-react'
import { Alert, Avatar, Card, DataTable, EmptyState, Menu, PageHeader, Pagination, StatusPill, fmtDate, statusLabel } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { FilterSelect, MiniStat, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ExportButton, ListToolbar, money, useListState } from './components/ListKit.jsx'

const STATUSES = ['draft', 'sent', 'negotiation', 'accepted', 'joined', 'declined', 'withdrawn'].map((s) => ({ value: s, label: statusLabel(s) }))

export default function AdminOffers() {
  const api = useApi('admin')
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const ls = useListState({ status })
  const list = useQuery(() => api.get(`/api/admin/portal/offers${qs({ status, q: ls.dq, page: ls.page, page_size: ls.pageSize })}`),
    [api, status, ls.dq, ls.page, ls.pageSize])
  const d = list.data
  const k = d?.kpis
  const pick = (s) => () => setStatus(status === s ? '' : s)

  const columns = [
    { key: 'candidate', header: 'Candidate', render: (o) => (
      <span className="cl-row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={o.candidate?.name} size={34} />
        <Cell2 main={o.candidate?.name} sub={[o.candidate?.college, o.candidate?.branch].filter(Boolean).join(' · ')} />
      </span>
    ) },
    { key: 'job', header: 'Role / Company', render: (o) => <Cell2 main={o.job} sub={o.company} /> },
    { key: 'ctc', header: 'Compensation', render: (o) => o.ctc || (o.ctc_amount ? money(o.ctc_amount) : '—') },
    { key: 'offer_date', header: 'Offered On', render: (o) => fmtDate(o.offer_date) },
    { key: 'joining_date', header: 'Joining Date', render: (o) => fmtDate(o.joining_date), hideOnMobile: true },
    { key: 'responded_at', header: 'Responded', render: (o) => (o.responded_at ? fmtDate(o.responded_at) : '—'), hideOnMobile: true },
    { key: 'status', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
    { key: 'actions', header: '', render: (o) => (
      <Menu items={[{ label: 'View candidate', icon: Eye, onClick: () => navigate(`/admin/users?user=${o.candidate?.id}`), disabled: !o.candidate?.id }]} />
    ) },
  ]

  return (
    <div className="adm-page">
      <PageHeader
        title="Offers & Hiring"
        subtitle="Offer letters sent through CoreLink, candidate decisions and joining status across all companies."
        actions={<ExportButton api={api} url={`/api/admin/portal/offers${qs({ status, q: ls.dq, export: true })}`} filename="corelink-offers.csv"
          columns={[['id', 'id'], ['candidate', (o) => o.candidate?.name], ['email', (o) => o.candidate?.email], ['job', 'job'], ['company', 'company'], ['ctc', 'ctc'],
            ['ctc_lpa', 'ctc_amount'], ['status', 'status'], ['offer_date', 'offer_date'], ['joining_date', 'joining_date'], ['responded_at', 'responded_at']]} />}
      />
      <div className="adm-mini-grid">
        <MiniStat icon={Handshake} value={k ? fmtNum(k.total) : '…'} label="Offers made" active={!status} onClick={() => setStatus('')} />
        <MiniStat icon={CheckCircle2} tone="green" value={k ? fmtNum(k.accepted) : '…'} label="Accepted / joined" active={status === 'accepted'} onClick={pick('accepted')} />
        <MiniStat icon={Hourglass} tone="amber" value={k ? fmtNum(k.pending) : '…'} label="Awaiting decision" active={status === 'sent'} onClick={pick('sent')} />
        <MiniStat icon={CircleX} tone="red" value={k ? fmtNum(k.declined) : '…'} label="Declined / withdrawn" active={status === 'declined'} onClick={pick('declined')} />
        <MiniStat icon={UserCheck} tone="teal" value={k ? fmtNum(k.joined) : '…'} label="Joined" active={status === 'joined'} onClick={pick('joined')} />
        <MiniStat icon={IndianRupee} tone="purple" value={k?.avg_ctc != null ? `₹${k.avg_ctc}L` : '—'} label="Average CTC" sub={k?.avg_ctc != null ? 'per annum, offers with a CTC' : 'no CTC recorded yet'} />
      </div>
      <Card className="adm-listcard">
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search by candidate, role or company…">
          <FilterSelect label="All statuses" value={status} onChange={setStatus} options={STATUSES} />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={d?.items || []} loading={list.loading && !d}
          empty={<EmptyState icon={Handshake} title="No offers match" text="Offers appear here once recruiters send them from their Offers & Hiring page." />} />
        <Pagination page={ls.page} pages={Math.max(1, Math.ceil((d?.total || 0) / ls.pageSize))} total={d?.total || 0} pageSize={ls.pageSize}
          setPage={ls.setPage} setPageSize={ls.setPageSize} noun="offers" />
      </Card>
    </div>
  )
}
