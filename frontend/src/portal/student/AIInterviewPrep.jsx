import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Home, Code2, Settings2, UserRound, ClipboardList, BarChart2, ChevronRight, Star, Building2, Lightbulb, Timer,
  MessageSquare, BookOpenCheck, Target, FileText, Gauge, Layers, AlertTriangle, CheckCircle2, Play, ListChecks, Crosshair,
} from 'lucide-react'
import {
  Alert, Button, Card, DataTable, EmptyState, Field, Hero, Input, LogoTile, Modal, Pagination, Progress, Ring, Select, Skeleton,
  StatusPill, Tabs, Textarea, ViewAll, fmtDate, fmtTime, usePagination,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { branchThumb } from '../../branding/branches.js'
import { useStudent } from './StudentShell.jsx'
import './components/student.css'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'technical', label: 'Technical Practice', icon: Code2 },
  { id: 'domain', label: 'Domain Questions', icon: Settings2 },
  { id: 'hr', label: 'HR Questions', icon: UserRound },
  { id: 'mock', label: 'Mock Interviews', icon: ClipboardList },
  { id: 'performance', label: 'Performance', icon: BarChart2 },
]
const KIND_LABEL = { technical: 'Technical', domain: 'Domain', hr: 'HR', mock: 'Mock' }
const KIND_ICON = { technical: Code2, domain: Settings2, hr: UserRound, mock: ClipboardList }
const KIND_TONE = { technical: '', domain: 'red', hr: '', mock: '' }
const LEVELS = ['Beginner', 'Intermediate', 'Intermediate', 'Advanced', 'All Levels']

const HR_TOPICS = ['HR Interview Preparation', 'Tell me about yourself', 'Teamwork & conflict', 'Strengths & weaknesses', 'Career goals & motivation']
const DIMS = [
  { key: 'technical_depth', label: 'Technical Knowledge' },
  { key: 'problem_solving', label: 'Problem Solving' },
  { key: 'communication', label: 'Communication' },
  { key: 'ownership_impact', label: 'Confidence & Impact' },
]
const TIPS = [
  { icon: Timer, text: 'Practice with a timer to improve speed.' },
  { icon: MessageSquare, text: 'Explain your thought process clearly.' },
  { icon: BookOpenCheck, text: 'Revise core subjects and project details.' },
  { icon: Target, text: 'Take mock interviews regularly.' },
]
const RANGES = [{ value: '7', label: 'Last 7 Days' }, { value: '30', label: 'Last 30 Days' }, { value: '90', label: 'Last 90 Days' }, { value: 'all', label: 'All Time' }]

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null)
const scoreTone = (s) => (s == null ? '' : s >= 75 ? 'green' : s >= 60 ? 'amber' : 'red')

function practiceUrl(kind, topic, company, questions) {
  const p = new URLSearchParams({ kind })
  if (topic) p.set('topic', topic)
  if (company) p.set('company', company)
  if (questions?.length) p.set('q', JSON.stringify(questions.slice(0, 8)))
  return `/candidate/practice?${p.toString()}`
}

