import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Bell, BellOff, Briefcase, Building2, Calendar, ExternalLink, Globe, GraduationCap, Layers, MapPin, Radio, Users,
} from 'lucide-react'
import { Alert, Badge, Button, Card, EmptyState, Skeleton, Toggle, useToast } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { CompanyLogo, DemoBadge } from '../shared/companies.jsx'
import { FollowButton, branchLabel, useFollow } from './Companies.jsx'
import { BookmarkButton, JobDetailsModal, JobTags, daysAgoLabel, fmtSalary, useSavedJobs } from './components/shared.jsx'
import { LiveBadge, freshness, useExternalApply } from './components/liveJobs.jsx'
import './components/student.css'

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

export default function CompanyPortfolio() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const api = useApi('candidate')
  const toast = useToast()
  const q = useQuery(() => api.get(`/api/student/company-directory/${encodeURIComponent(slug)}`), [api, slug])
  const c = q.data
  const savedJobs = useSavedJobs()
  const [openJob, setOpenJob] = useState(params.get('job') || null)
  const ext = useExternalApply({ onChange: () => q.reload() })
  const follow = useFollow({ onChange: () => q.reload() })
  const [notifyBusy, setNotifyBusy] = useState(false)

  useEffect(() => { const j = params.get('job'); if (j) setOpenJob(/^\d+$/.test(j) ? Number(j) : j) }, [params])
  const closeJob = () => {
    setOpenJob(null)
    if (params.get('job')) { const n = new URLSearchParams(params); n.delete('job'); setParams(n, { replace: true }) }
  }
  const setNotify = async (v) => {
    setNotifyBusy(true)
    try {
      await api.patch(`/api/student/company-directory/${c.slug}/follow`, { notify_email: v })
      q.setData((d) => ({ ...d, notify_email: v }))
      toast(v ? 'Email alerts on (at most one per day)' : 'Email alerts off — you will still see new roles in the bell', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setNotifyBusy(false) }
  }

  if (q.error) {
    return (
      <div className="st-page">
        <Button variant="ghost" icon={ArrowLeft} to="/candidate/companies">All companies</Button>
        <Card><EmptyState icon={Building2} title={q.error.status === 404 ? 'Company not found' : 'Could not load this company'} text={q.error.message}
          action={<Button variant="outline" to="/candidate/companies">Browse companies</Button>} /></Card>
      </div>
    )
  }
  if (!c) return <div className="st-page"><Skeleton h={220} /><Skeleton h={300} /></div>

  const following = follow.isOn({ slug: c.slug, following: c.following })
  const facts = [
    c.hq && { icon: MapPin, label: 'Headquarters', value: c.hq },
    c.india_locations?.length > 0 && { icon: Building2, label: 'In India', value: c.india_locations.join(', ') },
    c.founded && { icon: Calendar, label: 'Founded', value: c.founded },
    c.employee_band && { icon: Users, label: 'Employees', value: c.employee_band },
    c.branches?.length > 0 && { icon: Layers, label: 'Hires from branches', value: c.branches.map(branchLabel).join(', ') },
  ].filter(Boolean)

  return (
    <div className="st-page">
      <div><Button variant="ghost" size="sm" icon={ArrowLeft} to="/candidate/companies">All companies</Button></div>
      <section className={`cl-card co-hero ${c.is_demo ? 'demo' : ''}`} aria-labelledby="co-name">
        <CompanyLogo name={c.name} domain={c.domain} src={c.logo_url} size={76} />
        <div style={{ minWidth: 0 }}>
          <div className="cl-row cl-wrap" style={{ gap: 8 }}>
            <h1 id="co-name">{c.name}</h1>
            {c.is_demo && <DemoBadge />}
          </div>
          <div className="cl-muted" style={{ fontSize: 14, marginTop: 4 }}>{c.industry}</div>
          <div className="cl-row cl-wrap" style={{ gap: 14, marginTop: 8, fontSize: 13.5 }}>
            {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="cl-row" style={{ gap: 5 }}><Globe size={14} aria-hidden="true" />{host(c.website)}<ExternalLink size={12} aria-hidden="true" /><span className="co-sr-only"> (opens in a new tab)</span></a>}
            {c.careers_url && <a href={c.careers_url} target="_blank" rel="noopener noreferrer" className="cl-row" style={{ gap: 5 }}><Briefcase size={14} aria-hidden="true" />Official careers page<ExternalLink size={12} aria-hidden="true" /></a>}
            <span className="cl-muted">{c.followers} follower{c.followers === 1 ? '' : 's'} on CoreLink</span>
          </div>
          {c.about && <p className="co-about">{c.about}</p>}
          {c.is_demo && <Alert>This is a fictional <b>demo company</b> created for testing. Its jobs are real postings on CoreLink, but the employer does not exist.</Alert>}
          {facts.length > 0 && (
            <div className="co-facts">
              {facts.map((f) => <div key={f.label} className="co-fact"><f.icon size={17} aria-hidden="true" /><span><small>{f.label}</small><b>{f.value}</b></span></div>)}
            </div>
          )}
        </div>
        <div className="co-hero-actions">
          <FollowButton company={{ ...c, following: c.following }} follow={follow} size="md" block />
          {following && (
            <label className="cl-row" style={{ gap: 8, fontSize: 13, justifyContent: 'space-between' }}>
              <span className="cl-row" style={{ gap: 5 }}>{c.notify_email ? <Bell size={14} /> : <BellOff size={14} />}Email alerts</span>
              <Toggle label="Email alerts for new roles" checked={!!c.notify_email} disabled={notifyBusy} onChange={setNotify} />
            </label>
          )}
          <Button variant="ghost" size="sm" to={`/candidate/opportunities?company=${c.slug}`} iconRight={ArrowRight}>See in Opportunities</Button>
        </div>
      </section>

      <RolesCard title="Open roles" icon={Briefcase} roles={c.jobs} empty="No full-time roles open right now." company={c}
        following={following} savedJobs={savedJobs} onOpen={setOpenJob} ext={ext} />
      <RolesCard title="Internships" icon={GraduationCap} roles={c.internships} empty="No internships open right now." company={c}
        following={following} savedJobs={savedJobs} onOpen={setOpenJob} ext={ext} />
      {c.sources?.length > 0 && <p className="co-note"><Radio size={14} aria-hidden="true" />Live listings come from {c.sources.join(', ')} and are re-checked every sync; apply on the company’s own site.</p>}

      <JobDetailsModal jobId={openJob} onClose={closeJob} saved={openJob && savedJobs.saved.has(openJob)} onToggleSave={savedJobs.toggle} onApplied={() => q.reload()} />
      {!openJob && ext.prompt}
    </div>
  )
}

