import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, BrainCircuit, Briefcase, CalendarCheck, CalendarDays, Download, FileCheck2, FileText, Handshake, Bookmark,
  PlusSquare, Users, UserSearch, Sparkles, Award, ClipboardList, MessageSquare,
} from 'lucide-react'
import {
  Alert, Avatar, BarChart, Button, Card, Chip, Donut, EmptyState, Hero, Legend, Menu, ProgressRow, Select, Skeleton, ViewAll,
  timeAgo, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import ScheduleInterviewModal from './components/ScheduleInterviewModal.jsx'
import CandidateCompareModal from './components/CandidateCompareModal.jsx'
import DashboardSchedulePicker from './components/DashboardSchedulePicker.jsx'
import { API, Kpi, MatchPill, VerifiedTick, branchMeta, exportApplications, useAppActions, yearLine } from './components/RecruiterPipelineKit.jsx'

const CHIPS = [
  { id: 'ai', label: 'Recommended (AI)' },
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'eee', label: 'Electrical' },
  { id: 'ece', label: 'Electronics' },
  { id: 'civil', label: 'Civil' },
  { id: 'chemical', label: 'Chemical' },
  { id: 'aerospace', label: 'Aerospace' },
  { id: 'all', label: 'All Branches' },
]
const SHORT = { ece: 'Electronics', eee: 'Electrical', metallurgy: 'Metallurgy', software: 'CS / Software' }
const ACT_ICON = { application: FileText, status: Bookmark, interview: CalendarDays, offer: Handshake, project: Award, other: ClipboardList }
const ACT_TONE = { application: '', status: 'amber', interview: 'purple', offer: 'green', project: 'teal', other: '' }

