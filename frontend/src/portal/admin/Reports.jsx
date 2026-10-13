import React, { useState } from 'react'
import { UserPlus, Building2, Briefcase, FileText, UsersRound, Download, Users, Handshake } from 'lucide-react'
import { Alert, Button, Card, LineChart, PageHeader, Skeleton, StatTile, downloadCsv, pct, useToast } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { ChartLegend, GroupedBars, HBars } from './components/AdminCharts.jsx'
import { DateRangePicker, defaultRange, fmtNum, qs } from './components/adminKit.jsx'

const REPORTS = [
  { kind: 'users', icon: Users, title: 'Users', text: 'Accounts that joined in the range — type, college / company, branch, verification and status.' },
  { kind: 'companies', icon: Building2, title: 'Companies', text: 'Employers registered in the range with recruiters, job postings and applications.' },
  { kind: 'jobs', icon: Briefcase, title: 'Job postings', text: 'Jobs posted in the range with branch, location, status and application counts.' },
  { kind: 'applications', icon: FileText, title: 'Applications', text: 'Applications submitted in the range with candidate, job, pipeline status and scores.' },
  { kind: 'hires', icon: Handshake, title: 'Hires', text: 'Offers accepted or joined in the range with compensation and joining dates.' },
]

const delta = (k) => (k ? { delta: k.change == null ? (k.new ? `+${fmtNum(k.new)}` : '0') : k.change, deltaDir: k.change != null && k.change < 0 ? 'down' : 'up', deltaNote: k.change == null ? 'new this range' : 'vs previous range' } : {})

export default function AdminReports() {
  const api = useApi('admin')
  const toast = useToast()
  const [range, setRange] = useState(defaultRange)
  const [busy, setBusy] = useState(null)
  const ov = useQuery(() => api.get(`/api/admin/portal/overview${qs({ start: range.start, end: range.end })}`), [api, range.start, range.end])
  const d = ov.data
  const k = d?.kpis

  const download = async (kind) => {
    setBusy(kind)
    try {
      const r = await api.get(`/api/admin/portal/reports/${kind}${qs({ start: range.start, end: range.end })}`)
      if (!r.rows.length) { toast(`No ${kind} in this date range`, 'info'); return }
      downloadCsv(`corelink-${kind}-${r.range.start}_to_${r.range.end}.csv`, r.rows, r.columns)
      toast(`Downloaded ${r.rows.length} ${kind} row${r.rows.length === 1 ? '' : 's'}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }

  // pipeline conversion for the range, from real counts
  const funnel = k ? [
    { label: 'Applications', value: k.applications.new },
    { label: 'Hires', value: k.hires.new },
  ] : []

  return (
    <div className="adm-page">
      <PageHeader title="Reports & Analytics" subtitle="Platform growth and hiring outcomes for any date range, with CSV exports for offline analysis."
        actions={<DateRangePicker value={range} onChange={setRange} />} />
      {ov.error && <Alert tone="error">{ov.error.message}</Alert>}
      <div className="cl-grid cl-grid-5 cl-grid-kpi adm-kpis">
        <StatTile icon={UserPlus} value={k ? fmtNum(k.users.new) : <Skeleton h={24} w={50} />} label="New users" {...delta(k?.users)} />
        <StatTile icon={Building2} tone="purple" value={k ? fmtNum(k.companies.new) : <Skeleton h={24} w={50} />} label="New companies" {...delta(k?.companies)} />
        <StatTile icon={Briefcase} tone="green" value={k ? fmtNum(k.active_jobs.new) : <Skeleton h={24} w={50} />} label="Jobs posted" {...delta(k?.active_jobs)} />
        <StatTile icon={FileText} tone="amber" value={k ? fmtNum(k.applications.new) : <Skeleton h={24} w={50} />} label="Applications" {...delta(k?.applications)} />
        <StatTile icon={UsersRound} tone="red" value={k ? fmtNum(k.hires.new) : <Skeleton h={24} w={50} />} label="Hires" {...delta(k?.hires)} />
      </div>

      <div className="adm-dash-row3">
        <Card title="User Growth" subtitle="Cumulative accounts">
          <ChartLegend items={[{ label: 'Candidates', color: '#2563eb' }, { label: 'Recruiters', color: '#10b981' }]} />
          {d ? <LineChart height={190} labels={d.user_growth.labels} series={[{ name: 'Candidates', color: '#2563eb', values: d.user_growth.candidates }, { name: 'Recruiters', color: '#10b981', values: d.user_growth.recruiters }]} /> : <Skeleton h={190} />}
        </Card>
        <Card title="Job Postings" subtitle="New vs active per month">
          <ChartLegend items={[{ label: 'New Jobs', color: '#7fb0ff' }, { label: 'Active Jobs', color: '#2563eb' }]} />
          {d ? <GroupedBars height={190} labels={d.jobs_trend.labels} series={[{ name: 'New Jobs', color: '#7fb0ff', values: d.jobs_trend.new_jobs }, { name: 'Active Jobs', color: '#2563eb', values: d.jobs_trend.active_jobs }]} /> : <Skeleton h={190} />}
        </Card>
        <Card title="Applications" subtitle="Submitted per month">
          <div className="adm-chart-legend" aria-hidden="true">&nbsp;</div>
          {d ? <LineChart height={190} labels={d.applications_trend.labels} series={[{ name: 'Applications', color: '#7c3aed', values: d.applications_trend.applications }]} /> : <Skeleton h={190} />}
        </Card>
      </div>

      <div className="adm-reports-grid">
        <Card title="Candidates by Branch" subtitle="All registered students">
          {d ? <HBars rows={d.branches} /> : <Skeleton h={200} />}
        </Card>
        <Card title="Hiring Outcome" subtitle="In the selected range">
          {!k ? <Skeleton h={200} /> : (
            <div className="cl-stack" style={{ gap: 14 }}>
              {funnel.map((f) => (
                <div key={f.label} className="adm-funnel">
                  <span>{f.label}</span>
                  <strong>{fmtNum(f.value)}</strong>
                </div>
              ))}
              <div className="adm-funnel total"><span>Applications → hire</span><strong>{k.applications.new ? `${pct(k.hires.new, k.applications.new)}%` : '—'}</strong></div>
              <p className="cl-muted" style={{ fontSize: 12.5 }}>Hires are offers accepted or joined during the range; they may come from applications submitted earlier.</p>
            </div>
          )}
        </Card>
        <Card title="Download Reports" subtitle={d ? `${d.range.start} to ${d.range.end}` : 'CSV, for the selected date range'}>
          <div>
            {REPORTS.map((r) => (
              <div key={r.kind} className="adm-report-row">
                <span className="cl-ico"><r.icon size={18} /></span>
                <div><strong>{r.title}</strong><small>{r.text}</small></div>
                <Button size="sm" variant="secondary" icon={Download} loading={busy === r.kind} onClick={() => download(r.kind)} aria-label={`Download ${r.title} CSV`}>CSV</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
