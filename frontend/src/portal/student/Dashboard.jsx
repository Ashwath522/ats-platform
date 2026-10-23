import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Box, Briefcase, MessageSquareText, User, FileCheck2, FolderKanban, Send, Check, Eye, BarChart3, Bot } from 'lucide-react'
import { Alert, Button, Card, DataTable, EmptyState, Hero, LogoTile, Menu, Progress, Ring, Skeleton, StatusPill, ViewAll, fmtDate } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useStudent } from './StudentShell.jsx'
import { JobMediaCard, JobDetailsModal, ExplainabilityModal, useSavedJobs } from './components/shared.jsx'
import FollowedCompanies from './components/FollowedCompanies.jsx'

const SHORTCUTS = [
  { to: '/candidate/resume-skills', title: 'My Resume', sub: 'Check & improve with AI', icon: FileText, tone: '' },
  { to: '/candidate/projects', title: 'My Projects', sub: 'Showcase your work', icon: Box, tone: 'green' },
  { to: '/candidate/opportunities', title: 'Find Opportunities', sub: 'Jobs & Internships', icon: Briefcase, tone: 'purple' },
  { to: '/candidate/ai-interview', title: 'AI Interview Prep', sub: 'Practice & Improve', icon: MessageSquareText, tone: 'orange', tint: true },
]