function RolesCard({ title, icon: Icon, roles = [], empty, company, following, savedJobs, onOpen, ext }) {
  return (
    <Card title={<><Icon size={19} />{title} <Badge>{roles.length}</Badge></>}>
      {roles.length === 0 ? (
        <EmptyState icon={Icon} title={empty} text={following ? 'You follow this company — we will notify you when it posts a new role.' : 'Follow this company to be notified when it posts a new role.'} />
      ) : roles.map((j) => <RoleRow key={j.id} job={j} company={company} saved={savedJobs.saved.has(j.id)} onSave={() => savedJobs.toggle(j.id)} onOpen={() => onOpen(j.id)} onApplyExternal={() => ext.apply(j)} />)}
    </Card>
  )
}

function RoleRow({ job, saved, onSave, onOpen, onApplyExternal }) {
  const salary = fmtSalary(job)
  return (
    <div className="co-role">
      <div className="cl-col" style={{ gap: 6, minWidth: 0 }}>
        <div className="cl-row cl-wrap" style={{ gap: 8 }}>
          <h4 onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>{job.title}</h4>
          {job.company_demo && <DemoBadge compact />}
          {job.external && <LiveBadge job={job} />}
        </div>
        <span className="cl-meta"><span><MapPin size={14} />{job.location || '—'}</span>{salary && <span>{salary}</span>}<span>{job.external ? freshness(job) : daysAgoLabel(job.days_ago)}</span></span>
        <JobTags job={job} max={5} />
      </div>
      <div className="co-role-actions">
        {job.applied && <Badge tone="blue">Applied</Badge>}
        <BookmarkButton on={saved} onClick={onSave} />
        {job.external ? (
          <>
            <Button variant="ghost" size="sm" onClick={onOpen}>Details</Button>
            <Button size="sm" iconRight={ExternalLink} onClick={onApplyExternal} aria-label={`Apply for ${job.title} on the company site (opens in a new tab)`}>Apply on company site</Button>
          </>
        ) : (
          <Button size="sm" variant={job.applied ? 'outline' : 'primary'} iconRight={ArrowRight} onClick={onOpen}>{job.applied ? 'View' : 'Apply'}</Button>
        )}
      </div>
    </div>
  )
}

