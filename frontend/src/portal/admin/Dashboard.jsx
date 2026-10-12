import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Building2, Briefcase, FileText, UsersRound, CheckCircle2, Database, Server, Activity, Cpu, Flag, ShieldAlert, UserX, RefreshCw,
} from 'lucide-react'
import {
  Alert, Avatar, Button, Card, Donut, EmptyState, LineChart, LogoTile, PageHeader, Skeleton, StatTile, ViewAll, cx, fmtDate, timeAgo,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { ChartLegend, GroupedBars, HBars } from './components/AdminCharts.jsx'
import { AccountPill, CompanyPill, DateRangePicker, defaultRange, fmtDuration, fmtNum, kpiDelta, qs } from './components/adminKit.jsx'

const ROLE_COLORS = ['#2563eb', '#f6c343', '#ef4444', '#94a3b8']
const C_BLUE = '#2563eb'
const C_GREEN = '#10b981'
const C_PURPLE = '#7c3aed'

function GranSelect({ value, onChange, label }) {
  return (
    <select className="cl-select adm-gran" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} granularity`}>
      <option value="monthly">Monthly</option>
      <option value="weekly">Weekly</option>
    </select>
  )
}

export default function AdminDashboard() {
  const api = useApi('admin')
  const navigate = useNavigate()
  const [range, setRange] = useState(defaultRange)
  const [gran, setGran] = useState({ growth: 'monthly', jobs: 'monthly', apps: 'monthly' })
  const needWeekly = Object.values(gran).includes('weekly')

  const monthly = useQuery(() => api.get(`/api/admin/portal/overview${qs({ start: range.start, end: range.end, granularity: 'monthly' })}`), [api, range.start, range.end])
  const weekly = useQuery(
    () => (needWeekly ? api.get(`/api/admin/portal/overview${qs({ start: range.start, end: range.end, granularity: 'weekly' })}`) : Promise.resolve(null)),
    [api, range.start, range.end, needWeekly],
  )
  const d = monthly.data
  const pick = (k) => (gran[k] === 'weekly' ? weekly.data : d)

  const roleSegments = useMemo(() => (d?.users_by_role || []).map((r, i) => ({ ...r, color: ROLE_COLORS[i] })), [d])
  const k = d?.kpis

  return (
    <div className="adm-page">
      <PageHeader
        title="Platform Dashboard"
        subtitle="Overview of CoreLink platform activity, users, companies and hiring ecosystem."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />
      {monthly.error && <Alert tone="error">Could not load the dashboard: {monthly.error.message} <button type="button" className="cl-link" onClick={monthly.reload}>Retry</button></Alert>}

      <div className="cl-grid cl-grid-5 cl-grid-kpi adm-kpis">
        <StatTile icon={User} value={k ? fmtNum(k.users.value) : <Skeleton h={24} w={70} />} label="Total Users" {...kpiDelta(k?.users)} />
        <StatTile icon={Building2} tone="purple" value={k ? fmtNum(k.companies.value) : <Skeleton h={24} w={50} />} label="Registered Companies" {...kpiDelta(k?.companies)} />
        <StatTile icon={Briefcase} tone="green" value={k ? fmtNum(k.active_jobs.value) : <Skeleton h={24} w={50} />} label="Active Job Postings" {...kpiDelta(k?.active_jobs)} />
        <StatTile icon={FileText} tone="amber" value={k ? fmtNum(k.applications.value) : <Skeleton h={24} w={60} />} label="Total Applications" {...kpiDelta(k?.applications)} />
        <StatTile icon={UsersRound} tone="red" value={k ? fmtNum(k.hires.value) : <Skeleton h={24} w={40} />} label="Successful Hires" {...kpiDelta(k?.hires)} />
      </div>

      <div className="adm-dash-row3">
        <Card title="User Growth" action={<GranSelect label="User growth" value={gran.growth} onChange={(v) => setGran((g) => ({ ...g, growth: v }))} />}>
          <ChartLegend items={[{ label: 'Candidates', color: C_BLUE }, { label: 'Recruiters', color: C_GREEN }]} />
          {pick('growth') ? (
            <LineChart height={180} labels={pick('growth').user_growth.labels}
              series={[{ name: 'Candidates', color: C_BLUE, values: pick('growth').user_growth.candidates }, { name: 'Recruiters', color: C_GREEN, values: pick('growth').user_growth.recruiters }]} />
          ) : <Skeleton h={180} />}
          <p className="adm-chart-note">Cumulative accounts at the end of each {gran.growth === 'weekly' ? 'week' : 'month'}</p>
        </Card>
        <Card title="Job Postings Trend" action={<GranSelect label="Job postings" value={gran.jobs} onChange={(v) => setGran((g) => ({ ...g, jobs: v }))} />}>
          <ChartLegend items={[{ label: 'New Jobs', color: '#7fb0ff' }, { label: 'Active Jobs', color: C_BLUE }]} />
          {pick('jobs') ? (
            <GroupedBars height={180} labels={pick('jobs').jobs_trend.labels}
              series={[{ name: 'New Jobs', color: '#7fb0ff', values: pick('jobs').jobs_trend.new_jobs }, { name: 'Active Jobs', color: C_BLUE, values: pick('jobs').jobs_trend.active_jobs }]} />
          ) : <Skeleton h={180} />}
          <p className="adm-chart-note">Active = currently open jobs posted by the end of each period</p>
        </Card>
        <Card title="Applications Trend" action={<GranSelect label="Applications" value={gran.apps} onChange={(v) => setGran((g) => ({ ...g, apps: v }))} />}>
          <div className="adm-chart-legend" aria-hidden="true">&nbsp;</div>
          {pick('apps') ? (
            <LineChart height={180} labels={pick('apps').applications_trend.labels}
              series={[{ name: 'Applications', color: C_PURPLE, values: pick('apps').applications_trend.applications }]} />
          ) : <Skeleton h={180} />}
          <p className="adm-chart-note">Applications submitted per {gran.apps === 'weekly' ? 'week' : 'month'}</p>
        </Card>
      </div>

      <div className="adm-dash-row4">
        <Card title="Users by Role">
          {d ? (
            <div className="adm-donut-row">
              <Donut segments={roleSegments} size={170} stroke={26} center={fmtNum(d.total_users)} sub="Total Users" />
              <div className="adm-role-legend">
                {roleSegments.map((s) => (
                  <div key={s.label}>
                    <i style={{ background: s.color }} />
                    <span className="cl-ellipsis">{s.label}</span>
                    <strong>{fmtNum(s.value)}</strong>
                    <small>({d.total_users ? Math.round((s.value * 100) / d.total_users) : 0}%)</small>
                  </div>
                ))}
              </div>
            </div>
          ) : <Skeleton h={170} />}
        </Card>
        <Card title="Top Engineering Branches (Candidates)">
          {d ? <HBars rows={d.branches} /> : <Skeleton h={170} />}
        </Card>
        <Card title="Top Companies (by Job Postings)" action={<ViewAll to="/admin/companies" />}>
          {!d ? <Skeleton h={170} /> : d.top_companies.length === 0 ? <EmptyState icon={Building2} title="No job postings yet" /> : (
            <div className="adm-toplist">
              {d.top_companies.map((c) => (
                <button key={c.name} type="button" onClick={() => navigate(c.id ? `/admin/companies?open=${encodeURIComponent(c.id)}` : '/admin/companies')}>
                  <LogoTile name={c.name} size={26} />
                  <span className="cl-ellipsis">{c.name}</span>
                  <strong>{fmtNum(c.jobs)}</strong>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="adm-dash-row5">
        <Card title="Recent Company Registrations" action={<ViewAll to="/admin/companies" />} className="adm-tight">
          {!d ? <Skeleton h={160} /> : d.recent_companies.length === 0 ? <EmptyState icon={Building2} title="No companies registered yet" /> : (
            <div className="cl-table-wrap">
              <table className="cl-table cards adm-mini-table">
                <thead><tr><th>Company</th><th>Industry</th><th>Location</th><th>Registered On</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {d.recent_companies.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Company"><span className="cl-row" style={{ gap: 8 }}><LogoTile name={c.name} src={c.logo} size={26} /><strong className="cl-ellipsis adm-co-name">{c.name}</strong></span></td>
                      <td data-label="Industry" className="cl-muted adm-ind" title={c.industry || ''}>{c.industry || '—'}</td>
                      <td data-label="Location" className="cl-muted">{(c.location || '—').split(',')[0]}</td>
                      <td data-label="Registered On" className="cl-muted">{fmtDate(c.registered)}</td>
                      <td data-label="Status"><CompanyPill value={c.status} /></td>
                      <td data-label="Actions">
                        {c.status === 'pending'
                          ? <Button size="sm" variant="outline" to="/admin/moderation?tab=requests">Review</Button>
                          : <Button size="sm" variant="outline" to={`/admin/companies?open=${encodeURIComponent(c.id)}`}>View</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Recent User Signups" action={<ViewAll to="/admin/users" />} className="adm-tight">
          {!d ? <Skeleton h={160} /> : (
            <div className="cl-table-wrap">
              <table className="cl-table cards adm-mini-table">
                <thead><tr><th>Name</th><th>Role</th><th>Joined On</th><th>Status</th></tr></thead>
                <tbody>
                  {d.recent_signups.map((u) => (
                    <tr key={u.id} className="clickable" onClick={() => navigate(`/admin/users?user=${u.id}`)}>
                      <td data-label="Name"><span className="cl-row" style={{ gap: 8 }}><Avatar name={u.name} size={30} /><strong className="cl-ellipsis adm-co-name" style={{ maxWidth: 96 }}>{u.name}</strong></span></td>
                      <td data-label="Role" className="cl-muted">{u.type === 'candidate' ? 'Student' : u.type === 'admin' ? 'Admin' : 'Recruiter'}</td>
                      <td data-label="Joined On" className="cl-muted">{fmtDate(u.joined, { day: '2-digit', month: 'short' })}</td>
                      <td data-label="Status"><AccountPill value={u.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="cl-stack">
          <Card title="Platform Health" action={<button type="button" className="cl-icon-btn" aria-label="Refresh health" title="Refresh" onClick={monthly.reload}><RefreshCw size={16} /></button>}>
            {!d ? <Skeleton h={90} /> : <Health h={d.health} />}
          </Card>
          <Card title="Recent Reports / Flags" action={<ViewAll to="/admin/moderation?tab=flags" />}>
            {!d ? <Skeleton h={90} /> : d.flags.length === 0 ? (
              <div className="adm-allclear"><CheckCircle2 size={20} /> No open reports, risky recruiter requests or suspended accounts.</div>
            ) : (
              <div className="adm-flags">
                {d.flags.slice(0, 4).map((f) => {
                  const Icon = f.kind === 'suspended' ? UserX : f.kind === 'recruiter_request' ? ShieldAlert : Flag
                  return (
                    <button key={`${f.kind}-${f.id}`} type="button" className="adm-flag" onClick={() => navigate(f.link)}>
                      <span className={cx('adm-flag-ico', f.severity)}><Icon size={17} /></span>
                      <span className="cl-grow">
                        <strong>{f.title}</strong>
                        <small>{f.detail}</small>
                      </span>
                      <time>{timeAgo(f.at)}</time>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Health({ h }) {
  const ok = h.database.ok && h.email.failure_rate < 25
  const items = [
    { icon: CheckCircle2, tone: ok ? 'ok' : 'warn', label: ok ? 'All Systems Operational' : 'Degraded — check email / database', title: 'Database reachable and email failure rate under 25% in the last 7 days' },
    { icon: Database, tone: h.database.ok ? 'ok' : 'bad', label: `Database ${h.database.ok ? 'Healthy' : 'Unreachable'} · ${h.database.ping_ms} ms ping`, title: `${h.database.engine} — SELECT 1 round trip measured now` },
    { icon: Server, tone: 'ok', label: `API process uptime ${fmtDuration(h.uptime_seconds)}`, title: `Since the API process started at ${h.started_at}` },
    { icon: Activity, tone: 'ok', label: `Dashboard query ${h.overview_ms ?? '—'} ms`, title: 'Server time to compute this overview' },
  ]
  return (
    <div>
      <div className="adm-health">
        {items.map((it) => <div key={it.label} className={cx('adm-health-item', it.tone)} title={it.title}><it.icon size={18} /><span>{it.label}</span></div>)}
      </div>
      <div className="adm-health-sub">
        <span title="Outbound emails in the last 7 days">Email: {h.email.provider} · {h.email.failure_rate}% failed (7d)</span>
        <span><Cpu size={13} /> LLM: {h.llm_providers.length ? h.llm_providers.join(', ') : 'none configured'} · Embeddings: {h.embedding_backend || 'not loaded yet'}</span>
      </div>
    </div>
  )
}
