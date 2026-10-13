import React, { useMemo, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, BarChart3, CalendarCheck, Clock, Download, FileText, Lightbulb, Send, UserCheck, Users,
} from 'lucide-react'
import {
  Alert, BarChart, Button, Card, DemoTag, Donut, EmptyState, LineChart, Modal, PALETTE, PageHeader, Select, Skeleton, StatTile, downloadCsv, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { DateRangePicker, H, HBars, HLegend, PipeBars, branchInfo, dayKey, fmtDay, todayKey } from './components/HiringCommon.jsx'

const KPI_META = {
  applications: { icon: FileText, tone: '' }, shortlisted: { icon: UserCheck, tone: 'green' }, interviews: { icon: CalendarCheck, tone: 'orange' },
  offers: { icon: Send, tone: 'red' }, hired: { icon: Users, tone: 'green' }, time_to_hire: { icon: Clock, tone: '' },
}
const PIPE_COLORS = ['#2563eb', '#60a5fa', '#60a5fa', '#10b981', '#059669']
const TTH_COLORS = ['#60a5fa', '#6ee7b7', '#fcd34d', '#c4b5fd', '#fdba74', '#f87171', '#67e8f9', '#f9a8d4']
const ymd = (d) => dayKey(d)
const PRESETS = [
  { label: 'Last 30 days', range: () => ({ start: ymd(Date.now() - 29 * 864e5), end: todayKey() }) },
  { label: 'Last 90 days', range: () => ({ start: ymd(Date.now() - 89 * 864e5), end: todayKey() }) },
  { label: 'Last 6 months', range: () => { const d = new Date(); return { start: ymd(new Date(d.getFullYear(), d.getMonth() - 5, 1)), end: todayKey() } } },
  { label: 'This year', range: () => ({ start: `${new Date().getFullYear()}-01-01`, end: todayKey() }) },
  { label: 'Last 12 months', range: () => ({ start: ymd(Date.now() - 364 * 864e5), end: todayKey() }) },
]
/** Illustrative split shown only when there are no applications at all in the period. */
const SAMPLE_SOURCES = [
  { label: 'CoreLink', value: 136 }, { label: 'Campus Drive', value: 91 }, { label: 'Referral', value: 49 }, { label: 'Job Portal', value: 32 }, { label: 'Others', value: 16 },
]
const short = (s, n = 12) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default function Analytics() {
  const api = useApi('recruiter')
  const toast = useToast()
  const [range, setRange] = useState(() => ({ ...PRESETS[1].range(), label: PRESETS[1].label }))
  const [gran, setGran] = useState('month')
  const [group, setGroup] = useState('role')
  const [jobId, setJobId] = useState('')
  const [collegesOpen, setCollegesOpen] = useState(false)
  const qs = new URLSearchParams({ start: range.start, end: range.end, granularity: gran, group, ...(jobId ? { job_id: jobId } : {}) }).toString()
  const q = useQuery(() => api.get(`${H}/analytics?${qs}`), [api, qs])
  const d = q.data

  const branchSeg = useMemo(() => (d?.branches || []).map((b, i) => {
    const info = ['Others', 'Other', 'Computer Science'].includes(b.label) ? null : branchInfo(b.label)
    return { ...b, color: info && info.label !== '—' ? info.color : PALETTE[(i + 3) % PALETTE.length] }
  }), [d])
  const appTotal = d?.kpis?.[0]?.value || 0
  const acc = d?.offer_acceptance
  const accSeg = acc ? [
    { label: 'Accepted', value: acc.accepted, color: '#10b981' }, { label: 'Declined', value: acc.declined, color: '#ef4444' },
    { label: 'Negotiation', value: acc.negotiation + acc.pending, color: '#f59e0b' }, { label: 'Withdrawn', value: acc.withdrawn, color: '#475569' },
  ] : []
  const sourcesReal = (d?.sources || []).filter((s) => s.value > 0)
  const sourceDemo = d && sourcesReal.length === 0
  const sourceSeg = (sourceDemo ? SAMPLE_SOURCES : sourcesReal).map((s, i) => ({ ...s, color: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'][i % 5] }))
  const collegesTop = (d?.colleges || []).slice(0, 8)
  const collegesOther = (d?.colleges || []).slice(8).reduce((a, c) => a + c.value, 0)

  function exportReport() {
    if (!d) return
    const rows = []
    const push = (section, metric, value, extra = '') => rows.push({ section, metric, value, extra })
    push('Range', 'Start', fmtDay(range.start)); push('Range', 'End', fmtDay(range.end))
    d.kpis.forEach((k) => push('KPIs', k.label, k.value ?? '', k.delta != null ? `${k.delta}% vs previous period` : ''))
    d.trend.forEach((t) => push(`Application trend (${gran})`, t.label, t.value))
    d.pipeline.forEach((p) => push('Pipeline conversion', p.label, p.value, `${p.pct}%`))
    d.time_to_hire.forEach((t) => push(`Time to hire (by ${group})`, t.label, t.value, `${t.hires} hires`))
    d.branches.forEach((b) => push('Applications by branch', b.label, b.value))
    d.colleges.forEach((c) => push('Applications by college', c.label, c.value))
    Object.entries(d.offer_acceptance).forEach(([k, v]) => push('Offer acceptance', k, v))
    d.locations.forEach((l) => push('Applications by location', l.label, l.value))
    sourcesReal.forEach((s) => push('Candidate source', s.label, s.value))
    d.insights.forEach((i) => push('Insights', i.title, '', i.text))
    downloadCsv(`corelink-analytics-${range.start}-to-${range.end}.csv`, rows, ['section', 'metric', 'value', 'extra'])
    toast('Report exported as CSV', 'success')
  }

  return (
    <div className="hr-page">
      <PageHeader
        title="Analytics"
        subtitle="Track your hiring performance, candidate pipeline, and key recruitment metrics across all engineering roles."
        actions={<div className="hr-an-head">
          <DateRangePicker value={range} onChange={(r) => r.start && setRange(r)} presets={PRESETS} />
          <Button icon={Download} onClick={exportReport} disabled={!d}>Export Report</Button>
        </div>}
      />
      {q.error && <Alert tone="error">{q.error.message} <button type="button" className="cl-link" onClick={q.reload}>Retry</button></Alert>}

      <div className="hr-kpis k6">
        {!d ? Array.from({ length: 6 }, (_, i) => <div key={i} className="cl-card"><Skeleton h={58} /></div>) : d.kpis.map((k) => {
          return (
            <StatTile key={k.key} icon={KPI_META[k.key]?.icon} tone={KPI_META[k.key]?.tone}
              value={k.value == null ? '—' : k.unit ? <>{k.value}<small style={{ fontSize: 13, fontWeight: 600, color: 'var(--cl-muted)' }}> {k.unit}</small></> : k.value.toLocaleString()}
              label={k.label} delta={k.delta} deltaNote="vs prev. period"
              deltaDir={k.delta == null ? undefined : (k.delta < 0 ? 'down' : 'up')} />
          )
        })}
      </div>

      <div className="hr-an-grid" style={{ marginTop: 16 }}>
        <Card title="Application Trend" action={<Select className="hr-head-select" value={gran} onChange={(e) => setGran(e.target.value)} aria-label="Trend granularity" options={[{ value: 'month', label: 'Monthly' }, { value: 'week', label: 'Weekly' }]} />}>
          {!d ? <Skeleton h={190} /> : d.trend.length < 2 && !d.trend.some((t) => t.value)
            ? <div className="hr-chart-empty">No applications in this period</div>
            : <LineChart series={[{ name: 'Applications', color: '#2563eb', values: d.trend.map((t) => t.value) }]} labels={d.trend.map((t, i) => (d.trend.length > 8 && i % 2 ? '' : t.label))} showValues={d.trend.length <= 8} height={200} />}
        </Card>

        <Card title="Hiring Pipeline Conversion">
          {!d ? <Skeleton h={190} /> : appTotal === 0 ? <div className="hr-chart-empty">No applications in this period</div>
            : <PipeBars rows={d.pipeline.map((p, i) => ({ ...p, color: PIPE_COLORS[i] }))} withPct base={d.pipeline[0].value} />}
        </Card>

        <Card title="Time to Hire" subtitle="Average days from application to accepted offer"
          action={<Select className="hr-head-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group time to hire" options={[{ value: 'role', label: 'By Job Role' }, { value: 'branch', label: 'By Branch' }]} />}>
          {!d ? <Skeleton h={190} /> : d.time_to_hire.length === 0
            ? <div className="hr-chart-empty">No accepted offers in this period</div>
            : <BarChart data={d.time_to_hire.map((t, i) => ({ label: short(t.label), value: t.value, color: TTH_COLORS[i % TTH_COLORS.length] }))} showValues height={200} />}
        </Card>

        <Card title="Applications by Engineering Branch">
          {!d ? <Skeleton h={170} /> : branchSeg.length === 0 ? <div className="hr-chart-empty">No applications in this period</div> : (
            <div className="hr-donut-row">
              <Donut segments={branchSeg} size={150} stroke={22} center={appTotal} sub="Applications" />
              <HLegend items={branchSeg} total={appTotal} pctFirst />
            </div>
          )}
        </Card>

        <Card title="Top Colleges (by Applications)" action={(d?.colleges || []).length > 8 ? <button type="button" className="cl-link" onClick={() => setCollegesOpen(true)}>View All</button> : null}>
          {!d ? <Skeleton h={170} /> : collegesTop.length === 0 ? <div className="hr-chart-empty">No applications in this period</div>
            : <HBars rows={[...collegesTop.map((c) => ({ ...c, color: '#3b82f6' })), ...(collegesOther ? [{ label: 'Others', value: collegesOther, color: '#94a3b8' }] : [])]} labelWidth={130} />}
        </Card>

        <Card title="Offer Acceptance Rate" subtitle="Offers made in this period">
          {!d ? <Skeleton h={170} /> : acc.total === 0 ? <div className="hr-chart-empty">No offers made in this period</div> : (
            <div className="hr-donut-row">
              <Donut segments={accSeg} size={150} stroke={22} center={`${acc.rate}%`} sub="Acceptance Rate" />
              <HLegend items={accSeg} total={acc.total} />
            </div>
          )}
        </Card>

        <Card title="Hiring by Location" subtitle="Applications by job location"
          action={<Select className="hr-head-select" style={{ maxWidth: 170 }} value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Filter location chart by job" placeholder="All Jobs" options={(d?.jobs || []).map((j) => ({ value: String(j.id), label: j.title }))} />}>
          {!d ? <Skeleton h={190} /> : d.locations.length === 0 ? <div className="hr-chart-empty">No applications for this selection</div>
            : <BarChart data={d.locations.map((l, i) => ({ label: short(l.label, 11), value: l.value, color: l.label === 'Other' ? '#cbd5e1' : ['#3b82f6', '#60a5fa', '#60a5fa', '#93c5fd', '#93c5fd'][i] || '#93c5fd' }))} showValues height={200} />}
        </Card>

        <Card title="Candidate Source" action={sourceDemo ? <DemoTag title="No applications in this period — illustrative split shown" /> : null}>
          {!d ? <Skeleton h={170} /> : (
            <>
              <div className="hr-donut-row">
                <Donut segments={sourceSeg} size={150} stroke={22} center={sourceDemo ? SAMPLE_SOURCES.reduce((a, s) => a + s.value, 0) : appTotal} sub="Applications" />
                <HLegend items={sourceSeg} pctFirst />
              </div>
              <p className="hr-small" style={{ marginTop: 10 }}>
                {sourceDemo ? 'Sample split for illustration — real sources appear once applications arrive.' : 'All applications currently arrive through CoreLink. Campus-drive and referral tracking is coming soon.'}
              </p>
            </>
          )}
        </Card>

        <Card title="Performance Insights">
          {!d ? <Skeleton h={170} /> : d.insights.length === 0 ? <EmptyState icon={Lightbulb} title="No insights yet" text="Insights appear once you have applications in the period." /> : d.insights.map((i) => {
            const I = i.tone === 'up' ? ArrowUpRight : i.tone === 'down' ? ArrowDownRight : BarChart3
            return (
              <div className="hr-insight" key={i.title}>
                <span className={`cl-ico ${i.tone === 'up' ? 'green' : i.tone === 'down' ? 'red' : ''}`} style={{ borderRadius: '50%' }}><I size={18} /></span>
                <div><strong>{i.title}</strong><small>{i.text}</small></div>
              </div>
            )
          })}
        </Card>
      </div>
      {d && <p className="hr-small" style={{ marginTop: 12 }}>Period {fmtDay(range.start)} – {fmtDay(range.end)}; changes compare with the previous {Math.round((new Date(d.range.end) - new Date(d.range.start)) / 864e5)} days.</p>}

      <Modal open={collegesOpen} onClose={() => setCollegesOpen(false)} title="Applications by college">
        <HBars rows={(d?.colleges || []).map((c) => ({ ...c, color: '#3b82f6' }))} labelWidth={180} />
      </Modal>
    </div>
  )
}
