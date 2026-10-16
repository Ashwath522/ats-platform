import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, ChevronRight, Download, ListFilter, Scale, UserSearch, Users } from 'lucide-react'
import {
  Alert, Avatar, Button, Card, EmptyState, PageHeader, Pagination, SearchInput, Segmented, Select, Skeleton, downloadCsv, fmtDate, useToast,
} from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import CandidateDetailPanel from './components/CandidateDetailPanel.jsx'
import { CollegeName } from '../../ui/CollegePicker.jsx'
import CandidateCompareModal from './components/CandidateCompareModal.jsx'
import CandidateInviteModal from './components/CandidateInviteModal.jsx'
import ScheduleInterviewModal from './components/ScheduleInterviewModal.jsx'
import { API, BRANCH_OPTIONS, MatchPill, VerifiedTick, branchMeta, useAppActions } from './components/RecruiterPipelineKit.jsx'
import { qs, useDebounced, useUrlFilters } from './components/RecruiterListKit.jsx'

const STATUS_OPTIONS = [
  { value: 'under_review', label: 'Under Review' }, { value: 'shortlisted', label: 'Shortlisted' }, { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' }, { value: 'hired', label: 'Hired' }, { value: 'rejected', label: 'Rejected' },
]
const SORTS = [
  { value: 'match', label: 'Sort by: Match Score' }, { value: 'cgpa', label: 'Sort by: CGPA' },
  { value: 'newest', label: 'Sort by: Most Recent' }, { value: 'name', label: 'Sort by: Name (A–Z)' },
]
const DEFAULTS = { view: 'mine', q: '', branch: '', location: '', status: '', sort: 'match', page: '1', id: '' }
const PAGE_SIZE = 10

export default function Candidates() {
  const api = useApi('recruiter')
  const toast = useToast()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const [qInput, setQInput] = useState(f.q)
  const q = useDebounced(qInput, 300)
  useEffect(() => { if (q !== f.q) setF({ q }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQInput(f.q) }, [f.q]) // top-bar search navigates here with ?q=

  const search = f.view === 'search'
  const listQs = qs({ view: f.view, q: f.q, branch: f.branch, location: f.location, status: search ? '' : f.status, sort: f.sort, page: f.page, page_size: PAGE_SIZE })
  const list = useQuery(() => api.get(`${API}/candidates?${listQs}`), [api, listQs])
  const items = list.data?.items || []

  // Auto-select the first candidate when none is chosen (desktop master/detail).
  const activeId = f.id ? Number(f.id) : items[0]?.candidate_id
  const detail = useQuery(() => (activeId ? api.get(`${API}/candidates/${activeId}`) : Promise.resolve(null)), [api, activeId])

  const [showFilters, setShowFilters] = useState(() => !window.matchMedia?.('(max-width: 600px)').matches)
  const [sel, setSel] = useState(() => new Map()) // candidate_id -> list item
  const [compare, setCompare] = useState(null)
  const [invite, setInvite] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [busy, setBusy] = useState(null)
  const [exporting, setExporting] = useState(false)
  const detailRef = useRef(null)
  const actions = useAppActions(api, () => { list.reload(); detail.reload() })

  useEffect(() => { setSel(new Map()) }, [f.view])

  function choose(c) {
    setF({ id: c.candidate_id, page: f.page })
    if (window.matchMedia?.('(max-width: 1180px)').matches) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const toggle = (c) => setSel((m) => { const n = new Map(m); if (n.has(c.candidate_id)) n.delete(c.candidate_id); else n.set(c.candidate_id, c); return n })
  const allOnPage = items.length > 0 && items.every((c) => sel.has(c.candidate_id))
  const toggleAll = () => setSel((m) => {
    const n = new Map(m)
    if (allOnPage) items.forEach((c) => n.delete(c.candidate_id)); else items.forEach((c) => n.set(c.candidate_id, c))
    return n
  })

  const selected = [...sel.values()]
  const shortlistable = selected.filter((c) => c.stage === 'under_review' && c.best_application_id)
  async function addToShortlist() {
    if (!selected.length) return toast('Tick candidates in the list first', 'error')
    if (!shortlistable.length) return toast('None of the selected candidates are awaiting review in your jobs — invite non-applicants to apply first.', 'info')
    const r = await actions.bulk(shortlistable.map((c) => c.best_application_id), 'shortlist')
    if (r) setSel(new Map())
  }
  function openCompare(extraId) {
    const ids = [...new Set([...(extraId ? [extraId] : []), ...sel.keys()])].slice(0, 3)
    if (ids.length < 2) return toast('Tick 2–3 candidates to compare', 'info')
    if (sel.size > 3) toast('Comparing the first 3 selected candidates', 'info')
    setCompare(ids)
  }
  async function exportList() {
    setExporting(true)
    try {
      const all = await api.get(`${API}/candidates?${qs({ view: f.view, q: f.q, branch: f.branch, location: f.location, status: search ? '' : f.status, sort: f.sort, page: 1, page_size: 500 })}`)
      const rows = (sel.size ? all.items.filter((c) => sel.has(c.candidate_id)) : all.items)
      if (!rows.length) return toast('Nothing to export', 'info')
      downloadCsv(`candidates-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((c) => ({
        Name: c.name, College: c.college || '', Branch: branchMeta(c.branch).label, Location: c.location || '', CGPA: c.cgpa ?? '',
        'Graduation Year': c.grad_year ?? '', 'Match %': c.match ?? '', 'Match basis': c.match_source === 'skills' ? 'Skill overlap with open jobs' : 'Application score',
        Stage: c.stage_label || 'Not applied', 'Verified projects': c.verified_projects, Skills: (c.skills || []).join('; '), 'Last applied': c.last_applied_at ? fmtDate(c.last_applied_at) : '',
      })))
      toast(`Exported ${rows.length} candidate${rows.length === 1 ? '' : 's'}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setExporting(false) }
  }

  async function shortlistOne(best) {
    setBusy('shortlist')
    await actions.bulk([best.application_id], 'shortlist')
    setBusy(null)
  }
  async function nextOne(best) {
    setBusy('next')
    await actions.nextStage(best.application_id)
    setBusy(null)
  }

  const activeFilters = [f.branch, f.location, !search && f.status].filter(Boolean).length
  const total = list.data?.total ?? 0
  const locOptions = useMemo(() => (list.data?.locations || []).filter(Boolean), [list.data])

  return (
    <div className="rp-page">
      <PageHeader
        title={search ? 'Find Candidates' : 'Candidate Management'}
        subtitle={search
          ? 'Search engineering students across CoreLink, check AI match scores against your open jobs and invite the right people to apply.'
          : 'View profiles, evaluate skills, check projects, and manage candidates through the hiring pipeline.'}
        actions={<>
          <Button variant="outline" icon={Scale} onClick={() => openCompare()}>Compare Candidates{sel.size ? ` (${Math.min(sel.size, 3)})` : ''}</Button>
          <Button variant="outline" icon={Download} loading={exporting} onClick={exportList}>Export List</Button>
          <Button icon={BookmarkPlus} loading={actions.busy && !busy} onClick={addToShortlist}>Add to Shortlist ({shortlistable.length})</Button>
        </>}
      />

      <div className="rp-cand-grid">
        <Card className="rp-cand-list">
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 18 }}>Candidates ({total.toLocaleString()})</h3>
            <button type="button" className="cl-link rp-filter-toggle" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
              <ListFilter size={16} />Filters{activeFilters ? ` (${activeFilters})` : ''}
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <Segmented value={f.view} onChange={(v) => setF({ view: v, id: '', status: '' })}
              options={[{ id: 'mine', label: 'My applicants', icon: Users }, { id: 'search', label: 'All candidates', icon: UserSearch }]} />
          </div>
          <div style={{ marginTop: 12 }}>
            <SearchInput value={qInput} onChange={setQInput} placeholder="Search by name, skills, or college…" />
          </div>
          {showFilters && (<>
            <div className="rp-cand-filters">
              <Select aria-label="Branch" value={f.branch} onChange={(e) => setF({ branch: e.target.value })} placeholder="All Branches" options={BRANCH_OPTIONS} />
              <Select aria-label="Location" value={f.location} onChange={(e) => setF({ location: e.target.value })} placeholder="All Locations" options={locOptions} />
              {search
                ? <Select aria-label="Sort" value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={SORTS.map((s) => ({ ...s, label: s.label.replace('Sort by: ', '') }))} />
                : <Select aria-label="Pipeline status" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="All Status" options={STATUS_OPTIONS} />}
            </div>
            <div className="cl-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              {!search ? <Select aria-label="Sort" className="rp-sort-sel" value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={SORTS} /> : <span />}
              {activeFilters > 0 && <button type="button" className="cl-link" onClick={() => setF({ branch: '', location: '', status: '' })}>Clear filters</button>}
            </div>
          </>)}

          {list.error && <div style={{ marginTop: 12 }}><Alert tone="error">{list.error.message} <button className="cl-link" onClick={list.reload}>Retry</button></Alert></div>}
          <div className="rp-cand-head">
            <label className="cl-row" style={{ gap: 8, fontSize: 12.5 }}>
              <input type="checkbox" className="cl-check" checked={allOnPage} onChange={toggleAll} disabled={!items.length} aria-label="Select all on this page" />
              {sel.size ? `${sel.size} selected` : 'Select all'}
            </label>
            {sel.size > 0 && <button type="button" className="cl-link" onClick={() => setSel(new Map())}>Clear</button>}
          </div>
          <div className="rp-cand-rows" aria-busy={list.loading}>
            {list.loading && !list.data ? Array.from({ length: 6 }, (_, i) => <div key={i} style={{ padding: '10px 8px' }}><Skeleton h={40} /></div>)
              : items.length === 0 ? (
                <EmptyState icon={UserSearch} title={f.q || activeFilters ? 'No candidates match' : search ? 'No candidates on CoreLink yet' : 'No applicants yet'}
                  text={f.q || activeFilters ? 'Try a different search or clear the filters.' : search ? 'Students appear here once they create a public profile.' : 'Candidates appear here when they apply to your jobs. Switch to “All candidates” to search the talent pool.'}
                  action={!search && !f.q && !activeFilters ? <Button size="sm" variant="outline" onClick={() => setF({ view: 'search' })}>Search all candidates</Button> : null} />
              ) : items.map((c) => {
                const b = branchMeta(c.branch)
                const active = c.candidate_id === activeId
                return (
                  <div key={c.candidate_id} className={`rp-cand-row${active ? ' active' : ''}`}>
                    <input type="checkbox" className="cl-check" checked={sel.has(c.candidate_id)} onChange={() => toggle(c)} aria-label={`Select ${c.name}`} />
                    <button type="button" className="rp-rowbtn" onClick={() => choose(c)} aria-current={active ? 'true' : undefined} aria-label={`Open ${c.name}`}>
                      <Avatar name={c.name} src={c.avatar_path} size={44} />
                      <span style={{ minWidth: 0 }}>
                        <strong>{c.name}<VerifiedTick show={c.verified} size={14} /></strong>
                        <small className="cl-college-line">{c.college && <CollegeName name={c.college} size={16} />}{b.id && <span className="cl-college-extra">{b.label}</span>}{!c.college && !b.id && 'Profile incomplete'}</small>
                      </span>
                      <span title={c.match_source === 'skills' ? 'Skill overlap with your open jobs' : 'Best application match score'}><MatchPill value={c.match} /></span>
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )
              })}
          </div>
          {list.data && <div className="rp-cand-pager"><Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} pageSize={PAGE_SIZE} setPage={(p) => setF({ page: String(p), id: '' })} noun="" /></div>}
        </Card>

        <div ref={detailRef} style={{ minWidth: 0, scrollMarginTop: 80 }}>
          <CandidateDetailPanel api={api} c={detail.data} loading={detail.loading || (list.loading && !list.data)} error={detail.error}
            busy={busy}
            onShortlist={shortlistOne}
            onSchedule={(best) => setSchedule([{ application_id: best.application_id, candidate_name: detail.data.name, job_title: best.job_title }])}
            onNext={nextOne}
            onInvite={() => setInvite(true)}
            onCompare={() => openCompare(activeId)} />
        </div>
      </div>

      <CandidateCompareModal open={!!compare} onClose={() => setCompare(null)} api={api} candidateIds={compare || []} onView={(id) => setF({ id, page: f.page })} />
      <CandidateInviteModal open={invite} onClose={() => setInvite(false)} api={api} candidate={detail.data} />
      <ScheduleInterviewModal open={!!schedule} onClose={() => setSchedule(null)} applications={schedule || []} onScheduled={() => { detail.reload(); list.reload() }} />
    </div>
  )
}
