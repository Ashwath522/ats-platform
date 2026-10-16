import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Briefcase, MapPin, Heart, HeartOff, Check, Plus, X, Info } from 'lucide-react'
import { Alert, Button, Card, EmptyState, Hero, Pagination, Select, Skeleton, Tabs, useToast } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { BRANCHES, getBranch } from '../../branding/branches.js'
import { useStudent } from './StudentShell.jsx'
import { CompanyLogo, CompanySearch, DemoBadge } from '../shared/companies.jsx'
import './components/student.css'

const PAGE_SIZE = 24
const KEYS = ['q', 'branch', 'industry', 'location', 'hiring', 'demo', 'view']

/** Follow state for a set of companies: { isOn(slug), toggle(company) } */
export function useFollow({ onChange } = {}) {
  const api = useApi('candidate')
  const toast = useToast()
  const [over, setOver] = useState({})          // optimistic overrides {slug: bool}
  const [busy, setBusy] = useState({})
  const toggle = async (c) => {
    const on = over[c.slug] ?? c.following
    setOver((o) => ({ ...o, [c.slug]: !on }))
    setBusy((b) => ({ ...b, [c.slug]: true }))
    try {
      if (on) await api.del(`/api/student/company-directory/${c.slug}/follow`)
      else await api.post(`/api/student/company-directory/${c.slug}/follow`, { notify_email: true })
      toast(on ? `Unfollowed ${c.name}` : `Following ${c.name} — we'll notify you about new roles`, 'success')
      onChange?.(c, !on)
    } catch (e) {
      setOver((o) => ({ ...o, [c.slug]: on }))
      toast(e.message, 'error')
    } finally { setBusy((b) => ({ ...b, [c.slug]: false })) }
  }
  return { isOn: (c) => over[c.slug] ?? c.following, busy: (c) => !!busy[c.slug], toggle }
}

export function FollowButton({ company, follow, size = 'sm', block }) {
  const on = follow.isOn(company)
  return (
    <Button size={size} block={block} variant={on ? 'secondary' : 'outline'} icon={on ? Check : Plus} loading={follow.busy(company)}
      aria-pressed={on} aria-label={on ? `Unfollow ${company.name}` : `Follow ${company.name}`} onClick={() => follow.toggle(company)}>
      {on ? 'Following' : 'Follow'}
    </Button>
  )
}

export const branchLabel = (id) => getBranch(id)?.label || id

