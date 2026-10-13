import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LayoutGrid, FileText, Video, ClipboardList, FolderKanban, MonitorPlay, GraduationCap, Bookmark, Compass, Star, Clock3, TrendingUp,
  Download, Search, Mail, ExternalLink, BookOpen, Layers,
} from 'lucide-react'
import {
  Alert, Button, Card, DataTable, DemoTag, EmptyState, Hero, Input, Modal, Pagination, Tabs, ViewAll, fmtDate, usePagination, useToast,
} from '../../ui/index.jsx'
import { useApi } from '../../ui/useApi.js'
import { BRANCHES } from '../../branding/branches.js'
import { useStudent } from './StudentShell.jsx'
import { BranchIcon } from './components/shared.jsx'
import {
  CATALOGUE, CATEGORIES, CATEGORY_LABEL, FORMAT_LABEL, SAMPLE_POPULARITY, branchLabel, fmtCount, outlineMarkdown, searchLinks, thumbFor,
} from './components/resourceCatalog.js'
import './components/student.css'

const TAB_ICONS = { all: LayoutGrid, study: FileText, interview: ClipboardList, project: FolderKanban, software: MonitorPlay, career: GraduationCap, saved: Bookmark }
const TAB_PARAM = { career: 'career', interview: 'interview', study: 'study', project: 'project', software: 'software', saved: 'saved' }
const CAT_TONE = { study: 'blue', interview: 'purple', project: 'amber', software: 'green', career: '' }
const MAX_SAVED = 100

function FormatIcon({ r, size = 18 }) {
  if (r.format === 'video') return <span className="st-fmt video"><Video size={size} /></span>
  return <span className="st-fmt"><FileText size={size} /></span>
}