export default function Dashboard() {
  const api = useApi('recruiter')
  const toast = useToast()
  const navigate = useNavigate()
  const [days, setDays] = useState(30)
  const { data, loading, error, reload } = useQuery(() => api.get(`${API}/overview?days=${days}`), [api, days])
  const [chip, setChip] = useState('ai')
  const [sel, setSel] = useState(new Set())
  const [schedule, setSchedule] = useState(null) // applications[] for ScheduleInterviewModal
  const [picker, setPicker] = useState(false)
  const [compare, setCompare] = useState(false)
  const [exporting, setExporting] = useState(false)
  const actions = useAppActions(api, () => reload())

  const top = useMemo(() => {
    const rows = data?.top_candidates || []
    if (chip === 'ai') return rows.slice(0, 5)
    if (chip === 'all') return rows.slice(0, 8)
    return rows.filter((r) => r.branch === chip).slice(0, 8)
  }, [data, chip])

  const trend = useMemo(() => {
    const t = data?.trend || []
    return t.map((d) => ({ label: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: d.count }))
  }, [data])
  const branchSegs = useMemo(() => (data?.branches || []).map((b) => {
    const m = branchMeta(b.branch)
    return { label: SHORT[m.id] || (m.id ? m.label : 'Other'), value: b.count, color: m.color }
  }), [data])
  const trendMax = Math.max(0, ...trend.map((t) => t.value))
  const totalCands = data?.kpis?.total_candidates?.value ?? 0

  async function downloadReport() {
    setExporting(true)
    try {
      const r = await api.get(`${API}/applications?page_size=500&sort=newest`)
      if (!r.items.length) { toast('No applications to export yet', 'info'); return }
      exportApplications(r.items, `applications-report-${new Date().toISOString().slice(0, 10)}.csv`)
      toast(`Downloaded ${r.items.length} applications`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }

  const selRows = (data?.top_candidates || []).filter((r) => sel.has(r.application_id))
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const k = data?.kpis

  return (
    <div className="cl-grid-main rp-page">
      <div className="cl-stack">
        <Hero
          src="/assets/images/crops/hero-recruiter-team.jpg"
          title={<h1>Find Top Engineering<br />Talent for Your Team</h1>}
          text="Connect with skilled and motivated engineering students and graduates from top colleges across India."
          actions={<>
            <Button size="lg" iconRight={ArrowRight} to="/recruiter/jobs/new">Post a Job</Button>
            <Button size="lg" variant="white" to="/recruiter/candidates?view=search">Search Candidates</Button>
          </>}
        />
        {error && <Alert tone="error">{error.message} <button className="cl-link" onClick={reload}>Retry</button></Alert>}
        <div className="cl-grid rp-kpis">
          <Kpi loading={loading && !data} icon={Users} label="Total Candidates" kpi={k?.total_candidates} />
          <Kpi loading={loading && !data} icon={FileText} label="Applications" kpi={k?.applications} />
          <Kpi loading={loading && !data} icon={Bookmark} tone="green" label="Shortlisted" kpi={k?.shortlisted} />
          <Kpi loading={loading && !data} icon={CalendarCheck} label="Interviews" kpi={k?.interviews} />
          <Kpi loading={loading && !data} icon={Handshake} tone="purple" label="Offers" kpi={k?.offers} />
        </div>

        <div className="rp-dash-charts">
          <Card title="Applications Trend" icon={Users}
            subtitle={data ? `${data.trend_total} in the last ${days} days${data.trend_previous_total ? ` · ${data.trend_previous_total} in the ${days} days before` : ''}` : undefined}
            action={<Select aria-label="Trend range" style={{ width: 'auto', minHeight: 34, padding: '4px 32px 4px 10px' }} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[{ value: '7', label: 'Last 7 Days' }, { value: '30', label: 'Last 30 Days' }, { value: '90', label: 'Last 90 Days' }]} />}>
            {loading && !data ? <Skeleton h={190} /> : <BarChart data={trend} height={200} color="#4f86f7" labelEvery={days === 7 ? 1 : days === 30 ? 5 : 15} yTicks={trendMax <= 5 ? 5 : 4} />}
          </Card>
          <Card title="Candidates by Branch" action={<ViewAll to="/recruiter/candidates" />}>
            {loading && !data ? <Skeleton h={160} /> : branchSegs.length ? (
              <div className="rp-donut-wrap">
                <Donut segments={branchSegs} size={150} stroke={18} center={totalCands.toLocaleString()} sub="Candidates" />
                <Legend items={branchSegs} showPct />
              </div>
            ) : <EmptyState title="No applicants yet" text="Branch mix appears once candidates apply." />}
          </Card>
        </div>

        <Card title="Top Matching Candidates" icon={Users} action={<ViewAll to="/recruiter/candidates?sort=match" />}>
          <div className="rp-chips" role="group" aria-label="Filter by branch">
            {CHIPS.map((c) => <Chip key={c.id} active={chip === c.id} onClick={() => setChip(c.id)}>{c.label}</Chip>)}
          </div>
          {sel.size > 0 && (
            <div className="rp-select-bar">
              <strong>{sel.size} selected</strong>
              <Button size="sm" variant="outline" disabled={sel.size > 3} title={sel.size > 3 ? 'Compare up to 3' : undefined} onClick={() => setCompare(true)}>Compare</Button>
              <Button size="sm" variant="outline" loading={actions.busy} onClick={async () => { await actions.bulk([...sel], 'shortlist'); setSel(new Set()) }}>Shortlist</Button>
              <Button size="sm" variant="outline" onClick={() => setSchedule(selRows)}>Schedule interviews</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
            </div>
          )}
          {loading && !data ? <Skeleton h={220} /> : top.length === 0 ? (
            <EmptyState icon={UserSearch} title={chip === 'ai' || chip === 'all' ? 'No candidates yet' : `No ${CHIPS.find((c) => c.id === chip)?.label} applicants yet`}
              text="Candidates who apply to your jobs are ranked here by AI match score."
              action={<Button size="sm" variant="outline" to="/recruiter/candidates?view=search">Find candidates</Button>} />
          ) : (
            <div role="list">
              {top.map((r) => {
                const b = branchMeta(r.branch)
                return (
                  <div className="rp-match-row" role="listitem" key={r.application_id}>
                    <input type="checkbox" className="cl-check" aria-label={`Select ${r.candidate_name}`} checked={sel.has(r.application_id)} onChange={() => toggle(r.application_id)} />
                    <div className="rp-person">
                      <Avatar name={r.candidate_name} src={r.avatar_path} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <strong>{r.candidate_name}<VerifiedTick show={r.verified} /></strong>
                        <small className="cl-ellipsis">{r.college || '—'}</small>
                      </div>
                    </div>
                    <div className="branch"><div className="cl-ellipsis">{b.id ? b.long : '—'}</div><small>{yearLine(r) || r.job_title}</small></div>
                    <div className="rp-skill-chips">{(r.top_skills || []).map((s) => <span key={s} className="cl-chip soft">{s}</span>)}</div>
                    <div className="rp-match-cell"><MatchPill value={r.match} suffix=" Match" /></div>
                    <Button className="rp-view" size="sm" variant="outline" to={`/recruiter/candidates?id=${r.candidate_id}`}>View Profile</Button>
                    <div className="rp-kebab">
                      <Menu label={`Actions for ${r.candidate_name}`} items={[
                        { label: r.stage === 'under_review' ? 'Shortlist' : 'Already shortlisted', icon: Bookmark, disabled: r.stage !== 'under_review', onClick: () => actions.bulk([r.application_id], 'shortlist') },
                        { label: 'Schedule Interview', icon: CalendarDays, onClick: () => setSchedule([r]) },
                        { label: 'View application', icon: FileCheck2, to: `/recruiter/applications?job=${r.job_id}` },
                      ]} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="cl-stack">
        <Card title="Quick Actions">
          <div className="rp-qa">
            <button type="button" className="rp-qa-btn" onClick={() => navigate('/recruiter/jobs/new')}><PlusSquare size={24} /><span>Post a Job</span></button>
            <button type="button" className="rp-qa-btn" onClick={() => navigate('/recruiter/candidates?view=search')}><Users size={24} /><span>Search Candidates</span></button>
            <button type="button" className="rp-qa-btn" onClick={() => navigate('/recruiter/jobs')}><Briefcase size={24} /><span>Manage Jobs</span></button>
            <button type="button" className="rp-qa-btn" onClick={() => navigate('/recruiter/applications')}><FileText size={24} /><span>View Applications</span></button>
            <button type="button" className="rp-qa-btn" onClick={() => setPicker(true)}><CalendarDays size={24} /><span>Schedule Interviews</span></button>
            <button type="button" className="rp-qa-btn" onClick={downloadReport} disabled={exporting} aria-busy={exporting}><Download size={24} /><span>{exporting ? 'Preparing…' : 'Download Reports'}</span></button>
          </div>
        </Card>

        <Card title="Recent Activity" action={<ViewAll to="/recruiter/applications" />}>
          {loading && !data ? <Skeleton h={180} /> : data?.activity?.length ? (
            <div className="cl-list rp-activity">
              {data.activity.slice(0, 5).map((a, i) => {
                const I = ACT_ICON[a.kind] || MessageSquare
                return (
                  <div className="cl-list-item" key={i}>
                    <span className={`cl-ico ${ACT_TONE[a.kind] || ''}`}><I size={18} /></span>
                    <div className="cl-grow"><div>{a.title}</div>{a.sub && <small>{a.sub}</small>}</div>
                    <time dateTime={a.at}>{timeAgo(a.at)}</time>
                  </div>
                )
              })}
            </div>
          ) : <EmptyState title="No activity yet" text="New applications, decisions and interviews appear here." />}
        </Card>

        <Card title="Top Skills in Demand" action={<ViewAll to="/recruiter/jobs" />} subtitle={data ? `Share of your ${data.top_skills.open_jobs} open job${data.top_skills.open_jobs === 1 ? '' : 's'} requiring each skill` : undefined}>
          {loading && !data ? <Skeleton h={160} /> : data?.top_skills?.skills?.length ? (
            data.top_skills.skills.map((s) => <ProgressRow key={s.skill} label={s.skill} value={s.pct} />)
          ) : <EmptyState title="No open jobs" text="Publish a job with required skills to see demand." />}
        </Card>

        <Card className="rp-ai-card" title="Get Better Matches with AI" icon={BrainCircuit}>
          <p className="cl-muted" style={{ marginBottom: 14 }}>Our AI ranks candidates across the platform by how well their skills match your open job requirements.</p>
          <Button block variant="outline" icon={Sparkles} iconRight={ArrowRight} to="/recruiter/candidates?view=search&sort=match">Try AI Matching</Button>
        </Card>
      </div>

      <ScheduleInterviewModal open={!!schedule} onClose={() => setSchedule(null)} applications={schedule || []} onScheduled={reload} />
      <DashboardSchedulePicker open={picker} onClose={() => setPicker(false)} options={data?.schedulable || []} onScheduled={reload} />
      <CandidateCompareModal open={compare} onClose={() => setCompare(false)} api={api} candidateIds={[...new Set(selRows.map((r) => r.candidate_id))]}
        onView={(id) => navigate(`/recruiter/candidates?id=${id}`)} />
    </div>
  )
}