export function ResumeScoreCard({ insights, loading, profile }) {
  const bar = (k) => insights?.bars?.find((b) => b.key === k)?.score ?? 0
  const personalDone = profile?.completion?.items?.find((i) => i.key === 'personal')?.done
  const items = [
    { label: 'Profile Information', done: !!personalDone },
    { label: 'Skills & Keywords', done: bar('skills') >= 70 },
    { label: 'Projects', done: bar('projects') >= 70 },
    { label: 'Certifications', done: bar('certifications') >= 70 },
    { label: 'Overall Format', done: bar('format') >= 70 },
  ]
  return (
    <Card title="Resume Score" style={{ display: 'flex', flexDirection: 'column' }}>
      {loading ? <Skeleton h={140} /> : (
        <div className="st-score">
          <Ring value={insights?.score ?? 0} color={insights?.has_resume ? '#0b5cff' : 'transparent'} size={136} stroke={12} label={insights?.has_resume ? insights.score : '—'} sub="/100" />
          <ul className="cl-check-list cl-grow">
            {items.map((it) => (
              <li key={it.label}>
                <span className={`st-check-dot ${it.done ? 'ok' : 'todo'}`}><Check size={11} strokeWidth={3} /></span>
                <span className={it.done ? '' : 'cl-muted'}>{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!loading && !insights?.has_resume && <small className="cl-muted" style={{ marginTop: 10 }}>Upload your resume to get a score.</small>}
      <Button to="/candidate/resume-skills" block iconRight={ArrowRight} className="st-gradient-btn" style={{ marginTop: 16 }}>Improve with AI</Button>
    </Card>
  )
}

export default function Dashboard() {
  const api = useApi('candidate')
  const navigate = useNavigate()
  const { profile, branch, firstName } = useStudent()
  const dash = useQuery(() => api.get('/api/student/dashboard'), [api])
  const insights = useQuery(() => api.get('/api/student/resume/insights'), [api])
  const savedJobs = useSavedJobs()
  const [openJob, setOpenJob] = useState(null)
  const [explain, setExplain] = useState(null)

  const d = dash.data
  const p = d?.progress
  const progressRows = p ? [
    { label: 'Profile Completion', value: p.profile_completion, icon: User, tone: '', color: 'var(--cl-blue)' },
    { label: 'Resume Uploaded', value: p.resume_uploaded ? 100 : 0, icon: FileCheck2, tone: 'green', color: 'var(--cl-green)' },
    { label: `Projects Added (${p.projects}/${p.projects_target})`, value: Math.min(100, (p.projects * 100) / p.projects_target), icon: FolderKanban, tone: 'amber', color: '#f5a524' },
    { label: `Applications Sent (${p.applications}/${p.applications_target})`, value: Math.min(100, (p.applications * 100) / p.applications_target), icon: Send, tone: 'purple', color: 'var(--cl-purple)' },
  ] : []

  const columns = [
    { key: 'company', header: 'Company', render: (r) => <div className="cl-row"><LogoTile name={r.company} src={r.company_logo} size={30} /><strong style={{ color: 'var(--cl-ink)', fontWeight: 600 }}>{r.company}</strong></div>, sortable: true },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} dot={false} /> },
    { key: 'applied_at', header: 'Applied On', render: (r) => fmtDate(r.applied_at), sortable: true },
    {
      key: 'act', header: '', align: 'right', render: (r) => (
        <Menu label={`Actions for ${r.role}`} items={[
          { label: 'View application', icon: Eye, onClick: () => navigate(`/candidate/applications?app=${r.id}`) },
          { label: 'Why this score?', icon: BarChart3, onClick: () => setExplain(r.id) },
          r.interview_unlocked && { label: 'Take AI interview', icon: Bot, onClick: () => navigate(`/candidate/interview/${r.id}`) },
        ]} />
      ),
    },
  ]

  return (
    <div className="st-page">
      <div className="st-split stretch">
        <Hero
          tall
          branch={branch}
          page="dashboard"
          title={firstName && firstName !== 'There'
            ? <h1 className="st-hero-title"><small>Welcome back,</small><span>{firstName}</span></h1>
            : <h1 className="st-hero-title"><small>Welcome to CoreLink</small><span>Let’s get started</span></h1>}
          text="Continue building, learning and connecting with real opportunities."
          actions={<Button variant="white" to="/candidate/profile" iconRight={ArrowRight}>Update Profile</Button>}
        />
        <ResumeScoreCard insights={insights.data} loading={insights.loading} profile={profile} />
      </div>

      <nav className="st-shortcuts" aria-label="Shortcuts">
        {SHORTCUTS.map((s) => (
          <Link key={s.to} to={s.to} className={`st-shortcut ${s.tint ? 'tint-orange' : ''}`}>
            <span className={`cl-ico ${s.tone}`}><s.icon size={24} /></span>
            <span className="cl-grow"><strong>{s.title}</strong><small>{s.sub}</small></span>
            <span className="st-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
          </Link>
        ))}
      </nav>

      {dash.error && <Alert tone="error">{dash.error.message} <button className="cl-link" onClick={dash.reload}>Retry</button></Alert>}

      <div className="st-split">
        <Card title="Recommended Opportunities" action={<ViewAll to="/candidate/opportunities" />}>
          {dash.loading ? <div className="cl-grid cl-grid-3">{[0, 1, 2].map((i) => <Skeleton key={i} h={210} />)}</div>
            : d.recommended.length === 0 ? <EmptyState icon={Briefcase} title="No open roles yet" text="New opportunities will appear here as companies post them." />
              : (
                <div className="cl-grid cl-grid-3">
                  {d.recommended.map((j, i) => (
                    <JobMediaCard key={j.id} job={j} index={i} saved={savedJobs.saved.has(j.id)} onToggleSave={() => savedJobs.toggle(j.id)} onOpen={() => setOpenJob(j.id)} />
                  ))}
                </div>
              )}
        </Card>
        <Card title="Your Progress" action={<ViewAll to="/candidate/profile">View All</ViewAll>}>
          {dash.loading ? <Skeleton h={200} /> : progressRows.map((r) => (
            <div key={r.label} className="st-prog">
              <span className={`cl-ico ${r.tone}`}><r.icon size={18} /></span>
              <div>
                <div className="st-prog-top"><span>{r.label}</span><b style={{ color: r.color }}>{Math.round(r.value)}%</b></div>
                <Progress value={r.value} color={r.color} height={6} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <FollowedCompanies />

      <div className="st-split">
        <Card title="Recent Applications" action={<ViewAll to="/candidate/applications" />}>
          <DataTable columns={columns} rows={d?.recent_applications || []} loading={dash.loading}
            empty={<EmptyState icon={Send} title="No applications yet" text="Apply to an opportunity to track it here." action={<Button size="sm" to="/candidate/opportunities">Find opportunities</Button>} />} />
        </Card>
        <Card title="Continue Building Your Profile">
          <div className="cl-row" style={{ alignItems: 'stretch', gap: 16 }}>
            <img src="/assets/images/crops/thumb-profile-builder.jpg" alt="" style={{ width: '52%', borderRadius: 12, objectFit: 'cover', minHeight: 120 }} />
            <div className="cl-col" style={{ justifyContent: 'space-between' }}>
              <p className="cl-muted" style={{ fontSize: 13.5 }}>
                {profile?.completion?.percent >= 100 ? 'Your profile is complete — keep it fresh with new projects and skills.' : 'Add more projects, skills and certifications to get noticed by top companies.'}
              </p>
              <Button variant="outline" to="/candidate/profile" iconRight={ArrowRight}>Update Now</Button>
            </div>
          </div>
        </Card>
      </div>

      <JobDetailsModal jobId={openJob} onClose={() => setOpenJob(null)} saved={openJob && savedJobs.saved.has(openJob)} onToggleSave={savedJobs.toggle} onApplied={() => dash.reload()} />
      <ExplainabilityModal appId={explain} onClose={() => setExplain(null)} />
    </div>
  )
}
