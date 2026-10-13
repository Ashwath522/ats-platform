import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  FileText, CheckCircle2, Users, Hourglass, XCircle, ClipboardCheck, Search, Filter, Eye, BarChart3, Bot, Upload, CalendarDays,
  Clock, Lightbulb, FileEdit, Cpu, CalendarCheck, ChevronRight, ArrowRight, MapPin, Video, Send, BadgeIndianRupee, X,
} from 'lucide-react'
import {
  Alert, Button, Card, DataTable, Donut, EmptyState, Field, Hero, Input, LogoTile, Menu, Modal, Pagination, Select, Skeleton,
  StatusPill, Tabs, ViewAll, fmtDate, fmtTime, usePagination, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useStudent } from './StudentShell.jsx'
import { ExplainabilityModal, JOB_TYPE_LABEL } from './components/shared.jsx'
import './components/student.css'

const KPI = [
  { key: 'total', label: 'Total Applications', icon: FileText, tone: 'blue', tab: 'all' },
  { key: 'shortlisted', label: 'Shortlisted', icon: CheckCircle2, tone: 'green', tab: 'shortlisted' },
  { key: 'interview_scheduled', label: 'Interview Scheduled', icon: Users, tone: 'blue', tab: 'interviews' },
  { key: 'under_review', label: 'Under Review', icon: Hourglass, tone: 'amber', tab: 'under_review' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, tone: 'red', tab: 'rejected' },
  { key: 'offer_received', label: 'Offer Received', icon: ClipboardCheck, tone: 'purple', tab: 'offers' },
]
const KPI_ICON_TONE = { blue: '', green: 'green', amber: 'amber', red: 'red', purple: 'purple' }

const TABS = [
  { id: 'all', label: 'All Applications' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'offers', label: 'Offers' },
  { id: 'rejected', label: 'Rejected' },
]
const TAB_MATCH = {
  all: () => true,
  under_review: (r) => r.status === 'under_review',
  shortlisted: (r) => r.status === 'shortlisted',
  interviews: (r) => r.status === 'interview_scheduled',
  offers: (r) => ['offer_received', 'accepted', 'declined'].includes(r.status),
  rejected: (r) => r.status === 'rejected',
}
const PROGRESS = [
  { key: 'under_review', label: 'Under Review', color: '#f5a524' },
  { key: 'shortlisted', label: 'Shortlisted', color: '#12b76a' },
  { key: 'interview_scheduled', label: 'Interview Scheduled', color: '#2563eb' },
  { key: 'offer_received', label: 'Offer Received', color: '#8b5cf6' },
  { key: 'rejected', label: 'Rejected', color: '#ef4444' },
]
const TIPS = [
  { icon: FileEdit, text: 'Tailor your resume for each application.', to: '/candidate/resume-skills' },
  { icon: Cpu, text: 'Prepare for common technical interview questions.', to: '/candidate/ai-interview' },
  { icon: CalendarCheck, text: 'Follow up after an interview to show interest.', to: '/candidate/resources?tab=career' },
]

/** Text for the "Next Step" column. */
function nextStepText(r) {
  const n = r.next_step || {}
  if (!n.label) return null
  if (n.kind === 'scheduled') return <>{n.label}<br /><span className="cl-muted">({fmtDate(n.date)})</span></>
  if (n.kind === 'join') return <>Join on<br /><span className="cl-muted">{fmtDate(n.date)}</span></>
  if (n.kind === 'offer') return <>Respond to offer{n.date ? <><br /><span className="cl-muted">Joining {fmtDate(n.date)}</span></> : null}</>
  return n.label
}

