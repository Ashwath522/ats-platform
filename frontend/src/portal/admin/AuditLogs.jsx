import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ScrollText, CalendarClock, UserCog, Layers, Eye } from 'lucide-react'
import { Alert, Badge, Button, Card, DataTable, EmptyState, Modal, PageHeader, Pagination, Skeleton, statusLabel } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { DateRangePicker, FilterSelect, KV, MiniStat, fmtDateTime, fmtNum, qs } from './components/adminKit.jsx'
import { Cell2, ExportButton, ListToolbar, useListState } from './components/ListKit.jsx'

const TYPE_TONE = { admin_action: 'orange', human_decision: 'green', ats_scoring: 'blue', interview: 'purple', retention: '' }
const actionVerb = (a) => (a ? statusLabel(a.split(':')[0]) : null)
const actionTarget = (a) => (a && a.includes(':') ? a.split(':').slice(1).join(':') : null)

export default function AdminAuditLogs() {
  const api = useApi('admin')
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [type, setType] = useState(params.get('type') || '')
  const [range, setRange] = useState({ start: '', end: '', preset: '' })
  const ls = useListState({ type, range }, params.get('q') || '')
  const [open, setOpen] = useState(null)
  const filters = { event_type: type, start: range.start, end: range.end, q: ls.dq }
  const list = useQuery(() => api.get(`/api/admin/portal/audit-logs${qs({ ...filters, page: ls.page, page_size: ls.pageSize })}`),
    [api, type, range.start, range.end, ls.dq, ls.page, ls.pageSize])
  const d = list.data
  const k = d?.kpis

  const columns = [
    { key: 'created_at', header: 'Time', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</span> },
    { key: 'event_type', header: 'Event', render: (r) => <Badge tone={TYPE_TONE[r.event_type] ?? 'blue'}>{statusLabel(r.event_type)}</Badge> },
    { key: 'human_action', header: 'Action', render: (r) => <Cell2 main={actionVerb(r.human_action) || r.final_recommendation || '—'} sub={actionTarget(r.human_action)} /> },
    { key: 'human_reviewer', header: 'Actor', render: (r) => <span className="cl-muted">{r.human_reviewer || 'System'}</span> },
    { key: 'subject', header: 'Candidate / Job', render: (r) => <Cell2 main={r.candidate || (r.candidate_id ? `Student #${r.candidate_id}` : '—')} sub={r.job} />, hideOnMobile: true },
    { key: 'score', header: 'Score / Risk', render: (r) => (r.final_score != null || r.ats_score != null ? <span>{Math.round(r.final_score ?? r.ats_score)}{r.risk_level ? <small className="cl-muted"> · {r.risk_level}</small> : null}</span> : (r.risk_level || '—')), hideOnMobile: true },
    { key: 'actions', header: '', render: (r) => <Button size="sm" variant="ghost" icon={Eye} aria-label={`View audit entry ${r.id}`} onClick={(e) => { e.stopPropagation(); setOpen(r.id) }}>Details</Button> },
  ]

  return (
    <div className="adm-page">
      <PageHeader title="Audit Logs" subtitle="Tamper-evident record of AI scoring decisions, human reviews and every admin action on the platform."
        actions={<ExportButton api={api} url={`/api/admin/portal/audit-logs${qs({ ...filters, export: true })}`} filename="corelink-audit-log.csv"
          columns={[['id', 'id'], ['time', 'created_at'], ['event_type', 'event_type'], ['action', 'human_action'], ['actor', 'human_reviewer'], ['candidate', 'candidate'], ['job', 'job'],
            ['application_id', 'application_id'], ['ats_score', 'ats_score'], ['final_score', 'final_score'], ['risk_level', 'risk_level'], ['recommendation', 'final_recommendation']]} />}
      />
      <div className="adm-mini-grid adm-mini-4">
        <MiniStat icon={ScrollText} value={k ? fmtNum(k.total) : '…'} label="Total entries" active={!type} onClick={() => setType('')} />
        <MiniStat icon={CalendarClock} tone="teal" value={k ? fmtNum(k.last_7_days) : '…'} label="Last 7 days" />
        <MiniStat icon={UserCog} tone="amber" value={k ? fmtNum(k.admin_actions) : '…'} label="Admin actions" active={type === 'admin_action'} onClick={() => setType(type === 'admin_action' ? '' : 'admin_action')} />
        <MiniStat icon={Layers} tone="purple" value={k ? fmtNum(Object.keys(k.by_type || {}).length) : '…'} label="Event types" />
      </div>
      <Card className="adm-listcard">
        <ListToolbar q={ls.q} setQ={ls.setQ} placeholder="Search actor, action, candidate, job or ID…">
          <FilterSelect label="All event types" value={type} onChange={setType} options={(d?.event_types || []).map((t) => ({ value: t, label: `${statusLabel(t)} (${k?.by_type?.[t] ?? 0})` }))} />
          <DateRangePicker compact value={range} onChange={setRange} placeholder="Any date" allowClear ariaLabel="Date range" />
        </ListToolbar>
        {list.error && <Alert tone="error">{list.error.message}</Alert>}
        <DataTable columns={columns} rows={d?.items || []} loading={list.loading && !d} onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState icon={ScrollText} title="No audit entries match" text="Try a wider date range or clear the filters." />} />
        <Pagination page={ls.page} pages={Math.max(1, Math.ceil((d?.total || 0) / ls.pageSize))} total={d?.total || 0} pageSize={ls.pageSize}
          setPage={ls.setPage} setPageSize={ls.setPageSize} noun="entries" />
      </Card>
      <AuditModal id={open} api={api} onClose={() => setOpen(null)} />
    </div>
  )
}

