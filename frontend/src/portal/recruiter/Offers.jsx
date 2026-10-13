import React, { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bell, CalendarCheck, CheckCircle2, Eye, FilePlus2, FileText, Filter, Handshake, Layers, Mail, MessageSquareMore, Pencil, Search, Send, Trash2,
  UserCheck, Users, XCircle,
} from 'lucide-react'
import {
  Alert, Avatar, Button, Card, DataTable, Donut, EmptyState, Field, IconButton, Input, Menu, PageHeader, Pagination, Select, Skeleton, StatTile, Tabs,
  ViewAll, useToast, usePagination,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useRecruiter } from './RecruiterShell.jsx'
import { BranchTag, DateRangePicker, H, HLegend, PipeBars, branchInfo, dayKey, fmtD, fmtDay, todayKey } from './components/HiringCommon.jsx'
import {
  OfferBulkModal, OfferComposeModal, OfferDetailsModal, OfferJoinedModal, OfferStatus, OfferTemplatesModal, OfferWithdrawModal,
} from './components/OffersDialogs.jsx'

const TABS = [
  { id: 'all', label: 'All Offers' },
  { id: 'pending', label: 'Pending Response' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'joined', label: 'Joined' },
  { id: 'draft', label: 'Drafts' },
]
const STATUS_OPTS = ['draft', 'sent', 'negotiation', 'accepted', 'declined', 'withdrawn', 'joined']
  .map((s) => ({ value: s, label: { draft: 'Draft', sent: 'Pending (sent)', negotiation: 'Negotiation', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', joined: 'Joined' }[s] }))
const JOIN_OPTS = [
  { value: 'upcoming', label: 'Joining in next 30 days' }, { value: 'set', label: 'Joining date set' },
  { value: 'unset', label: 'Joining date not set' }, { value: 'joined', label: 'Joined' },
]
const SORTS = [
  { value: 'date_desc', label: 'Offer Date (Newest)' }, { value: 'date_asc', label: 'Offer Date (Oldest)' },
  { value: 'ctc_desc', label: 'CTC (High to Low)' }, { value: 'ctc_asc', label: 'CTC (Low to High)' },
  { value: 'join_asc', label: 'Joining Date (Soonest)' }, { value: 'name', label: 'Candidate (A–Z)' },
]
const PIPE_COLORS = ['#2563eb', '#60a5fa', '#93c5fd', '#334155', '#10b981', '#16a34a']
const inTab = (o, tab) => tab === 'all' ? true
  : tab === 'pending' ? ['sent', 'negotiation'].includes(o.status) : o.status === tab

export default function Offers() {
  const api = useApi('recruiter')
  const toast = useToast()
  const { company, setCompany, companyName } = useRecruiter() || {}
  const [params, setParams] = useSearchParams()
  const list = useQuery(() => api.get(`${H}/offers?limit=1000`), [api])
  const stats = useQuery(() => api.get(`${H}/offers/stats`), [api])
  const reload = useCallback(() => { list.reload(); stats.reload() }, [list, stats])
  const all = list.data?.items || []

  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'all'
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const [f, setF] = useState({ job: '', branch: '', loc: '', status: '', join: '', college: '', type: '', min: '', max: '' })
  const [range, setRange] = useState({ start: '', end: '' })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('date_desc')
  const [more, setMore] = useState(false)
  const [sel, setSel] = useState(new Set())
  const [dlg, setDlg] = useState({})
  const setFilter = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const opts = useMemo(() => {
    const uniq = (fn) => [...new Set(all.map(fn).filter(Boolean))].sort()
    return {
      jobs: uniq((o) => o.job_title), locs: uniq((o) => o.location_city), colleges: uniq((o) => o.college),
      branches: [...new Map(all.filter((o) => o.branch).map((o) => [branchInfo(o.branch).label, o.branch])).entries()].map(([label, value]) => ({ label, value: label })),
    }
  }, [all])

  const filtered = useMemo(() => {
    const now = todayKey()
    const in30 = dayKey(Date.now() + 30 * 864e5)
    return all.filter((o) => {
      if (f.job && o.job_title !== f.job) return false
      if (f.branch && branchInfo(o.branch).label !== f.branch) return false
      if (f.loc && o.location_city !== f.loc) return false
      if (f.status && o.status !== f.status) return false
      if (f.college && o.college !== f.college) return false
      if (f.type && (o.job_type === 'internship' ? 'internship' : 'full-time') !== f.type) return false
      if (f.min !== '' && !(o.ctc_amount != null && o.ctc_amount >= Number(f.min))) return false
      if (f.max !== '' && !(o.ctc_amount != null && o.ctc_amount <= Number(f.max))) return false
      if (f.join === 'set' && !o.joining_date) return false
      if (f.join === 'unset' && o.joining_date) return false
      if (f.join === 'joined' && o.status !== 'joined') return false
      if (f.join === 'upcoming' && !(o.joining_date && o.joining_date >= now && o.joining_date <= in30 && ['accepted', 'sent', 'negotiation'].includes(o.status))) return false
      if (range.start && dayKey(o.offer_date) < range.start) return false
      if (range.end && dayKey(o.offer_date) > range.end) return false
      if (q && !`${o.candidate_name} ${o.candidate_email} ${o.job_title} ${o.college || ''}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [all, f, range, q])
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, filtered.filter((o) => inTab(o, t.id)).length])), [filtered])
  const rows = useMemo(() => {
    const r = filtered.filter((o) => inTab(o, tab))
    const by = {
      date_desc: (a, b) => (b.offer_date || '').localeCompare(a.offer_date || ''),
      date_asc: (a, b) => (a.offer_date || '').localeCompare(b.offer_date || ''),
      ctc_desc: (a, b) => (b.ctc_amount ?? -1) - (a.ctc_amount ?? -1),
      ctc_asc: (a, b) => (a.ctc_amount ?? 1e9) - (b.ctc_amount ?? 1e9),
      join_asc: (a, b) => (a.joining_date || '9999').localeCompare(b.joining_date || '9999'),
      name: (a, b) => (a.candidate_name || '').localeCompare(b.candidate_name || ''),
    }[sort]
    return [...r].sort(by)
  }, [filtered, tab, sort])
  const pg = usePagination(rows, 10)
  const selected = all.filter((o) => sel.has(o.id))
  const activeFilters = Object.values(f).filter(Boolean).length + (range.start ? 1 : 0) + (q ? 1 : 0)
  const clearFilters = () => { setF({ job: '', branch: '', loc: '', status: '', join: '', college: '', type: '', min: '', max: '' }); setRange({ start: '', end: '' }); setQ('') }

  const act = useCallback(async (kind, o) => {
    if (kind === 'send') {
      try {
        const r = await api.post(`${H}/offers/${o.id}/send`)
        toast(`${o.status === 'draft' ? 'Offer sent' : 'Offer letter re-sent'} to ${r.candidate_name}`, 'success')
        setDlg({}); reload()
      } catch (e) { toast(e.message, 'error') }
      return
    }
    if (kind === 'remind') {
      try { await api.post(`${H}/offers/bulk`, { action: 'remind', ids: [o.id] }); toast(`Reminder emailed to ${o.candidate_name}`, 'success'); reload() } catch (e) { toast(e.message, 'error') }
      return
    }
    if (kind === 'negotiation') {
      try { await api.patch(`${H}/offers/${o.id}`, { status: 'negotiation' }); toast('Marked as in negotiation', 'success'); reload() } catch (e) { toast(e.message, 'error') }
      return
    }
    if (kind === 'delete') {
      if (!window.confirm(`Delete the draft offer for ${o.candidate_name}?`)) return
      try { await api.del(`${H}/offers/${o.id}`); toast('Draft deleted', 'success'); setDlg({}); reload() } catch (e) { toast(e.message, 'error') }
      return
    }
    if (kind === 'new') { setDlg({ compose: { preset: o.application_id } }); return }
    if (kind === 'edit') { setDlg({ compose: { offer: o } }); return }
    setDlg({ [kind]: o })
  }, [api, toast, reload])

  async function saveTemplates(t) {
    const c = await api.put(`${H}/company`, { preferences: { offer_templates: t } })
    setCompany?.(c)
    toast('Offer templates saved', 'success')
  }

  const menuFor = (o) => {
    const s = o.status
    return [
      { label: 'View offer', icon: FileText, onClick: () => act('details', o) },
      ['draft', 'sent', 'negotiation', 'accepted'].includes(s) && { label: s === 'draft' ? 'Edit draft' : 'Revise offer', icon: Pencil, onClick: () => act('edit', o) },
      s === 'draft' && { label: 'Send offer', icon: Send, onClick: () => act('send', o) },
      ['sent', 'negotiation'].includes(s) && { label: 'Resend letter', icon: Send, onClick: () => act('send', o) },
      ['sent', 'negotiation'].includes(s) && { label: 'Send reminder', icon: Bell, onClick: () => act('remind', o) },
      s === 'sent' && { label: 'Mark in negotiation', icon: MessageSquareMore, onClick: () => act('negotiation', o) },
      s === 'accepted' && { label: 'Mark as joined', icon: UserCheck, onClick: () => act('joined', o) },
      ['declined', 'withdrawn'].includes(s) && { label: 'Create new offer', icon: FilePlus2, onClick: () => act('new', o) },
      ['sent', 'negotiation', 'accepted'].includes(s) && { label: 'Withdraw offer', icon: XCircle, danger: true, onClick: () => act('withdraw', o) },
      s === 'draft' && { label: 'Delete draft', icon: Trash2, danger: true, onClick: () => act('delete', o) },
    ]
  }

  const cols = [
    { key: 'candidate_name', header: 'Candidate', render: (o) => <span className="hr-cand"><Avatar name={o.candidate_name} src={o.candidate_avatar} size={30} /><span><strong>{o.candidate_name}</strong><small>{o.cgpa ? `CGPA: ${o.cgpa}` : 'CGPA: —'}</small></span></span> },
    { key: 'job_title', header: 'Job Role', render: (o) => <span className="hr-wrap2 cl-muted" style={{ maxWidth: 92 }} title={o.job_title}>{o.job_title}</span> },
    { key: 'branch', header: 'Branch', render: (o) => <BranchTag branch={o.branch} /> },
    { key: 'college', header: 'College', render: (o) => <span className="hr-wrap2 cl-muted" style={{ maxWidth: 84 }} title={o.college || ''}>{o.college || '—'}</span>, hideOnMobile: true },
    { key: 'offer_date', header: 'Offer Date', render: (o) => <span style={{ whiteSpace: 'nowrap' }}>{o.status === 'draft' ? <span className="cl-muted">Not sent</span> : fmtD(o.offer_date)}</span> },
    { key: 'ctc', header: 'CTC / Stipend', render: (o) => <span className="hr-ctc">{(o.ctc || '—').replace(/\s*\((Internship)\)/i, '')}{/intern/i.test(o.ctc || '') || o.job_type === 'internship' ? <small>(Internship)</small> : null}</span> },
    { key: 'status', header: 'Status', render: (o) => <OfferStatus status={o.status} /> },
    { key: 'joining_date', header: 'Joining Date', render: (o) => <span style={{ whiteSpace: 'nowrap' }}>{o.joining_date ? fmtDay(o.joining_date) : '–'}</span> },
    { key: 'actions', header: 'Actions', align: 'right', render: (o) => <span className="cl-row" style={{ justifyContent: 'flex-end', gap: 2 }}><IconButton icon={Eye} label={`View offer for ${o.candidate_name}`} onClick={(e) => { e.stopPropagation(); act('details', o) }} /><Menu items={menuFor(o)} label={`Actions for ${o.candidate_name}`} /></span> },
  ]

  const k = stats.data?.kpis
  const st = stats.data?.status
  const donut = st ? [
    { label: 'Accepted', value: st.accepted, color: '#10b981' },
    { label: 'Pending', value: st.pending, color: '#f59e0b' },
    { label: 'Declined', value: st.declined, color: '#ef4444' },
    { label: 'Withdrawn', value: st.withdrawn, color: '#475569' },
  ] : []
  const pipeline = (stats.data?.pipeline || []).map((p, i) => ({ ...p, color: PIPE_COLORS[i] }))
  const joining = stats.data?.joining_timeline || []
  const pending = all.filter((o) => ['sent', 'negotiation'].includes(o.status))
  const bulk = (action) => (selected.length ? setDlg({ bulk: { action, offers: selected } }) : toast('Select offers in the table first', 'info'))

  return (
    <div className="hr-page">
      <PageHeader
        title="Offers & Hiring"
        subtitle="Manage offer letters, track candidate decisions and oversee the hiring to joining process."
        actions={<>
          <Button variant="outline" icon={FileText} onClick={() => setDlg({ templates: true })}>Offer Templates</Button>
          <Menu label="Bulk actions" items={[
            { label: `Send reminders${selected.length ? ` (${selected.length})` : ''}`, icon: Bell, onClick: () => bulk('remind') },
            { label: `Send / resend letters${selected.length ? ` (${selected.length})` : ''}`, icon: Send, onClick: () => bulk('resend') },
            { label: `Mark as joined${selected.length ? ` (${selected.length})` : ''}`, icon: UserCheck, onClick: () => bulk('joined') },
            { label: `Withdraw${selected.length ? ` (${selected.length})` : ''}`, icon: XCircle, danger: true, onClick: () => bulk('withdraw') },
          ]}><Button variant="outline" icon={Layers} aria-haspopup="menu">Bulk Actions{selected.length ? ` (${selected.length})` : ''}</Button></Menu>
          <Button icon={FilePlus2} onClick={() => setDlg({ compose: {} })}>Generate Offer Letter</Button>
        </>}
      />

      <div className="cl-grid-main">
        <div className="cl-stack">
          <div className="hr-kpis k5">
            {stats.loading && !k ? Array.from({ length: 5 }, (_, i) => <div key={i} className="cl-card"><Skeleton h={58} /></div>) : <>
              <StatTile icon={CalendarCheck} value={k?.made.value} label="Offers Made" delta={k?.made.delta} />
              <StatTile icon={CheckCircle2} tone="green" value={k?.accepted.value} label="Offers Accepted" delta={k?.accepted.delta} />
              <StatTile icon={Users} tone="amber" value={k?.negotiation.value} label="Negotiation in Progress" delta={k?.negotiation.delta} />
              <StatTile icon={XCircle} tone="red" value={k?.declined.value} label="Offer Declined" delta={k?.declined.delta} deltaDir={k?.declined.delta > 0 ? 'down' : 'up'} />
              <StatTile icon={Handshake} tone="green" value={k?.joined.value} label="Joined" delta={k?.joined.delta} />
            </>}
          </div>
          {stats.error && <Alert tone="error">{stats.error.message}</Alert>}

          <section className="cl-card">
            <div className="hr-filters">
              <Select value={f.job} onChange={setFilter('job')} options={opts.jobs} placeholder="All Jobs" aria-label="Filter by job" />
              <Select value={f.branch} onChange={setFilter('branch')} options={opts.branches} placeholder="All Branches" aria-label="Filter by branch" />
              <Select value={f.loc} onChange={setFilter('loc')} options={opts.locs} placeholder="All Locations" aria-label="Filter by location" />
              <Select value={f.status} onChange={setFilter('status')} options={STATUS_OPTS} placeholder="All Offer Status" aria-label="Filter by offer status" />
              <Select value={f.join} onChange={setFilter('join')} options={JOIN_OPTS} placeholder="All Joining Status" aria-label="Filter by joining status" />
              <DateRangePicker value={range} onChange={setRange} allowClear presets={[
                { label: 'Last 30 days', range: () => ({ start: dayKey(Date.now() - 29 * 864e5), end: todayKey() }) },
                { label: 'This month', range: () => { const d = new Date(); return { start: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), end: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) } } },
                { label: 'This year', range: () => ({ start: `${new Date().getFullYear()}-01-01`, end: `${new Date().getFullYear()}-12-31` }) },
              ]} />
            </div>
            <div className="hr-filters-2">
              <Input icon={Search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by candidate name, job, or email…" aria-label="Search offers" />
              <Button variant="outline" icon={Filter} onClick={() => setMore((m) => !m)} aria-expanded={more}>More Filters</Button>
              <span className="spacer">{activeFilters > 0 && <button type="button" className="cl-link" onClick={clearFilters}>Clear filters ({activeFilters})</button>}</span>
              <label className="hr-sort">Sort by: <Select value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} aria-label="Sort offers" /></label>
            </div>
            {more && (
              <div className="hr-more">
                <Field label="College"><Select value={f.college} onChange={setFilter('college')} options={opts.colleges} placeholder="All colleges" /></Field>
                <Field label="Offer type"><Select value={f.type} onChange={setFilter('type')} options={[{ value: 'full-time', label: 'Full-time' }, { value: 'internship', label: 'Internship' }]} placeholder="All types" /></Field>
                <Field label="Min CTC (LPA)"><Input type="number" min="0" step="0.5" value={f.min} onChange={setFilter('min')} placeholder="e.g. 5" /></Field>
                <Field label="Max CTC (LPA)"><Input type="number" min="0" step="0.5" value={f.max} onChange={setFilter('max')} placeholder="e.g. 10" /></Field>
              </div>
            )}

            <div className="hr-tabs-bar" style={{ marginTop: 14 }}>
              <Tabs tabs={TABS.map((t) => ({ ...t, count: counts[t.id] }))} value={tab} onChange={(t) => { setTab(t); setSel(new Set()) }} />
            </div>
            {selected.length > 0 && (
              <div className="hr-bulkbar">
                <strong>{selected.length} selected</strong>
                <Button size="sm" variant="secondary" icon={Bell} onClick={() => bulk('remind')}>Remind</Button>
                <Button size="sm" variant="secondary" icon={Send} onClick={() => bulk('resend')}>Send letters</Button>
                <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => bulk('joined')}>Mark joined</Button>
                <Button size="sm" variant="danger" icon={XCircle} onClick={() => bulk('withdraw')}>Withdraw</Button>
                <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
              </div>
            )}
            {list.error ? <Alert tone="error">{list.error.message} <button className="cl-link" onClick={list.reload}>Retry</button></Alert> : (
              <div className="hr-tbl hr-offers-tbl">
                <DataTable onRowClick={(o) => act('details', o)} columns={cols} rows={pg.slice} loading={list.loading && !list.data} selectable selected={sel} onSelect={setSel}
                  empty={all.length === 0
                    ? <EmptyState icon={Handshake} title="No offers yet" text="Generate an offer letter for a shortlisted or interviewed candidate." action={<Button size="sm" icon={FilePlus2} onClick={() => setDlg({ compose: {} })}>Generate Offer Letter</Button>} />
                    : <EmptyState icon={Search} title="No offers match" text="Try another tab or clear the filters." action={activeFilters ? <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button> : null} />} />
              </div>
            )}
            <Pagination {...pg} noun="offers" />
          </section>
        </div>

        <aside className="cl-stack">
          <Card title="Hiring Pipeline" action={<ViewAll to="/recruiter/analytics" />}>
            {stats.loading && !stats.data ? <Skeleton h={170} /> : <PipeBars rows={pipeline} />}
          </Card>

          <Card title="Offer Status" action={<ViewAll onClick={() => { setTab('all'); setF((x) => ({ ...x, status: '' })) }} />}>
            {!st ? <Skeleton h={140} /> : st.total === 0 ? <EmptyState icon={Handshake} title="No offers sent yet" text={st.drafts ? `${st.drafts} draft${st.drafts > 1 ? 's' : ''} waiting to be sent.` : 'Sent offers show up here.'} /> : (
              <div className="hr-donut-row">
                <Donut segments={donut} size={124} stroke={16} center={st.total} sub="Total Offers" />
                <HLegend items={donut} total={st.total} />
              </div>
            )}
            {st?.drafts > 0 && st.total > 0 && <p className="hr-small" style={{ marginTop: 10 }}>Plus {st.drafts} unsent draft{st.drafts > 1 ? 's' : ''}.</p>}
          </Card>

          <Card title="Joining Timeline" action={<ViewAll onClick={() => { setTab('accepted'); setSort('join_asc') }} />}>
            {stats.loading && !stats.data ? <Skeleton h={160} /> : joining.length === 0
              ? <EmptyState icon={CalendarCheck} title="No joinings planned" text="Accepted offers with a joining date appear here." />
              : joining.slice(0, 5).map((j) => {
                const o = all.find((x) => x.id === j.offer_id)
                return (
                  <button type="button" key={j.offer_id} className="hr-join" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--cl-line-2)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => o && act('details', o)}>
                    <Avatar name={j.candidate_name} src={j.candidate_avatar} size={36} />
                    <span className="txt"><strong>{j.candidate_name}</strong><span className="cl-ellipsis" style={{ display: 'block' }}>{j.job_title}</span></span>
                    <span className="d">{fmtDay(j.joining_date)}{j.status === 'joined' && <small className="cl-muted" style={{ display: 'block' }}>Joined</small>}</span>
                  </button>
                )
              })}
          </Card>

          <Card title="Quick Actions">
            <div className="hr-quick">
              <Button variant="outline" icon={FilePlus2} onClick={() => setDlg({ compose: {} })}>Generate Offer</Button>
              <Button variant="outline" icon={Mail} disabled={!pending.length} title={pending.length ? 'Email a reminder to every candidate with a pending offer' : 'No pending offers'} onClick={() => setDlg({ bulk: { action: 'remind', offers: pending } })}>Send Reminders</Button>
              <Button variant="outline" icon={Users} onClick={() => { setTab('accepted'); setSort('join_asc') }}>Track Joinings</Button>
              <Button variant="outline" icon={FileText} onClick={() => setDlg({ templates: true })}>View Templates</Button>
            </div>
          </Card>
        </aside>
      </div>

      <OfferComposeModal open={!!dlg.compose} offer={dlg.compose?.offer} preset={dlg.compose?.preset} templates={company?.offer_templates} companyName={companyName}
        onClose={() => setDlg({})} onSaved={() => { setSel(new Set()); reload() }} />
      <OfferDetailsModal offer={dlg.details} companyName={companyName} logo={company?.logo_url} onClose={() => setDlg({})} onAction={act} />
      <OfferWithdrawModal offer={dlg.withdraw} onClose={() => setDlg({})} onDone={reload} />
      <OfferJoinedModal offer={dlg.joined} onClose={() => setDlg({})} onDone={reload} />
      <OfferTemplatesModal open={!!dlg.templates} templates={company?.offer_templates} onClose={() => setDlg({})} onSave={saveTemplates} />
      <OfferBulkModal action={dlg.bulk?.action} offers={dlg.bulk?.offers} onClose={() => setDlg({})} onDone={() => { setSel(new Set()); reload() }} />
    </div>
  )
}