export default function AIInterviewPrep() {
  const api = useApi('candidate')
  const navigate = useNavigate()
  const { branch } = useStudent()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview'
  const setTab = (t) => { const n = new URLSearchParams(params); if (t === 'overview') n.delete('tab'); else n.set('tab', t); setParams(n, { replace: true }) }
  const hist = useQuery(() => api.get('/api/interview/practice/history?limit=200'), [api])
  const companiesQ = useQuery(() => api.get('/api/student/companies'), [api])
  const [range, setRange] = useState('30')
  const [detail, setDetail] = useState(null)
  const [custom, setCustom] = useState(null) // kind for the custom-topic modal

  const sessions = hist.data?.sessions || []
  const completed = sessions.filter((s) => s.status === 'completed' && s.overall_score != null)
  const inRange = useMemo(() => {
    if (range === 'all') return completed
    const since = Date.now() - Number(range) * 86400000
    return completed.filter((s) => new Date(s.started_at).getTime() >= since)
  }, [completed, range])

  const topics = useMemo(() => {
    const t = branch.topics || []
    return {
      technical: t.map((x, i) => ({ topic: x, level: LEVELS[i % LEVELS.length] })),
      domain: (branch.domains || []).concat(branch.skills.slice(0, 3)).map((x, i) => ({ topic: x, level: LEVELS[(i + 1) % LEVELS.length] })),
      hr: HR_TOPICS.map((x, i) => ({ topic: x, level: i ? 'All Levels' : 'All Levels' })),
      mock: [{ topic: `${branch.long} — campus interview`, level: 'Mixed' }, { topic: `${branch.domains?.[0] || branch.label} role interview`, level: 'Intermediate' }, { topic: 'Final round (technical + HR)', level: 'Advanced' }],
    }
  }, [branch])

  // Readiness = recent completed sessions (last 10).
  const recent10 = completed.slice(0, 10)
  const readiness = avg(recent10.map((s) => s.overall_score))
  const dimPct = DIMS.map((d) => {
    const vals = recent10.map((s) => s.dimension_scores?.[d.key]).filter((v) => typeof v === 'number')
    return { ...d, value: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) : null }
  })
  const byTopic = useMemo(() => {
    const m = new Map()
    inRange.forEach((s) => { const k = s.topic || KIND_LABEL[s.kind]; m.set(k, [...(m.get(k) || []), s]) })
    return [...m.entries()].map(([topic, list]) => ({ topic, kind: list[0].kind, score: avg(list.map((s) => s.overall_score)), n: list.length }))
      .sort((a, b) => b.n - a.n)
  }, [inRange])
  const weak = byTopic.filter((t) => t.score < 70).sort((a, b) => a.score - b.score)
  const qPracticed = inRange.reduce((a, s) => a + (s.questions_answered || 0), 0)

  const start = (kind, topic, company) => navigate(practiceUrl(kind, topic, company))
  const recommended = [
    { kind: 'technical', topic: topics.technical[2]?.topic || topics.technical[0]?.topic, level: 'Beginner', img: branchThumb(branch, 0) },
    { kind: 'domain', topic: topics.domain[0]?.topic, level: 'Intermediate', img: branchThumb(branch, 1) },
    { kind: 'domain', topic: topics.technical[4]?.topic || topics.domain[1]?.topic, level: 'Intermediate', img: branchThumb(branch, 2) },
    { kind: 'hr', topic: 'HR Interview Preparation', level: 'All Levels', img: '/assets/images/crops/thumb-hr-panel.jpg' },
  ].filter((r) => r.topic)

  return (
    <div className="st-page">
      <div className="st-split">
        <div className="st-page">
          <Hero branch={branch} page="interview" title="AI Interview Preparation"
            text={`Practice, improve and crack your interviews with AI-powered mock interviews tailored for ${branch.long.toLowerCase()} roles.`}
            script={<>Practice Today<br />Build Tomorrow</>}
            actions={<Button variant="white" iconRight={ArrowRight} onClick={() => start('mock', topics.mock[0].topic)}>Start a Mock Interview</Button>} />

          <Card flush><div style={{ padding: '0 10px' }}><Tabs tabs={TABS} value={tab} onChange={setTab} className="st-profile-tabs st-app-tabs" /></div></Card>

          {hist.error && <Alert tone="error">{hist.error.message} <button className="cl-link" onClick={hist.reload}>Retry</button></Alert>}

          {tab === 'overview' && (
            <>
              <div className="cl-grid cl-grid-4">
                {[
                  { id: 'technical', title: 'Technical Practice', text: 'Practice core concepts, problem solving and tools.' },
                  { id: 'domain', title: 'Domain Questions', text: `${branch.label} and more domain-specific questions.` },
                  { id: 'hr', title: 'HR Questions', text: 'Common HR questions with structured feedback.' },
                  { id: 'mock', title: 'Mock Interviews', text: 'Realistic AI mock interviews with feedback and scoring.' },
                ].map((c) => {
                  const I = KIND_ICON[c.id]
                  return (
                    <button key={c.id} type="button" className="cl-card st-cat" onClick={() => setTab(c.id)}>
                      <span className="st-cat-head"><span className={`cl-ico ${KIND_TONE[c.id]}`}><I size={20} /></span>{c.title}</span>
                      <p>{c.text}</p>
                      <ChevronRight size={18} />
                    </button>
                  )
                })}
              </div>

              <Card title={<><Star size={20} style={{ color: 'var(--cl-blue)' }} />Recommended Practice for You</>} subtitle={`Based on your profile (${branch.long})`} action={<ViewAll onClick={() => setTab('technical')} />}>
                <div className="cl-grid cl-grid-4">
                  {recommended.map((r, i) => (
                    <div key={i} className="cl-media-card">
                      <div className="cl-media" style={{ aspectRatio: '16 / 9' }}>
                        <img src={r.img} alt="" loading="lazy" />
                        <span className={`st-tag ${r.kind === 'hr' ? 'purple' : r.kind === 'domain' ? 'green' : 'blue'}`} style={{ position: 'absolute', left: 10, top: 10 }}>{KIND_LABEL[r.kind]}</span>
                      </div>
                      <div className="cl-media-body" style={{ gap: 8 }}>
                        <strong style={{ color: 'var(--cl-ink)', fontSize: 14.5 }}>{r.topic}</strong>
                        <div className="cl-meta" style={{ fontSize: 12.5 }}><span><ListChecks size={13} /> 5 Questions</span><span><Gauge size={13} /> {r.level}</span></div>
                        <Button size="sm" block onClick={() => start(r.kind, r.topic)}>Start Practice</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <ProgressCard loading={hist.loading} range={range} setRange={setRange} inRange={inRange} byTopic={byTopic} weak={weak} qPracticed={qPracticed}
                onView={setDetail} onAll={() => setTab('performance')} onStart={() => start('mock', topics.mock[0].topic)} />
            </>
          )}

          {['technical', 'domain', 'hr', 'mock'].includes(tab) && (
            <TopicList kind={tab} items={topics[tab]} branch={branch} sessions={completed} onStart={start} onCustom={() => setCustom(tab)} />
          )}

          {tab === 'performance' && <HistoryTable loading={hist.loading} sessions={sessions} onView={setDetail} onStart={() => start('mock', topics.mock[0].topic)} />}
        </div>

        <div className="st-right">
          <Card title="Interview Readiness Score">
            {hist.loading ? <Skeleton h={150} /> : (
              <>
                <div className="cl-row" style={{ gap: 18 }}>
                  <Ring value={readiness || 0} size={128} stroke={12} color={readiness ? "var(--cl-green)" : "transparent"} label={readiness ?? '—'} sub="/100" />
                  <ul className="cl-check-list cl-grow" style={{ gap: 10, fontSize: 13.5 }}>
                    {dimPct.map((d) => (
                      <li key={d.key} style={{ justifyContent: 'space-between' }}>
                        <span className="cl-row" style={{ gap: 8 }}><span className={`st-check-dot ${d.value != null && d.value >= 60 ? 'ok' : 'todo'}`} style={d.value != null && d.value < 60 ? { background: 'var(--cl-red)' } : undefined}><CheckCircle2 size={11} /></span>{d.label}</span>
                        <b style={{ color: 'var(--cl-blue)' }}>{d.value != null ? `${d.value}%` : '–'}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <Alert>{readiness == null ? 'Complete a practice session to get your readiness score.' : readiness >= 75 ? 'Great progress — you are interview ready. Keep your streak going!' : 'You are on the right track! Keep practicing to improve your weak areas.'}</Alert>
              </>
            )}
          </Card>

          <Card title={<><Crosshair size={20} style={{ color: 'var(--cl-red)' }} />Focus Areas</>} action={weak.length > 3 ? <ViewAll onClick={() => setTab('performance')} /> : null}>
            {hist.loading ? <Skeleton h={120} /> : weak.length === 0 ? (
              <div className="cl-col" style={{ gap: 8 }}>
                <p className="cl-muted" style={{ fontSize: 13.5 }}>{completed.length ? 'No weak topics in this period — nice work.' : 'Your weak topics will show here after a few sessions. Suggested to start with:'}</p>
                {!completed.length && topics.technical.slice(0, 3).map((t) => (
                  <button key={t.topic} type="button" className="st-tip" style={{ width: '100%' }} onClick={() => start('technical', t.topic)}>
                    <span className="cl-ico"><Layers size={17} /></span><span style={{ textAlign: 'left', fontSize: 13.5 }}>{t.topic}</span><ChevronRight size={17} />
                  </button>
                ))}
              </div>
            ) : weak.slice(0, 3).map((w) => (
              <button key={w.topic} type="button" className="st-tip" style={{ width: '100%' }} onClick={() => start(w.kind === 'mock' ? 'technical' : w.kind, w.topic)}>
                <span className={`cl-ico ${w.score < 50 ? 'red' : 'amber'}`}><AlertTriangle size={17} /></span>
                <span style={{ textAlign: 'left' }}><b style={{ display: 'block', color: 'var(--cl-ink)', fontSize: 13.5, fontWeight: 600 }}>{w.topic}</b><small className="cl-muted">Average {w.score}% · practice again</small></span>
                <span className={`st-low ${w.score < 50 ? 'red' : 'amber'}`}>{w.score < 50 ? 'Low Score' : 'Needs Work'}</span>
              </button>
            ))}
          </Card>

          <Card title={<><Building2 size={20} style={{ color: 'var(--cl-blue)' }} />Practice by Company</>}>
            {companiesQ.loading ? <Skeleton h={110} /> : !companiesQ.data?.companies?.some((c) => c.name && c.name !== 'Company') ? <div className="st-empty-sm">No companies are hiring right now.</div> : (
              <div className="st-company-grid">
                {companiesQ.data.companies.filter((c) => c.name && c.name !== 'Company').slice(0, 6).map((c) => (
                  <button key={c.name} type="button" className="st-company-tile" title={`Mock interview in the style of ${c.name}`} onClick={() => start('mock', c.jobs?.[0]?.title || `${c.name} interview`, c.name)}>
                    <LogoTile name={c.name} src={c.logo} size={34} /><span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="cl-muted" style={{ fontSize: 13, marginTop: 10 }}>Get company-style mock interviews based on the roles they are hiring for.</p>
          </Card>

          <Card title={<><Lightbulb size={20} style={{ color: '#f5a524' }} />Tips for Better Performance</>} action={<ViewAll to="/candidate/resources?tab=interview" />}>
            {TIPS.map((t) => (
              <button key={t.text} type="button" className="st-tip" style={{ width: '100%' }} onClick={() => navigate('/candidate/resources?tab=interview')}>
                <span className="cl-ico"><t.icon size={17} /></span><span style={{ fontSize: 13.5, textAlign: 'left' }}>{t.text}</span><ChevronRight size={17} />
              </button>
            ))}
          </Card>
        </div>
      </div>

      <SessionDetail id={detail} onClose={() => setDetail(null)} onRetry={(s) => start(s.kind, s.topic, s.company)} />
      <CustomTopicModal kind={custom} onClose={() => setCustom(null)} onStart={(kind, topic, company, qs) => navigate(practiceUrl(kind, topic, company, qs))} />
    </div>
  )
}

function ProgressCard({ loading, range, setRange, inRange, byTopic, weak, qPracticed, onView, onAll, onStart }) {
  const stats = [
    { icon: FileText, tone: '', value: inRange.length, label: 'Practice Sessions' },
    { icon: Gauge, tone: 'green', value: inRange.length ? `${avg(inRange.map((s) => s.overall_score))}%` : '–', label: 'Average Score' },
    { icon: ListChecks, tone: 'purple', value: qPracticed, label: 'Questions Practiced' },
    { icon: AlertTriangle, tone: 'red', value: weak.length, label: 'Weak Topics' },
  ]
  return (
    <Card title={<><BarChart2 size={20} style={{ color: 'var(--cl-blue)' }} />Your Interview Prep Progress</>}
      action={<Select value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} aria-label="Time range" style={{ width: 'auto', minHeight: 34 }} />}>
      {loading ? <Skeleton h={200} /> : (
        <div className="cl-col" style={{ gap: 18 }}>
          <div className="cl-grid cl-grid-4">
            {stats.map((s) => (
              <div key={s.label} className="st-stat-mini" style={{ alignItems: 'center' }}>
                <span className={`cl-ico ${s.tone}`} style={{ borderRadius: '50%', width: 42, height: 42 }}><s.icon size={19} /></span>
                <div><b>{s.value}</b><small>{s.label}</small></div>
              </div>
            ))}
          </div>
          {inRange.length === 0 ? (
            <EmptyState icon={Play} title="No practice sessions in this period" text="Start a short 5-question session — you'll get a score and feedback right after." action={<Button size="sm" onClick={onStart}>Start practicing</Button>} />
          ) : (
            <div className="cl-grid cl-grid-2" style={{ gap: 22 }}>
              <div className="cl-col" style={{ gap: 10 }}>
                <h4 style={{ fontSize: 14.5 }}>Topic-wise Performance</h4>
                {byTopic.slice(0, 5).map((t, i) => (
                  <div key={t.topic} className="st-bar" style={{ gridTemplateColumns: 'minmax(110px, 1.3fr) minmax(70px, 1fr) 42px' }}>
                    <span className="cl-ellipsis" style={{ fontSize: 13 }}>{t.topic}</span>
                    <Progress value={t.score} color={['#2563eb', '#10b981', '#f5a524', '#7c3aed', '#3b82f6'][i % 5]} height={7} />
                    <b style={{ fontSize: 12.5, color: ['#2563eb', '#10b981', '#f5a524', '#7c3aed', '#3b82f6'][i % 5] }}>{t.score}%</b>
                  </div>
                ))}
              </div>
              <div className="cl-col" style={{ gap: 6 }}>
                <div className="cl-row" style={{ justifyContent: 'space-between' }}><h4 style={{ fontSize: 14.5 }}>Recent Practice Sessions</h4><ViewAll onClick={onAll} /></div>
                {inRange.slice(0, 3).map((s) => {
                  const I = KIND_ICON[s.kind] || Code2
                  return (
                    <div key={s.id} className="cl-row" style={{ gap: 10, padding: '6px 0' }}>
                      <span className={`cl-ico ${s.kind === 'hr' ? 'purple' : s.kind === 'domain' ? 'red' : ''}`} style={{ width: 32, height: 32 }}><I size={16} /></span>
                      <div className="cl-grow" style={{ minWidth: 0 }}>
                        <div className="cl-ellipsis" style={{ fontSize: 13.5, color: 'var(--cl-ink)' }}>{s.topic} – {KIND_LABEL[s.kind]}</div>
                        <small className="cl-muted">{fmtDate(s.started_at)}, {fmtTime(s.started_at)}</small>
                      </div>
                      <span className={`st-low ${scoreTone(s.overall_score)}`}>{s.overall_score}%</span>
                      <Button size="sm" variant="outline" onClick={() => onView(s.id)}>View</Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function TopicList({ kind, items, branch, sessions, onStart, onCustom }) {
  const I = KIND_ICON[kind]
  const intro = {
    technical: `Short spoken sessions on ${branch.long} fundamentals. Aria asks 5 questions, follows up like a real interviewer and scores your answers.`,
    domain: 'Applied, scenario-based questions on tools and domains recruiters hire for in your branch.',
    hr: 'Behavioural and motivation questions. Use the STAR structure: situation, task, action, result.',
    mock: 'A full campus-style interview: an intro, technical/domain questions and a behavioural question — with a score and feedback at the end.',
  }[kind]
  return (
    <Card title={<><I size={20} style={{ color: 'var(--cl-blue)' }} />{TABS.find((t) => t.id === kind).label}</>} subtitle={intro}
      action={<Button size="sm" variant="outline" onClick={onCustom}>Custom topic</Button>}>
      <div className="cl-grid cl-grid-2">
        {items.map((t, i) => {
          const done = sessions.filter((s) => s.kind === kind && s.topic === t.topic)
          const best = done.length ? Math.max(...done.map((s) => s.overall_score)) : null
          return (
            <div key={t.topic} className="st-mini-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <img src={kind === 'hr' ? '/assets/images/crops/thumb-hr-panel.jpg' : branchThumb(branch, i)} alt="" style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 10, flex: '0 0 auto' }} />
              <div className="cl-grow" style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', color: 'var(--cl-ink)', fontSize: 14.5 }}>{t.topic}</strong>
                <div className="cl-meta" style={{ fontSize: 12.5 }}><span><ListChecks size={13} /> 5 questions · ~10 min</span><span><Gauge size={13} /> {t.level}</span>{best != null && <span className={`st-low ${scoreTone(best)}`}>Best {best}%</span>}</div>
              </div>
              <Button size="sm" icon={Play} onClick={() => onStart(kind, t.topic)}>{done.length ? 'Again' : 'Start'}</Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function HistoryTable({ loading, sessions, onView, onStart }) {
  const [kind, setKind] = useState('')
  const rows = sessions.filter((s) => !kind || s.kind === kind)
  const pg = usePagination(rows, 10)
  const columns = [
    { key: 'topic', header: 'Topic', sortable: true, render: (s) => <span style={{ color: 'var(--cl-ink)', fontWeight: 600 }}>{s.topic}{s.company ? <small className="cl-muted" style={{ display: 'block', fontWeight: 400 }}>{s.company} style</small> : null}</span> },
    { key: 'kind', header: 'Type', sortable: true, render: (s) => <span className="st-tag blue">{KIND_LABEL[s.kind] || s.kind}</span> },
    { key: 'started_at', header: 'Date', sortable: true, render: (s) => `${fmtDate(s.started_at)}, ${fmtTime(s.started_at)}` },
    { key: 'answered', header: 'Answered', render: (s) => `${s.questions_answered}/${s.total_questions}` },
    { key: 'status', header: 'Status', render: (s) => <StatusPill status={s.status} dot={false} /> },
    { key: 'overall_score', header: 'Score', sortable: true, sortValue: (s) => s.overall_score ?? -1, render: (s) => (s.overall_score != null ? <span className={`st-low ${scoreTone(s.overall_score)}`}>{s.overall_score}%</span> : '–') },
    { key: 'act', header: '', align: 'right', render: (s) => <Button size="sm" variant="outline" onClick={() => onView(s.id)}>View</Button> },
  ]
  return (
    <Card title={<><BarChart2 size={20} style={{ color: 'var(--cl-blue)' }} />Practice History</>}
      action={<Select value={kind} onChange={(e) => { setKind(e.target.value); pg.setPage(1) }} placeholder="All types" options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} aria-label="Filter by type" style={{ width: 'auto', minHeight: 34 }} />}>
      <DataTable columns={columns} rows={pg.slice} loading={loading} 
        empty={<EmptyState icon={Play} title="No practice sessions yet" text="Your sessions, scores and feedback will be listed here." action={<Button size="sm" onClick={onStart}>Start a mock interview</Button>} />} />
      <Pagination page={pg.page} pages={pg.pages} total={pg.total} pageSize={pg.pageSize} setPage={pg.setPage} noun="sessions" />
    </Card>
  )
}

function SessionDetail({ id, onClose, onRetry }) {
  const api = useApi('candidate')
  const q = useQuery(() => (id ? api.get(`/api/interview/practice/sessions/${id}`) : Promise.resolve(null)), [api, id])
  if (!id) return null
  const s = q.data
  const ev = s?.evaluation
  return (
    <Modal open onClose={onClose} title={s ? `${s.topic} — ${KIND_LABEL[s.kind] || ''} practice` : 'Practice session'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button>{s && <Button icon={Play} onClick={() => onRetry(s)}>Practice again</Button>}</>}>
      {q.loading ? <Skeleton h={220} /> : q.error ? <Alert tone="error">{q.error.message}</Alert> : !s ? null : (
        <div className="cl-col" style={{ gap: 16 }}>
          <div className="cl-row cl-wrap" style={{ gap: 18 }}>
            <Ring value={ev?.overall_score || 0} size={110} stroke={10} color="var(--cl-green)" label={ev?.overall_score ?? '—'} sub="/100" />
            <div className="cl-col cl-grow" style={{ gap: 8, minWidth: 200 }}>
              <div className="cl-meta"><span>{fmtDate(s.started_at)}, {fmtTime(s.started_at)}</span><span>{s.questions_answered}/{s.total_questions} answered</span><StatusPill status={s.status} dot={false} /></div>
              {ev?.summary && <p style={{ fontSize: 14 }}>{ev.summary}</p>}
              {DIMS.filter((d) => typeof ev?.dimension_scores?.[d.key] === 'number').map((d) => (
                <div key={d.key} className="st-bar" style={{ gridTemplateColumns: 'minmax(120px, 1fr) minmax(70px, 1.2fr) 42px' }}>
                  <span style={{ fontSize: 13 }}>{d.label}</span><Progress value={ev.dimension_scores[d.key] * 10} height={7} /><b style={{ fontSize: 12.5 }}>{Math.round(ev.dimension_scores[d.key] * 10)}%</b>
                </div>
              ))}
            </div>
          </div>
          {(ev?.strengths?.length > 0 || ev?.concerns?.length > 0) && (
            <div className="cl-grid cl-grid-2">
              <div className="st-mini-card"><strong className="cl-row" style={{ gap: 6, color: 'var(--cl-green)' }}><CheckCircle2 size={16} /> Strengths</strong><ul className="st-steps">{(ev.strengths.length ? ev.strengths : ['Keep practicing to build strengths.']).map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div className="st-mini-card"><strong className="cl-row" style={{ gap: 6, color: 'var(--cl-amber)' }}><AlertTriangle size={16} /> To improve</strong><ul className="st-steps">{(ev.concerns.length ? ev.concerns : ['Nothing major — well done.']).map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          )}
          <div className="cl-col" style={{ gap: 10 }}>
            <h4>Questions & your answers</h4>
            {(s.qa || []).map((x, i) => (
              <div key={i} className="st-mini-card" style={{ gap: 6 }}>
                <strong style={{ color: 'var(--cl-ink)', fontSize: 14 }}>Q{i + 1}. {x.question}</strong>
                <p className="st-pre" style={{ fontSize: 13.5 }}>{x.answer || <em className="cl-muted">Not answered</em>}</p>
                {ev?.per_question?.find((p) => p.index === i) && <small className="cl-muted">Score {ev.per_question.find((p) => p.index === i).score}/10</small>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function CustomTopicModal({ kind, onClose, onStart }) {
  const [topic, setTopic] = useState('')
  const [company, setCompany] = useState('')
  const [questions, setQuestions] = useState('')
  const [err, setErr] = useState('')
  if (!kind) return null
  const go = () => {
    const t = topic.trim()
    if (t.length < 3) return setErr('Enter a topic of at least 3 characters.')
    const qs = questions.split('\n').map((x) => x.trim()).filter((x) => x.length >= 12).slice(0, 8)
    onStart(kind, t.slice(0, 120), company.trim().slice(0, 80), qs)
  }
  return (
    <Modal open onClose={onClose} title={`Custom ${KIND_LABEL[kind]} practice`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button icon={Play} onClick={go}>Start practice</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <Field label="Topic" error={err}><Input value={topic} onChange={(e) => { setTopic(e.target.value); setErr('') }} placeholder="e.g. Heat exchangers, Verilog FSMs, IS 456 beams" maxLength={120} autoFocus /></Field>
        <Field label="Company style (optional)"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. a company you are interviewing with" maxLength={80} /></Field>
        <Field label="Your own questions (optional)" hint="One per line, up to 8. Aria will ask these first."><Textarea rows={4} value={questions} onChange={(e) => setQuestions(e.target.value)} maxLength={2400} /></Field>
      </div>
    </Modal>
  )
}