function AuditModal({ id, api, onClose }) {
  const navigate = useNavigate()
  const q = useQuery(() => (id ? api.get(`/api/admin/portal/audit-logs/${id}`) : Promise.resolve(null)), [api, id])
  const r = q.data
  const target = actionTarget(r?.human_action)
  const userTarget = target && /^[cur]-\d+$/.test(target) ? target : null
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={`Audit entry #${id || ''}`}
      footer={<>
        {userTarget && <Button variant="secondary" onClick={() => navigate(`/admin/users?user=${userTarget}`)}>Open user</Button>}
        {r?.candidate_id && !userTarget && <Button variant="secondary" onClick={() => navigate(`/admin/users?user=c-${r.candidate_id}`)}>Open candidate</Button>}
        {r?.job_id && <Button variant="secondary" onClick={() => navigate(`/admin/jobs?open=${r.job_id}`)}>Open job</Button>}
        <Button onClick={onClose}>Close</Button>
      </>}>
      {q.loading && !r && <Skeleton h={160} />}
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      {r && (
        <div className="cl-stack" style={{ gap: 16 }}>
          <KV wide rows={[
            ['Time', fmtDateTime(r.created_at)], ['Event type', statusLabel(r.event_type)], ['Action', r.human_action], ['Actor', r.human_reviewer || 'System'],
            ['Confirmed at', r.human_confirmed_at && fmtDateTime(r.human_confirmed_at)], ['Candidate', r.candidate], ['Job', r.job], ['Application', r.application_id && `#${r.application_id}`],
            ['ATS score', r.ats_score], ['Baseline ATS', r.baseline_ats_score], ['Final score', r.final_score], ['Project score', r.project_score],
            ['Semantic similarity', r.semantic_similarity], ['Keyword coverage', r.keyword_coverage], ['Risk', r.risk_level && `${r.risk_level}${r.risk_score != null ? ` (${r.risk_score})` : ''}`],
            ['Recommendation', r.final_recommendation],
            ['Matched skills', r.matched_skills?.length ? r.matched_skills.join(', ') : null], ['Missing skills', r.missing_skills?.length ? r.missing_skills.join(', ') : null],
            ['AI providers', Array.isArray(r.llm_providers_consulted) ? r.llm_providers_consulted.join(', ') : r.llm_providers_consulted && typeof r.llm_providers_consulted === 'object' ? JSON.stringify(r.llm_providers_consulted) : r.llm_providers_consulted],
          ].filter(([, v]) => v != null && v !== '')} />
          {r.raw_verdicts != null && (
            <div>
              <h4 className="adm-section-title">Recorded details</h4>
              <pre className="adm-pre">{typeof r.raw_verdicts === 'string' ? r.raw_verdicts : JSON.stringify(r.raw_verdicts, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