export default function Companies() {
  const api = useApi('candidate')
  const navigate = useNavigate()
  const { branch } = useStudent()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) || ''])), [params])
  const [text, setText] = useState(filters.q)
  const [page, setPage] = useState(1)

  // typing filters the grid (debounced) while the dropdown suggests companies
  useEffect(() => {
    const t = setTimeout(() => { if (text !== filters.q) setFilter('q', text) }, 250)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(filters.q) }, [filters.q])

  function setFilter(k, v) {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
    setPage(1)
  }
  const clear = () => { setParams({}, { replace: true }); setText(''); setPage(1) }

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    if (filters.q) p.set('q', filters.q)
    if (filters.branch) p.set('branch', filters.branch)
    if (filters.industry) p.set('industry', filters.industry)
    if (filters.location) p.set('location', filters.location)
    if (filters.hiring) p.set('hiring', 'true')
    if (filters.demo) p.set('demo', filters.demo)
    if (filters.view === 'following') p.set('following_only', 'true')
    return p.toString()
  }, [filters, page])
  const q = useQuery(() => api.get(`/api/student/company-directory?${qs}`), [api, qs])
  const data = q.data
  const follow = useFollow({ onChange: () => { if (filters.view === 'following') q.reload() } })
  const active = KEYS.filter((k) => k !== 'view' && filters[k])

  return (
    <div className="st-page">
      <Hero branch={branch} page="opportunities"
        title={<h1>Explore Companies<br /><em>Hiring Core Engineers</em></h1>}
        text="Browse top core-engineering employers in India, see their real open roles and internships, and follow them to hear about new openings first." />

      <Card>
        <div className="co-toolbar">
          <div className="co-search-cell">
            <CompanySearch api={api} value={text} onChange={setText} placeholder="Search companies, e.g. Bosch, HAL, L&T…"
              onPick={(c) => navigate(`/candidate/companies/${c.slug}`)} onSubmit={(v) => setFilter('q', v)} />
          </div>
          <Select aria-label="Branch" value={filters.branch} onChange={(e) => setFilter('branch', e.target.value)} placeholder="All branches"
            options={(data?.facets?.branches || BRANCHES.map((b) => b.id)).map((id) => ({ value: id, label: getBranch(id)?.long || id }))} />
          <Select aria-label="Industry" value={filters.industry} onChange={(e) => setFilter('industry', e.target.value)} placeholder="All industries"
            options={data?.facets?.industries || []} />
          <Select aria-label="Location in India" value={filters.location} onChange={(e) => setFilter('location', e.target.value)} placeholder="All locations"
            options={data?.facets?.locations || []} />
          <label className="co-hiring-toggle"><input type="checkbox" className="cl-check" checked={!!filters.hiring} onChange={(e) => setFilter('hiring', e.target.checked ? '1' : '')} />Hiring now</label>
        </div>
      </Card>

      <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
        <Tabs value={filters.view || 'all'} onChange={(v) => setFilter('view', v === 'all' ? '' : v)}
          tabs={[{ id: 'all', label: 'All companies', icon: Building2 }, { id: 'following', label: 'Following', icon: Heart, count: data?.following_count }]} />
        <label className="cl-row" style={{ gap: 6, fontSize: 13.5 }}>
          <span className="cl-muted">Show:</span>
          <Select aria-label="Real or demo companies" value={filters.demo} onChange={(e) => setFilter('demo', e.target.value)} style={{ width: 'auto', minHeight: 36 }}
            placeholder="All companies" options={[{ value: 'real', label: 'Real companies only' }, { value: 'demo', label: 'Demo companies only' }]} />
        </label>
      </div>

      {active.length > 0 && (
        <div className="cl-chips">
          {active.map((k) => (
            <span key={k} className="cl-chip blue">
              {k === 'hiring' ? 'Hiring now' : k === 'branch' ? branchLabel(filters.branch) : k === 'demo' ? (filters.demo === 'demo' ? 'Demo only' : 'Real only') : filters[k]}
              <button type="button" aria-label={`Remove ${k} filter`} onClick={() => { setFilter(k, ''); if (k === 'q') setText('') }}><X size={13} /></button>
            </span>
          ))}
          <button className="cl-link" onClick={clear}>Clear all</button>
        </div>
      )}

      {q.error && <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>}
      {q.loading && !data ? (
        <div className="co-grid">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} h={190} />)}</div>
      ) : data?.items?.length === 0 ? (
        <Card>
          <EmptyState icon={filters.view === 'following' ? HeartOff : Building2}
            title={filters.view === 'following' ? 'You are not following any company yet' : 'No companies match'}
            text={filters.view === 'following' ? 'Follow companies to get notified when they post new roles.' : 'Try removing a filter or searching for another name.'}
            action={<Button variant="outline" onClick={clear}>{filters.view === 'following' ? 'Browse all companies' : 'Clear filters'}</Button>} />
        </Card>
      ) : (
        <>
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18 }}>{data ? `${data.total} compan${data.total === 1 ? 'y' : 'ies'}` : 'Companies'}</h2>
          </div>
          <div className="co-grid" style={{ opacity: q.loading ? 0.6 : 1 }}>
            {data?.items.map((c) => <CompanyCard key={c.slug} c={c} follow={follow} />)}
          </div>
          {data && data.total > PAGE_SIZE && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size} setPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} noun="companies" />}
        </>
      )}
      <p className="co-note"><Info size={14} aria-hidden="true" />Logos are each company’s own website icon. Company facts are neutral public information; open roles come from companies hiring on CoreLink and from official career sites. Companies marked “Demo” are fictional test accounts.</p>
    </div>
  )
}

function CompanyCard({ c, follow }) {
  const roles = c.open_roles
  return (
    <article className={`cl-card co-card ${c.is_demo ? 'demo' : ''}`}>
      <div className="co-card-top">
        <CompanyLogo name={c.name} domain={c.domain} src={c.logo_url} size={48} />
        <div className="cl-grow" style={{ minWidth: 0 }}>
          <Link to={`/candidate/companies/${c.slug}`} className="co-card-name">{c.name}</Link>
          <div className="co-card-sub">{c.industry}</div>
        </div>
        {c.is_demo && <DemoBadge compact />}
      </div>
      <div className="co-card-meta">
        {c.hq && <span><MapPin size={13} aria-hidden="true" />{c.hq}</span>}
        {c.india_locations?.length > 0 && <span title={c.india_locations.join(', ')}>India: {c.india_locations.slice(0, 2).join(', ')}{c.india_locations.length > 2 ? ` +${c.india_locations.length - 2}` : ''}</span>}
      </div>
      <div className="co-branch-chips">{(c.branches || []).slice(0, 4).map((b) => <span key={b} className="co-branch-chip">{branchLabel(b)}</span>)}</div>
      <div className="co-card-foot">
        <span className={`co-roles ${roles ? '' : 'none'}`}><Briefcase size={14} aria-hidden="true" />{roles ? `${roles} open role${roles === 1 ? '' : 's'}` : 'No open roles now'}</span>
        <FollowButton company={c} follow={follow} />
      </div>
    </article>
  )
}