function downloadOutline(r) {
  const blob = new Blob([outlineMarkdown(r)], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${r.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Saved resources live in the profile's preferences (preferences.saved_resources). */
function useSavedResources() {
  const api = useApi('candidate')
  const toast = useToast()
  const { profile, setProfile } = useStudent()
  const saved = useMemo(() => new Set(profile?.preferences?.saved_resources || []), [profile])
  const toggle = async (id) => {
    const next = new Set(saved)
    const on = !next.has(id)
    if (on) next.add(id); else next.delete(id)
    if (next.size > MAX_SAVED) return toast(`You can save up to ${MAX_SAVED} resources`, 'error')
    try {
      const p = await api.put('/api/candidate/profile', { preferences: { ...(profile?.preferences || {}), saved_resources: [...next] } })
      setProfile(p)
      toast(on ? 'Saved to your resources' : 'Removed from saved', 'success')
    } catch (e) { toast(e.message, 'error') }
  }
  return { saved, toggle }
}

export default function Resources() {
  const { branch, profile } = useStudent()
  const api = useApi('candidate')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const initialTab = Object.values(TAB_PARAM).includes(params.get('tab')) ? params.get('tab') : 'all'
  const [tab, setTabState] = useState(initialTab)
  const [branchSel, setBranchSel] = useState('mine') // 'mine' | 'any' | branch id
  const [query, setQuery] = useState(params.get('q') || '')
  const [open, setOpen] = useState(null)
  const [email, setEmail] = useState('')
  const [subBusy, setSubBusy] = useState(false)
  const { saved, toggle } = useSavedResources()

  const setTab = (t) => { setTabState(t); const n = new URLSearchParams(params); if (t === 'all') n.delete('tab'); else n.set('tab', t); setParams(n, { replace: true }) }
  const activeBranch = branchSel === 'mine' ? branch.id : branchSel

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CATALOGUE.filter((r) => (tab === 'all' || (tab === 'saved' ? saved.has(r.id) : r.cat === tab))
      && (tab === 'saved' || activeBranch === 'any' || r.branch === activeBranch || r.branch === 'all')
      && (!q || `${r.title} ${r.desc} ${r.outline.join(' ')}`.toLowerCase().includes(q)))
  }, [tab, saved, activeBranch, query])
  const pg = usePagination(filtered, 8)

  const branchItems = CATALOGUE.filter((r) => r.branch === (activeBranch === 'any' ? branch.id : activeBranch))
  const featured = [
    branchItems.find((r) => r.cat === 'study'),
    branchItems.filter((r) => r.cat === 'study')[1],
    branchItems.find((r) => r.cat === 'software'),
    branchItems.find((r) => r.cat === 'project'),
  ].filter(Boolean)
  const top = [...CATALOGUE.filter((r) => r.branch === branch.id || r.branch === 'all')].sort((a, b) => SAMPLE_POPULARITY[b.id] - SAMPLE_POPULARITY[a.id]).slice(0, 5)
  const topics = [...new Set([...branch.topics, ...branch.skills.slice(0, 6)])]

  const subscribe = async (e) => {
    e.preventDefault()
    const v = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return toast('Enter a valid email address', 'error')
    setSubBusy(true)
    try {
      const r = await api.post('/api/student/newsletter', { email: v })
      toast(r.already ? 'You are already subscribed' : 'Subscribed — watch your inbox', 'success')
      setEmail('')
    } catch (x) { toast(x.message, 'error') } finally { setSubBusy(false) }
  }

  const columns = [
    {
      key: 'title', header: 'Resource', sortable: true, render: (r) => (
        <button type="button" className="st-res-title" onClick={() => setOpen(r)}>
          <FormatIcon r={r} />
          <span><b>{r.title}</b><small>{r.desc}</small></span>
        </button>
      ),
    },
    { key: 'format', header: 'Format', hideOnMobile: false, render: (r) => <span className="cl-muted" style={{ whiteSpace: 'nowrap' }}>{FORMAT_LABEL[r.format]} · {r.minutes} min</span> },
    { key: 'branch', header: 'Branch', render: (r) => <span className={`st-tag ${r.cat === 'career' ? 'purple' : 'blue'}`}>{r.cat === 'career' ? 'Career' : branchLabel(r.branch)}</span> },
    { key: 'added', header: 'Added', sortable: true, render: (r) => <span className="cl-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.added)}</span> },
    {
      key: 'act', header: '', align: 'right', render: (r) => (
        <div className="cl-row" style={{ gap: 2, justifyContent: 'flex-end' }}>
          <button type="button" className="cl-icon-btn" aria-label={`Download outline of ${r.title}`} title="Download outline" onClick={() => downloadOutline(r)}><Download size={17} /></button>
          <button type="button" className={`cl-icon-btn st-bookmark ${saved.has(r.id) ? 'on' : ''}`} aria-pressed={saved.has(r.id)} aria-label={saved.has(r.id) ? `Unsave ${r.title}` : `Save ${r.title}`} onClick={() => toggle(r.id)}><Bookmark size={17} /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="st-page">
      <div className="st-split">
        <div className="st-page">
          <Hero branch={branch} page="resources"
            title={<h1>Learning Resources<br /><em>for Future Engineers</em></h1>}
            text="Access curated study materials, technical notes, project references and interview resources to build your core engineering skills." />

          <Card flush><div style={{ padding: '0 10px' }}>
            <Tabs className="st-profile-tabs" tabs={CATEGORIES.map((c) => ({ ...c, icon: TAB_ICONS[c.id], count: c.id === 'saved' ? saved.size : undefined }))} value={tab} onChange={(t) => { setTab(t); pg.setPage(1) }} />
          </div></Card>

          <Card title={<><Compass size={20} style={{ color: 'var(--cl-blue)' }} />Explore by Branch</>}
            action={<ViewAll onClick={() => { setBranchSel(branchSel === 'any' ? 'mine' : 'any'); pg.setPage(1) }}>{branchSel === 'any' ? 'My branch only' : 'View All'}</ViewAll>}>
            <div className="st-branch-tiles">
              {BRANCHES.map((b) => {
                const active = activeBranch === b.id
                return (
                  <button key={b.id} type="button" className={`st-branch-tile ${active ? 'active' : ''}`} style={{ background: b.soft, color: b.color }} aria-pressed={active}
                    onClick={() => { setBranchSel(active ? 'any' : b.id); pg.setPage(1) }}>
                    <BranchIcon branch={b} size={26} /><span>{b.long.replace(' Engineering', '')}<br />{b.long.includes('Engineering') ? 'Engineering' : ''}</span>
                  </button>
                )
              })}
            </div>
          </Card>

          {tab === 'all' && !query && featured.length > 0 && (
            <Card title={<><Star size={20} style={{ color: '#f5a524' }} />Featured Resources <DemoTag title="Popularity counts are illustrative until a resources API exists" /></>} action={<ViewAll onClick={() => setTab('study')} />}>
              <div className="cl-grid cl-grid-4">
                {featured.map((r) => (
                  <div key={r.id} className="cl-media-card st-card-click" role="button" tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                    <div className="cl-media" style={{ aspectRatio: '16 / 9' }}>
                      <img src={thumbFor(r, branch)} alt="" loading="lazy" />
                      <span className={`st-tag ${CAT_TONE[r.cat]}`} style={{ position: 'absolute', left: 10, top: 10, background: '#fff' }}>{CATEGORY_LABEL[r.cat]}</span>
                    </div>
                    <div className="cl-media-body" style={{ gap: 6 }}>
                      <strong style={{ color: 'var(--cl-ink)', fontSize: 14.5 }}>{r.title}</strong>
                      <small className="cl-muted st-clamp-2">{r.desc}</small>
                      <div className="cl-row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginTop: 'auto' }}>
                        <span className="cl-row" style={{ gap: 6 }}><FormatIcon r={r} size={14} />{r.minutes} min</span>
                        <span className="cl-row cl-muted" style={{ gap: 4 }}><Download size={13} />{fmtCount(SAMPLE_POPULARITY[r.id])}</span>
                        <button type="button" className={`cl-icon-btn st-bookmark ${saved.has(r.id) ? 'on' : ''}`} aria-label={saved.has(r.id) ? 'Unsave' : 'Save'} aria-pressed={saved.has(r.id)} onClick={(e) => { e.stopPropagation(); toggle(r.id) }}><Bookmark size={16} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={<><Clock3 size={20} style={{ color: 'var(--cl-blue)' }} />{tab === 'saved' ? 'Saved Resources' : query ? `Results for “${query}”` : 'Latest Resources'}</>}
            subtitle={`${filtered.length} resource${filtered.length === 1 ? '' : 's'}${tab !== 'saved' && activeBranch !== 'any' ? ` · ${branchLabel(activeBranch)} + all branches` : ''}`}
            action={query ? <button className="cl-link" onClick={() => setQuery('')}>Clear search</button> : null}>
            <DataTable columns={columns} rows={pg.slice} rowKey={(r) => r.id}
              empty={tab === 'saved'
                ? <EmptyState icon={Bookmark} title="Nothing saved yet" text="Tap the bookmark on any resource to keep it here." action={<Button size="sm" variant="outline" onClick={() => setTab('all')}>Browse resources</Button>} />
                : <EmptyState icon={Search} title="No resources match" text="Try a different keyword, tab or branch." action={<Button size="sm" variant="outline" onClick={() => { setQuery(''); setBranchSel('any'); setTab('all') }}>Show everything</Button>} />} />
            <Pagination page={pg.page} pages={pg.pages} total={pg.total} pageSize={pg.pageSize} setPage={pg.setPage} noun="resources" />
          </Card>
        </div>

        <div className="st-right">
          <Card title={<><Search size={20} style={{ color: 'var(--cl-blue)' }} />Quick Search</>}>
            <Input icon={Search} type="search" value={query} onChange={(e) => { setQuery(e.target.value); pg.setPage(1) }} placeholder="Search resources, notes, tutorials…" aria-label="Search resources" maxLength={80} />
          </Card>

          <Card title={<><TrendingUp size={20} style={{ color: 'var(--cl-blue)' }} />Popular Topics</>} action={query ? <button className="cl-link" onClick={() => setQuery('')}>Clear</button> : null}>
            <div className="cl-chips">
              {topics.map((t) => (
                <button key={t} type="button" className={`cl-chip clickable ${query === t ? 'blue' : ''}`} aria-pressed={query === t} onClick={() => { setQuery(query === t ? '' : t); setTab('all'); pg.setPage(1) }}>{t}</button>
              ))}
            </div>
          </Card>

          <Card title={<><Download size={20} style={{ color: 'var(--cl-blue)' }} />Top Picks <DemoTag title="Ranking uses illustrative popularity until a resources API exists" /></>}>
            {top.map((r, i) => (
              <button key={r.id} type="button" className="st-rank st-rank-btn" onClick={() => setOpen(r)}>
                <b>{i + 1}</b>
                <img src={thumbFor(r, branch)} alt="" loading="lazy" />
                <span style={{ minWidth: 0 }}>
                  <span className="cl-ellipsis" style={{ display: 'block', color: 'var(--cl-ink)', fontSize: 13.5, fontWeight: 600 }}>{r.title}</span>
                  <small className="cl-muted cl-row" style={{ gap: 4 }}>{r.format === 'video' ? <Video size={12} /> : <FileText size={12} />}{FORMAT_LABEL[r.format]} · {r.minutes} min</small>
                </span>
                <small className="cl-muted cl-row" style={{ gap: 3 }}><Download size={12} />{fmtCount(SAMPLE_POPULARITY[r.id])}</small>
              </button>
            ))}
          </Card>

          <Card tint title={<><Mail size={20} style={{ color: 'var(--cl-blue)' }} />Stay Updated</>} subtitle="Get new study materials, interview tips and opportunities directly in your inbox.">
            <form className="st-chip-input" onSubmit={subscribe}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={profile?.contact_email || 'Enter your email address'} aria-label="Email address" maxLength={254} />
              <Button type="submit" loading={subBusy}>Subscribe</Button>
            </form>
          </Card>
        </div>
      </div>

      <ResourceModal r={open} branch={branch} onClose={() => setOpen(null)} saved={open && saved.has(open.id)} onToggle={() => toggle(open.id)} />
    </div>
  )
}

function ResourceModal({ r, branch, onClose, saved, onToggle }) {
  if (!r) return null
  return (
    <Modal open onClose={onClose} title={r.title} size="lg"
      footer={<>
        <Button variant="outline" icon={Bookmark} onClick={onToggle}>{saved ? 'Saved' : 'Save'}</Button>
        <Button icon={Download} onClick={() => downloadOutline(r)}>Download outline</Button>
      </>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <img src={thumbFor(r, branch)} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12 }} />
        <div className="cl-meta">
          <span className={`st-tag ${CAT_TONE[r.cat]}`}>{CATEGORY_LABEL[r.cat]}</span>
          <span><Layers size={14} /> {branchLabel(r.branch)}</span>
          <span>{r.format === 'video' ? <Video size={14} /> : <BookOpen size={14} />} {FORMAT_LABEL[r.format]} · ~{r.minutes} min</span>
          <span>Added {fmtDate(r.added)}</span>
        </div>
        <p style={{ fontSize: 14.5 }}>{r.desc}</p>
        <div>
          <h4 style={{ marginBottom: 8 }}>What you will cover</h4>
          <ol className="st-outline">{r.outline.map((o) => <li key={o}>{o}</li>)}</ol>
        </div>
        <Alert>This is a curated study guide. Use the free sources below for lectures and worked examples, and download the outline to take notes.</Alert>
        <div className="cl-row cl-wrap" style={{ gap: 10 }}>
          {searchLinks(r).map((l) => <Button key={l.label} variant="outline" size="sm" href={l.href} iconRight={ExternalLink}>{l.label}</Button>)}
        </div>
      </div>
    </Modal>
  )
}
