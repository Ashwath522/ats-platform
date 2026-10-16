import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Briefcase, GraduationCap, Clock, Building, Globe, MapPin, ArrowRight, Filter, Search, List, LayoutGrid, Bookmark, BrainCircuit,
  BadgeIndianRupee, Gauge, Layers, X, ExternalLink, Radio,
} from 'lucide-react'
import { Alert, Button, Card, EmptyState, Field, Hero, Input, Pagination, Segmented, Select, Skeleton, Tabs, ViewAll, Badge } from '../../ui/index.jsx'
import { CompanyLogo, CompanySearch, DemoBadge } from '../shared/companies.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { BRANCHES } from '../../branding/branches.js'
import { useStudent } from './StudentShell.jsx'
import { BookmarkButton, JobDetailsModal, JobTags, daysAgoLabel, fmtSalary, useSavedJobs } from './components/shared.jsx'
import { LiveBadge, freshness, useExternalApply } from './components/liveJobs.jsx'
import './components/student.css'

const TYPE_TABS = [
  { id: 'all', label: 'All Opportunities', icon: Briefcase },
  { id: 'internship', label: 'Internships', icon: GraduationCap },
  { id: 'full-time', label: 'Full Time Jobs', icon: Building },
  { id: 'part-time', label: 'Part Time', icon: Clock },
  { id: 'onsite', label: 'On-site', icon: MapPin },
  { id: 'remote', label: 'Remote', icon: Globe },
]
const EMPTY = { q: '', location: '', job_type: '', experience: '', branch: '', salary_min: '', remote: '', near: '', origin: '', company: '' }
const ORIGIN = { corelink: 'CoreLink jobs', live: 'Live company listings' }
const SALARY = [{ value: '300000', label: '₹3 LPA +' }, { value: '500000', label: '₹5 LPA +' }, { value: '800000', label: '₹8 LPA +' }, { value: '1200000', label: '₹12 LPA +' }]
const EXP = { fresher: 'Fresher', '0-2': '0–2 years', '2-5': '2–5 years', '5+': '5+ years' }