export default function Applications() {
  const api = useApi('candidate')
  const toast = useToast()
  const navigate = useNavigate()
  const { branch } = useStudent()
  const [params, setParams] = useSearchParams()
  const q = useQuery(() => api.get('/api/student/applications/overview'), [api])
  const [tab, setTab] = useState(params.get('tab') || 'all')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [type, setType] = useState('')
  const [sort, setSort] = useState('newest')
  const [viewing, setViewing] = useState(null)
  const [explain, setExplain] = useState(null)
  const [uploadFor, setUploadFor] = useState(null)

  const d = q.data
  const rows = d?.applications || []

  // Deep link (?app=ID) from the dashboard / notifications.
  useEffect(() => {
    const id = Number(params.get('app'))
    if (id && rows.length) {
      const hit = rows.find((r) => r.id === id)
      if (hit) setViewing(hit.id)
    }
  }, [params, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const out = rows.filter((r) => TAB_MATCH[tab](r)
      && (!type || r.job_type === type)
      && (!s || `${r.company} ${r.role} ${r.location}`.toLowerCase().includes(s)))
    if (sort === 'oldest') out.sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at)))
    else if (sort === 'company') out.sort((a, b) => a.company.localeCompare(b.company))
    return out
  }, [rows, tab, search, type, sort])
  const pg = usePagination(filtered, 10)
    const types = useMemo(() => [...new Set(rows.map((r) => r.job_type).filter(Boolean))], [rows])

  const current = rows.find((r) => r.id === viewing) || null
  const closeView = () => {
    setViewing(null)
    if (params.get('app')) { const n = new URLSearchParams(params); n.delete('app'); setParams(n, { replace: true }) }
  }

  const respond = async (offer, decision) => {
    if (decision === 'decline' && !window.confirm('Decline this offer? The recruiter will be notified and this cannot be undone.')) return
    try {
      await api.post(`/api/student/offers/${offer.id}/respond`, { decision })
      toast(decision === 'accept' ? 'Offer accepted — congratulations!' : 'Offer declined', 'success')
      q.reload()
    } catch (e) { toast(e.message, 'error') }
  }

  const actions = (r) => [
    { label: 'View details', icon: Eye, onClick: () => setViewing(r.id) },
    { label: 'Why this score?', icon: BarChart3, onClick: () => setExplain(r.id) },
    r.next_step?.kind === 'ai_interview' && { label: 'Take AI interview', icon: Bot, onClick: () => navigate(`/candidate/interview/${r.id}`) },
    r.can_upload_project && { label: 'Upload project for verification', icon: Upload, onClick: () => setUploadFor(r) },
    { label: 'View job posting', icon: FileText, onClick: () => navigate(`/candidate/opportunities?q=${encodeURIComponent(r.role)}`) },
  ]

  const columns = [
    { key: 'company', header: 'Company', sortable: true, render: (r) => <div className="cl-row" style={{ gap: 10 }}><LogoTile name={r.company} src={r.company_logo} size={34} /><span className="cl-ellipsis" style={{ maxWidth: 130, fontWeight: 600, color: 'var(--cl-ink)', fontSize: 13.5 }}>{r.company}</span></div> },
    { key: 'role', header: 'Role', sortable: true, render: (r) => <span style={{ color: 'var(--cl-ink)' }}>{r.role}</span> },
    { key: 'applied_at', header: 'Applied On', sortable: true, render: (r) => fmtDate(r.applied_at) },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} dot={false} /> },
    { key: 'next', header: 'Next Step', render: (r) => <span style={{ fontSize: 13.5 }}>{nextStepText(r) || '–'}</span> },
    {
      key: 'act', header: 'Actions', render: (r) => (
        <div className="cl-row" style={{ gap: 6 }}>
          <Button size="sm" variant="outline" onClick={() => setViewing(r.id)} aria-label={`View ${r.role} application`}>View</Button>
          <Menu label={`More actions for ${r.role}`} items={actions(r)} />
        </div>
      ),
    },
  ]

  const k = d?.kpis || {}
  const segments = PROGRESS.map((p) => ({ label: p.label, value: k[p.key] || 0, color: p.color }))
  const latest = rows[0]

  return (
    <div className="st-page">
      <div className="st-split">
        <div className="st-page">
          <Hero branch={branch} page="applications" title="My Applications" text="Track your progress, stay updated and never miss an opportunity." />

          <div className="st-kpis" role="group" aria-label="Application summary">
            {KPI.map((it) => (
              <button key={it.key} type="button" className={`st-kpi ${it.tone} ${tab === it.tab && it.tab !== 'all' ? 'active' : ''}`} onClick={() => { setTab(it.tab); pg.setPage(1) }}>
                <span className={`cl-ico ${KPI_ICON_TONE[it.tone]}`}><it.icon size={20} /></span>
                <span className="cl-grow" style={{ minWidth: 0 }}><b>{q.loading ? '–' : k[it.key] ?? 0}</b><small>{it.label}</small></span>
              </button>
            ))}
          </div>

          <Card flush>
            <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between', padding: '4px 14px 0', gap: 10 }}>
              <Tabs className="st-app-tabs" tabs={TABS} value={tab} onChange={(v) => { setTab(v); pg.setPage(1) }} />
              <div className="cl-row" style={{ gap: 8, padding: '8px 0' }}>
                <div style={{ width: 220, maxWidth: '100%' }}><Input icon={Search} type="search" value={search} onChange={(e) => { setSearch(e.target.value); pg.setPage(1) }} placeholder="Search applications…" aria-label="Search applications" maxLength={80} /></div>
                <Button variant={showFilters ? 'primary' : 'outline'} icon={Filter} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>Filter</Button>
              </div>
            </div>
            {showFilters && (
              <div className="cl-row cl-wrap" style={{ padding: '10px 16px', gap: 12, borderTop: '1px solid var(--cl-line-2)' }}>
                <Field label="Job type"><Select value={type} onChange={(e) => { setType(e.target.value); pg.setPage(1) }} placeholder="All types" options={types.map((t) => ({ value: t, label: JOB_TYPE_LABEL[t] || t }))} /></Field>
                <Field label="Sort by"><Select value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'company', label: 'Company (A–Z)' }]} /></Field>
                {(type || sort !== 'newest' || search) && <button type="button" className="cl-link" style={{ alignSelf: 'flex-end', marginBottom: 10 }} onClick={() => { setType(''); setSort('newest'); setSearch('') }}>Reset</button>}
              </div>
            )}
            <div style={{ padding: '6px 14px 14px' }}>
              {q.error && <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>}
              <DataTable columns={columns} rows={pg.slice} loading={q.loading}
                empty={rows.length === 0
                  ? <EmptyState icon={Send} title="No applications yet" text="Apply to an opportunity and track every step here." action={<Button size="sm" to="/candidate/opportunities">Find opportunities</Button>} />
                  : <EmptyState icon={Search} title="No applications match" text="Try another tab or clear the search." action={<Button size="sm" variant="outline" onClick={() => { setTab('all'); setSearch(''); setType('') }}>Show all</Button>} />} />
              <Pagination page={pg.page} pages={pg.pages} total={pg.total} pageSize={pg.pageSize} setPage={pg.setPage} setPageSize={pg.setPageSize} noun="applications" />
            </div>
          </Card>
        </div>

        <div className="st-right">
          <Card title="Application Progress">
            {q.loading ? <Skeleton h={150} /> : (
              <div className="cl-row" style={{ gap: 18, alignItems: 'center' }}>
                <Donut segments={segments} size={140} stroke={14} center={k.total || 0} sub="Applications" />
                <div className="cl-legend cl-grow">
                  {segments.map((s) => (
                    <button key={s.label} type="button" className="cl-legend-item st-legend-btn" onClick={() => { setTab(KPI.find((x) => x.label === s.label)?.tab || 'all'); pg.setPage(1) }}>
                      <i style={{ background: s.color }} /><span className="cl-ellipsis">{s.label}</span><span>{s.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Upcoming Interviews" action={d?.upcoming_interviews?.length > 2 ? <ViewAll onClick={() => { setTab('interviews'); pg.setPage(1) }} /> : null}>
            {q.loading ? <Skeleton h={120} /> : !d?.upcoming_interviews?.length ? (
              <div className="st-empty-sm"><CalendarDays size={22} /><br />No interviews scheduled yet. Keep practicing in <button className="cl-link" onClick={() => navigate('/candidate/ai-interview')}>AI Interview</button>.</div>
            ) : d.upcoming_interviews.slice(0, 3).map((iv) => (
              <div key={iv.id} className="st-iv">
                <div className="cl-col" style={{ alignItems: 'center', gap: 4 }}><LogoTile name={iv.company} src={iv.company_logo} size={52} /><small className="cl-muted cl-ellipsis" style={{ maxWidth: 76, fontSize: 11 }}>{iv.company}</small></div>
                <div className="cl-col" style={{ gap: 6, minWidth: 0 }}>
                  <strong style={{ color: 'var(--cl-ink)' }}>{iv.round_name}</strong>
                  <span className="cl-muted" style={{ fontSize: 13.5 }}>{iv.role}</span>
                  <div className="cl-meta"><span><CalendarDays size={14} /> {fmtDate(iv.starts_at)}</span><span><Clock size={14} /> {fmtTime(iv.starts_at)} – {fmtTime(iv.ends_at)}</span></div>
                  <div><Button size="sm" variant="outline" onClick={() => setViewing(iv.application_id)}>View Details</Button></div>
                </div>
              </div>
            ))}
          </Card>

          <Card title={<><Lightbulb size={20} style={{ color: '#f5a524' }} />Quick Tips</>} action={<ViewAll to="/candidate/resources" />}>
            {TIPS.map((t) => (
              <button key={t.text} type="button" className="st-tip" style={{ width: '100%' }} onClick={() => navigate(t.to)}>
                <span className="cl-ico"><t.icon size={17} /></span><span style={{ fontSize: 13.5, textAlign: 'left' }}>{t.text}</span><ChevronRight size={17} />
              </button>
            ))}
          </Card>

          <Card tint>
            <div className="cl-row" style={{ gap: 14, alignItems: 'flex-start' }}>
              <span className="cl-ico" style={{ width: 54, height: 54, borderRadius: 14 }}><ClipboardCheck size={28} /></span>
              <div className="cl-col" style={{ gap: 6 }}>
                <strong style={{ color: 'var(--cl-ink)', fontSize: 16 }}>AI Application Insights</strong>
                <span className="cl-muted" style={{ fontSize: 13.5 }}>See how your resume matched each role and what to improve to raise your success rate.</span>
                <div><Button size="sm" variant="outline" iconRight={ArrowRight} disabled={!latest} onClick={() => latest && setExplain(latest.id)}>View Insights</Button></div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <ApplicationModal app={current} onClose={closeView} onRespond={respond} onExplain={(id) => setExplain(id)} onUpload={(r) => { closeView(); setUploadFor(r) }} />
      <ExplainabilityModal appId={explain} onClose={() => setExplain(null)} />
      <ProjectUploadModal app={uploadFor} onClose={() => setUploadFor(null)} onDone={() => { setUploadFor(null); q.reload() }} />
    </div>
  )
}

const STEPS = ['Applied', 'Under Review', 'Shortlisted', 'Interview', 'Offer']
function stepIndex(r) {
  if (['offer_received', 'accepted', 'declined'].includes(r.status)) return 4
  if (r.status === 'interview_scheduled' || r.interview_status === 'completed') return 3
  if (r.status === 'shortlisted') return 2
  return 1
}

function ApplicationModal({ app, onClose, onRespond, onExplain, onUpload }) {
  const navigate = useNavigate()
  if (!app) return null
  const idx = stepIndex(app)
  const rejected = app.status === 'rejected'
  const offer = app.offer
  return (
    <Modal open onClose={onClose} title="Application details" size="lg"
      footer={<>
        <Button variant="ghost" icon={BarChart3} onClick={() => onExplain(app.id)}>Why this score?</Button>
        {app.can_upload_project && <Button variant="outline" icon={Upload} onClick={() => onUpload(app)}>Upload project</Button>}
        {app.next_step?.kind === 'ai_interview' && <Button icon={Bot} onClick={() => navigate(`/candidate/interview/${app.id}`)}>Take AI interview</Button>}
        <Button variant="outline" onClick={onClose}>Close</Button>
      </>}>
      <div className="cl-col" style={{ gap: 16 }}>
        <div className="cl-row" style={{ gap: 14 }}>
          <LogoTile name={app.company} src={app.company_logo} size={52} />
          <div className="cl-grow" style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 18 }}>{app.role}</h3>
            <div className="cl-meta"><span>{app.company}</span>{app.location && <span><MapPin size={14} /> {app.location}</span>}<span>Applied {fmtDate(app.applied_at)}</span></div>
          </div>
          <StatusPill status={app.status} dot={false} />
        </div>

        <ol className="st-timeline" aria-label="Application progress">
          {STEPS.map((s, i) => {
            const state = rejected && i >= idx ? (i === idx ? 'bad' : '') : i < idx ? 'done' : i === idx ? 'now' : ''
            return <li key={s} className={state}><span>{state === 'done' ? <CheckCircle2 size={16} /> : state === 'bad' ? <X size={14} /> : i + 1}</span>{rejected && i === idx ? 'Not selected' : s}</li>
          })}
        </ol>

        {app.ats_score != null && <div className="cl-row" style={{ gap: 8, fontSize: 14 }}><span className="cl-muted">Resume match score:</span><b style={{ color: 'var(--cl-ink)' }}>{Math.round(app.ats_score)}%</b></div>}
        {app.next_step?.label && <Alert>Next step: <b>{app.next_step.label}</b>{app.next_step.date && app.next_step.kind !== 'offer' ? ` — ${fmtDate(app.next_step.date)}` : ''}</Alert>}

        {app.interviews?.length > 0 && (
          <div className="cl-col" style={{ gap: 8 }}>
            <h4>Scheduled interviews</h4>
            {app.interviews.map((iv) => (
              <div key={iv.id} className="st-file-row">
                <span className="cl-ico">{iv.mode === 'online' ? <Video size={18} /> : <MapPin size={18} />}</span>
                <div className="cl-grow" style={{ minWidth: 0 }}>
                  <strong>{iv.round_name}</strong>
                  <small>{fmtDate(iv.starts_at)} · {fmtTime(iv.starts_at)} – {fmtTime(iv.ends_at)} · {iv.mode === 'online' ? 'Online' : iv.location || 'On-site'}</small>
                </div>
                {iv.meeting_link && <Button size="sm" href={iv.meeting_link}>Join</Button>}
              </div>
            ))}
          </div>
        )}

        {offer && (
          <div className="cl-card" style={{ padding: 16, background: '#faf7ff', borderColor: '#e3d7fb' }}>
            <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
              <h4 className="cl-row" style={{ gap: 8 }}><BadgeIndianRupee size={18} /> Offer letter</h4>
              <StatusPill status={offer.status === 'sent' ? 'offer_received' : offer.status} dot={false} />
            </div>
            <div className="cl-meta" style={{ margin: '8px 0' }}>
              {offer.ctc && <span>CTC <b style={{ color: 'var(--cl-ink)' }}>{offer.ctc}</b></span>}
              {offer.joining_date && <span>Joining {fmtDate(offer.joining_date)}</span>}
              {offer.offer_date && <span>Sent {fmtDate(offer.offer_date)}</span>}
            </div>
            {offer.letter_text && <div className="st-pre" style={{ maxHeight: 200, overflow: 'auto', background: '#fff', borderRadius: 10, padding: 12, border: '1px solid var(--cl-line)' }}>{offer.letter_text}</div>}
            {['sent', 'negotiation'].includes(offer.status) && (
              <div className="cl-row" style={{ gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
                <Button variant="danger" onClick={() => onRespond(offer, 'decline')}>Decline</Button>
                <Button icon={CheckCircle2} onClick={() => onRespond(offer, 'accept')}>Accept offer</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

const UPLOAD_EXT = ['.pdf', '.docx', '.zip', '.txt', '.py', '.js', '.ipynb', '.m', '.c', '.cpp', '.v', '.md']

function ProjectUploadModal({ app, onClose, onDone }) {
  const api = useApi('candidate')
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setFile(null); setErr('') }, [app])
  if (!app) return null
  const submit = async () => {
    if (!file) return setErr('Choose a project file (PDF, DOCX, ZIP or code).')
    if (file.size > 25 * 1024 * 1024) return setErr('File is larger than 25 MB.')
    setBusy(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('application_id', String(app.id))
      if (app.ats_score != null) fd.append('ats_score', String(app.ats_score))
      await api.post('/api/candidate/score-project', fd)
      toast('Project submitted for verification', 'success')
      onDone()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Upload project for verification"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Upload} loading={busy} onClick={submit}>Upload & verify</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p className="cl-muted" style={{ fontSize: 14 }}>Upload a project report or code for <b>{app.role}</b> at {app.company}. It is checked against the job requirements and shared with the recruiter.</p>
        <Field label="Project file" hint={`Accepted: ${UPLOAD_EXT.join(', ')} · max 25 MB`} error={err}>
          <input type="file" className="cl-input" accept={UPLOAD_EXT.join(',')} onChange={(e) => { setFile(e.target.files?.[0] || null); setErr('') }} />
        </Field>
      </div>
    </Modal>
  )
}