export default function Opportunities() {
  const api = useApi('candidate')
  const { branch, profile } = useStudent()
  const [params, setParams] = useSearchParams()
  const initial = useMemo(() => ({ ...EMPTY, q: params.get('q') || '', remote: params.get('remote') ? 'remote' : '', near: params.get('near') ? '1' : '', origin: ['live', 'corelink'].includes(params.get('origin')) ? params.get('origin') : '', company: /^[a-z0-9-]{1,80}$/.test(params.get('company') || '') ? params.get('company') : '' }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [companyText, setCompanyText] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [draft, setDraft] = useState(initial)
  const [filters, setFilters] = useState(initial)
  const [tab, setTab] = useState(params.get('type') || 'all')
  const [sort, setSort] = useState('relevance')
  const [view, setView] = useState('list')
  const [page, setPage] = useState(1)
  const [savedOnly, setSavedOnly] = useState(false)
  const [openJob, setOpenJob] = useState(null)
  const savedJobs = useSavedJobs()
  const ext = useExternalApply({ onChange: () => q.reload() })

  // Header search (?q=) while already on this page
  useEffect(() => {
    const q = params.get('q') || ''
    if (q !== filters.q) { setDraft((d) => ({ ...d, q })); setFilters((f) => ({ ...f, q })); setPage(1) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort, page: String(page), page_size: '10' })
    if (tab !== 'all') p.set('type', tab)
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v) })
    if (savedOnly) p.set('saved_only', 'true')
    return p.toString()
  }, [filters, tab, sort, page, savedOnly])
  const q = useQuery(() => api.get(`/api/student/opportunities?${qs}`), [api, qs])
  const data = q.data

  const syncUrl = (f) => {
    const next = new URLSearchParams(params)
    if (f.q) next.set('q', f.q); else next.delete('q')
    if (f.company) next.set('company', f.company); else next.delete('company')
    setParams(next, { replace: true })
  }
  const apply = () => { setFilters(draft); setPage(1); syncUrl(draft) }
  const pickCompany = (c) => {
    const f = { ...draft, company: c.slug }
    setDraft(f); setFilters(f); setPage(1); setCompanyText(''); setCompanyName(c.name); syncUrl(f)
  }
  const clear = () => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); setSavedOnly(false); setCompanyText(''); setCompanyName(''); setParams({}, { replace: true }) }
  // name for the chip when the page was opened with ?company=<slug>
  useEffect(() => {
    if (filters.company && !companyName) api.get(`/api/student/company-directory/${filters.company}`).then((c) => setCompanyName(c.name)).catch(() => {})
  }, [filters.company]) // eslint-disable-line react-hooks/exhaustive-deps
  const setD = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const active = Object.entries(filters).filter(([, v]) => v)
  const countLabel = data ? `${data.total} ${savedOnly ? 'Saved ' : ''}Opportunit${data.total === 1 ? 'y' : 'ies'}` : 'Opportunities'

  return (
    <div className="st-page">
      <div className="st-split">
        <div className="st-page">
          <Hero branch={branch} page="opportunities"
            title={<h1>Find Opportunities<br /><em>That Build Your Future</em></h1>}
            text="Explore internships and jobs, connect with top companies and turn your engineering skills into real-world impact." />

          <Card flush><div style={{ padding: '0 10px' }}>
            <Tabs tabs={TYPE_TABS.map((t) => ({ ...t, count: data?.counts ? (t.id === 'all' ? data.counts.all : data.counts[t.id]) : undefined }))} value={tab} onChange={(v) => { setTab(v); setPage(1) }} />
          </div></Card>

          <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="cl-col" style={{ gap: 2 }}>
              <h2 style={{ fontSize: 20 }}>{countLabel}</h2>
              {data?.origin_counts?.live > 0 && <span className="st-fresh cl-row" style={{ gap: 5 }}><Radio size={13} color="#0f766e" />{data.origin_counts.live} live listing{data.origin_counts.live === 1 ? '' : 's'} from official company career sites</span>}
            </div>
            <div className="cl-row cl-wrap">
              <label className="cl-row" style={{ gap: 6, fontSize: 13.5 }}>
                <span className="cl-muted">Sort by:</span>
                <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }} style={{ width: 'auto', minHeight: 36 }} aria-label="Sort opportunities"
                  options={[{ value: 'relevance', label: 'Relevance' }, { value: 'newest', label: 'Newest' }, { value: 'salary', label: 'Salary' }]} />
              </label>
              <Segmented value={view} onChange={setView} options={[{ id: 'list', label: 'List', icon: List }, { id: 'grid', label: 'Grid', icon: LayoutGrid }]} />
            </div>
          </div>

          {(active.length > 0 || savedOnly) && (
            <div className="cl-chips">
              {active.map(([k, v]) => <span key={k} className="cl-chip blue">{k === 'salary_min' ? `₹${v / 100000}+ LPA` : k === 'near' ? 'Near me' : k === 'experience' ? EXP[v] || v : k === 'branch' ? BRANCHES.find((b) => b.id === v)?.label || v : k === 'origin' ? ORIGIN[v] || v : k === 'company' ? `Company: ${companyName || v}` : v}
                <button type="button" aria-label={`Remove ${k} filter`} onClick={() => { const n = { ...filters, [k]: '' }; setFilters(n); setDraft(n); setPage(1); if (k === 'q' || k === 'company') syncUrl(n); if (k === 'company') setCompanyName('') }}><X size={13} /></button></span>)}
              {savedOnly && <span className="cl-chip blue">Saved jobs<button type="button" aria-label="Show all jobs" onClick={() => setSavedOnly(false)}><X size={13} /></button></span>}
              <button className="cl-link" onClick={clear}>Clear all</button>
            </div>
          )}

          {q.error && <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>}
          {q.loading && !data ? <div className="cl-col">{[0, 1, 2].map((i) => <Skeleton key={i} h={110} />)}</div>
            : data?.items.length === 0 ? (
              <Card><EmptyState icon={Briefcase} title="No opportunities match" text="Try removing a filter or searching for a different skill." action={<Button variant="outline" onClick={clear}>Clear filters</Button>} /></Card>
            ) : (
              <div className={view === 'grid' ? 'st-job-grid' : 'cl-col'} style={{ gap: 12, opacity: q.loading ? 0.6 : 1 }}>
                {data?.items.map((j) => <JobRow key={j.id} job={j} grid={view === 'grid'} saved={savedJobs.saved.has(j.id)} onSave={() => savedJobs.toggle(j.id)} onOpen={() => setOpenJob(j.id)} onApplyExternal={() => ext.apply(j)} />)}
              </div>
            )}
          {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size} setPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} noun="opportunities" />}
        </div>

        <div className="st-right">
          <Card title={<><Filter size={20} />Filters</>} action={<button className="cl-link" onClick={clear}>Clear All</button>}>
            <form className="cl-col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); apply() }}>
              <Field label="Search by title, company or keyword"><Input icon={Search} value={draft.q} onChange={setD('q')} placeholder="e.g. Design Intern, CAD, Simulation…" maxLength={120} /></Field>
              <div className="st-filter-row"><Building size={18} /><Field label="Company">
                <CompanySearch api={api} value={companyText} onChange={setCompanyText} onPick={pickCompany} label="Filter by company"
                  placeholder={companyName ? `${companyName} — type to change` : 'Type a company, e.g. Bosch'}
                  footer={<li className="co-suggest-foot"><Link to="/candidate/companies">Browse all companies →</Link></li>} />
              </Field></div>
              <div className="st-filter-row"><MapPin size={18} /><Field label="Location"><Select value={draft.location} onChange={setD('location')} placeholder="All Locations" options={data?.facets?.locations || []} /></Field></div>
              <div className="st-filter-row"><Briefcase size={18} /><Field label="Job Type"><Select value={draft.job_type} onChange={setD('job_type')} placeholder="All Types" options={[{ value: 'internship', label: 'Internship' }, { value: 'full-time', label: 'Full Time' }, { value: 'part-time', label: 'Part Time' }, { value: 'apprenticeship', label: 'Apprenticeship' }]} /></Field></div>
              <div className="st-filter-row"><Gauge size={18} /><Field label="Experience Level"><Select value={draft.experience} onChange={setD('experience')} placeholder="All Levels" options={Object.entries(EXP).map(([value, label]) => ({ value, label }))} /></Field></div>
              <div className="st-filter-row"><Layers size={18} /><Field label="Domain / Role"><Select value={draft.branch} onChange={setD('branch')} placeholder="All Roles" options={BRANCHES.map((b) => ({ value: b.id, label: b.long }))} /></Field></div>
              <div className="st-filter-row"><Radio size={18} /><Field label="Source"><Select value={draft.origin} onChange={setD('origin')} placeholder="All sources" options={Object.entries(ORIGIN).map(([value, label]) => ({ value, label }))} /></Field></div>
              <div className="st-filter-row"><BadgeIndianRupee size={18} /><Field label="Salary (Optional)"><Select value={draft.salary_min} onChange={setD('salary_min')} placeholder="Any" options={SALARY} /></Field></div>
              <label className="cl-row" style={{ fontSize: 13.5 }}><input type="checkbox" className="cl-check" checked={draft.remote === 'remote'} onChange={(e) => setDraft((d) => ({ ...d, remote: e.target.checked ? 'remote' : '' }))} />Remote only</label>
              <label className="cl-row" style={{ fontSize: 13.5 }}><input type="checkbox" className="cl-check" checked={draft.near === '1'} onChange={(e) => setDraft((d) => ({ ...d, near: e.target.checked ? '1' : '' }))} />Near me {profile?.location_text ? `(${profile.location_text.split(',')[0]})` : ''}</label>
              <Button type="submit" block size="lg">Apply Filters</Button>
            </form>
          </Card>
          <Card title={<><Bookmark size={20} />Saved Jobs</>} action={savedJobs.items.length > 0 && <ViewAll onClick={() => { setSavedOnly(true); setPage(1) }} />}>
            {savedJobs.items.length === 0 ? <p className="cl-muted" style={{ fontSize: 13.5 }}>Tap the bookmark on any job to save it for later.</p> : (
              <div className="cl-list">
                {savedJobs.items.slice(0, 3).map((s) => (
                  <div key={s.job_id} className="cl-list-item">
                    <CompanyLogo name={s.company} domain={s.company_domain} src={s.company_logo} size={46} />
                    <button type="button" className="st-reset-btn" style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setOpenJob(s.job_id)}>
                      <strong className="cl-ellipsis" style={{ display: 'block', color: 'var(--cl-ink)', fontSize: 14 }}>{s.title}</strong>
                      <small className="cl-muted" style={{ display: 'block' }}>{s.company}</small>
                      <small className="cl-muted cl-ellipsis" style={{ display: 'block' }}><MapPin size={12} /> {s.location}{s.status !== 'open' ? ' · closed' : s.external ? ' · live listing' : ''}</small>
                    </button>
                    <BookmarkButton on onClick={() => savedJobs.toggle(s.job_id)} />
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card tint>
            <div className="cl-row" style={{ alignItems: 'flex-start' }}>
              <BrainCircuit size={30} color="var(--cl-blue)" />
              <div className="cl-col" style={{ gap: 8 }}>
                <strong style={{ color: 'var(--cl-blue)', fontSize: 16 }}>Get Personalized Recommendations</strong>
                <p className="cl-muted" style={{ fontSize: 13.5 }}>Matches are based on the skills on your profile ({data?.profile?.skills ?? profile?.skills?.length ?? 0}) and your branch. Add skills and projects to improve them.</p>
                {data?.profile?.visibility === 'private' && <small style={{ color: 'var(--cl-amber)' }}>Your profile is private — recruiters can’t discover you outside your applications.</small>}
                <Button variant="outline" to="/candidate/resume-skills" iconRight={ArrowRight}>Improve Profile</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <JobDetailsModal jobId={openJob} onClose={() => setOpenJob(null)} saved={openJob && savedJobs.saved.has(openJob)} onToggleSave={savedJobs.toggle} onApplied={() => q.reload()} />
      {!openJob && ext.prompt}
    </div>
  )
}

function JobRow({ job, grid, saved, onSave, onOpen, onApplyExternal }) {
  const salary = fmtSalary(job)
  return (
    <article className={`cl-card st-job ${grid ? 'st-job-card' : ''}`} style={grid ? { gridTemplateColumns: '56px minmax(0,1fr)' } : undefined}>
      <div className="st-job-logo"><CompanyLogo name={job.company} domain={job.company_domain} src={job.company_logo} size={grid ? 52 : 56} wide={!grid && !job.company_domain} /></div>
      <div style={{ minWidth: 0 }} className="cl-col">
        <div>
          <h4 className="st-card-click" onClick={onOpen}>{job.title}</h4>
          <div className="cl-row cl-wrap" style={{ fontSize: 14, color: 'var(--cl-text)', marginTop: 2, gap: 8 }}>
            {job.company_slug ? <Link to={`/candidate/companies/${job.company_slug}`} style={{ color: 'inherit' }}>{job.company}</Link> : job.company}
            {job.company_demo && <DemoBadge compact />}
          </div>
        </div>
        <div className="cl-row cl-wrap" style={{ gap: 8 }}>
          <span className="cl-meta"><span><MapPin size={14} />{job.location || '—'}</span>{salary && <span>{salary}</span>}</span>
          <JobTags job={job} max={grid ? 3 : 6} />
        </div>
        {job.external && (
          <div className="cl-row cl-wrap" style={{ gap: 8 }}>
            <LiveBadge job={job} />
            <span className="st-fresh">{freshness(job)}</span>
          </div>
        )}
      </div>
      <div className="st-job-side" style={grid ? { gridColumn: '1 / -1' } : undefined}>
        <div className="cl-row" style={{ gap: 6 }}>
          {job.applied ? <Badge tone="blue">Applied</Badge> : !job.external && <span className="st-posted">{daysAgoLabel(job.days_ago)}</span>}
          <BookmarkButton on={saved} onClick={onSave} />
        </div>
        <span className="st-match" title={job.match_source === 'ats' ? 'Your ATS score for this job' : 'Skill overlap with your profile + branch match'}>{job.match}% match</span>
        {job.external ? (
          <div className="cl-row cl-wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={onOpen}>Details</Button>
            <Button size="sm" iconRight={ExternalLink} onClick={onApplyExternal} aria-label={`Apply for ${job.title} on ${job.company}'s site (opens in a new tab)`}>Apply on company site</Button>
          </div>
        ) : <Button variant="outline" size="sm" iconRight={ArrowRight} onClick={onOpen}>View Details</Button>}
      </div>
    </article>
  )
}
