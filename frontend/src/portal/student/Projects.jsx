import React, { useMemo, useState } from 'react'
import {
  ArrowRight, Plus, Filter, Pencil, Trash2, Send, ShieldCheck, FileUp, ImagePlus, Paperclip, BadgeCheck, Box, GraduationCap, User,
  Clock, Users, Star, CalendarDays, Search, Hexagon, ExternalLink, CheckCircle2, ClipboardCheck, BarChart3, Eye, Info,
} from 'lucide-react'
import { Alert, Button, Card, EmptyState, Field, Hero, Input, Menu, Modal, SearchInput, Select, Skeleton, Tabs, Textarea, Badge, useToast } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { branchThumb } from '../../branding/branches.js'
import { mediaUrl } from '../../lib/api.js'
import { useStudent } from './StudentShell.jsx'
import './components/student.css'

const TABS = [
  { id: 'all', label: 'All Projects' }, { id: 'academic', label: 'Academic' }, { id: 'personal', label: 'Personal' },
  { id: 'team', label: 'Team Projects' }, { id: 'verified', label: 'Verified' },
]
const CAT_LABEL = { academic: 'Academic Project', personal: 'Personal Project', team: 'Team Project' }
const STATUS = {
  verified: { label: 'Verified', tone: 'green', icon: CheckCircle2 },
  under_review: { label: 'Under Review', tone: 'amber', icon: Clock },
  draft: { label: 'Draft', tone: '', icon: Pencil },
  rejected: { label: 'Needs changes', tone: 'red', icon: Info },
}
const ATTACH_EXT = ['.zip', '.pdf', '.step', '.stp', '.stl', '.dwg']

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.draft
  return <Badge tone={s.tone} style={{ background: s.tone ? undefined : '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.12)' }}><s.icon size={13} />{s.label}</Badge>
}

export default function Projects() {
  const api = useApi('candidate')
  const toast = useToast()
  const { branch, reload: reloadProfile } = useStudent()
  const q = useQuery(() => api.get('/api/student/projects'), [api])
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState('updated')
  const [showFilter, setShowFilter] = useState(false)
  const [editing, setEditing] = useState(null) // null | {} (new) | project
  const [viewing, setViewing] = useState(null)
  const [learn, setLearn] = useState(false)

  const projects = q.data?.projects || []
  const stats = q.data?.stats
  const list = useMemo(() => {
    let l = projects
    if (tab === 'verified') l = l.filter((p) => p.status === 'verified')
    else if (tab === 'team') l = l.filter((p) => p.category === 'team' || p.team_size > 1)
    else if (tab !== 'all') l = l.filter((p) => p.category === tab)
    if (statusFilter) l = l.filter((p) => p.status === statusFilter)
    const s = search.trim().toLowerCase()
    if (s) l = l.filter((p) => [p.title, p.description, ...p.tags, ...p.tools].join(' ').toLowerCase().includes(s))
    if (sort === 'title') l = [...l].sort((a, b) => a.title.localeCompare(b.title))
    return l
  }, [projects, tab, search, statusFilter, sort])
  const featured = projects.find((p) => p.featured) || projects.find((p) => p.status === 'verified')

  const refresh = async () => { await q.reload(); reloadProfile() }
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); refresh() } catch (e) { toast(e.message, 'error') } }
  const submit = (p) => act(() => api.post(`/api/student/projects/${p.id}/submit`), 'Submitted for verification')
  const remove = (p) => { if (window.confirm(`Delete “${p.title}”? This cannot be undone.`)) act(() => api.del(`/api/student/projects/${p.id}`), 'Project deleted') }
  const feature = (p) => act(() => api.put(`/api/student/projects/${p.id}`, { featured: !p.featured }), p.featured ? 'Removed from featured' : 'Set as featured project')

  const statTiles = stats ? [
    { v: stats.total, l: 'Total Projects', icon: Box, c: 'var(--cl-blue)' },
    { v: stats.verified, l: 'Verified', icon: CheckCircle2, c: 'var(--cl-green)' },
    { v: stats.academic, l: 'Academic', icon: GraduationCap, c: 'var(--cl-purple)' },
    { v: stats.personal, l: 'Personal', icon: User, c: 'var(--cl-red)' },
    { v: stats.under_review, l: 'Under Review', icon: Clock, c: '#f5a524' },
    { v: stats.team, l: 'Team Projects', icon: Users, c: 'var(--cl-blue)' },
  ] : []

  return (
    <div className="st-page">
      <Hero branch={branch} page="projects" title="My Projects" text="Showcase your work, get it verified and make your skills visible to top companies."
        actions={<Button variant="white" iconRight={ArrowRight} onClick={() => setEditing({})}>Add New Project</Button>} />

      <div className="st-split">
        <div className="st-page">
          <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
            <Tabs tabs={TABS.map((t) => ({ ...t, count: t.id === 'all' ? undefined : undefined }))} value={tab} onChange={setTab} />
            <div className="cl-row" style={{ flex: '1 1 300px', maxWidth: 380 }}>
              <div className="cl-grow"><SearchInput icon={Search} value={search} onChange={setSearch} placeholder="Search projects…" /></div>
              <Button variant="secondary" icon={Filter} onClick={() => setShowFilter((x) => !x)} aria-expanded={showFilter}>Filter</Button>
            </div>
          </div>
          {showFilter && (
            <Card>
              <div className="cl-filters">
                <Field label="Status"><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} placeholder="All statuses" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
                <Field label="Sort by"><Select value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: 'updated', label: 'Recently updated' }, { value: 'title', label: 'Title (A–Z)' }]} /></Field>
                <Button variant="ghost" onClick={() => { setStatusFilter(''); setSort('updated'); setSearch('') }}>Clear</Button>
              </div>
            </Card>
          )}
          {q.error && <Alert tone="error">{q.error.message}</Alert>}
          {q.loading ? <div className="st-proj-grid">{[0, 1, 2].map((i) => <Skeleton key={i} h={330} />)}</div>
            : list.length === 0 ? (
              <Card><EmptyState icon={Box} title={projects.length ? 'No projects match' : 'No projects yet'}
                text={projects.length ? 'Try a different tab or search.' : 'Add your academic, personal and team projects — with images and CAD files — and submit them for verification.'}
                action={!projects.length && <Button icon={Plus} onClick={() => setEditing({})}>Add your first project</Button>} /></Card>
            ) : (
              <div className="st-proj-grid">
                {list.map((p, i) => (
                  <article key={p.id} className="cl-card cl-media-card st-proj-card">
                    <div className="cl-media">
                      <img src={p.image_url ? mediaUrl(p.image_url) : branchThumb(branch, i)} alt={p.image_url ? p.title : ''} loading="lazy" />
                      <span className="cl-media-tag"><StatusBadge status={p.status} /></span>
                      <div className="cl-media-act" style={{ padding: 0 }}>
                        <Menu label={`Actions for ${p.title}`} items={[
                          { label: 'View details', icon: Eye, onClick: () => setViewing(p) },
                          { label: 'Edit', icon: Pencil, onClick: () => setEditing(p) },
                          (p.status === 'draft' || p.status === 'rejected') && { label: 'Submit for verification', icon: Send, onClick: () => submit(p) },
                          { label: p.featured ? 'Unfeature' : 'Set as featured', icon: Star, onClick: () => feature(p) },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(p) },
                        ]} />
                      </div>
                    </div>
                    <div className="cl-media-body">
                      <h4 className="st-card-click" onClick={() => setViewing(p)}>{p.title}</h4>
                      <p>{p.description || 'No description yet.'}</p>
                      <div className="st-tag-row">{[...p.tags, ...p.tools].slice(0, 4).map((t) => <span key={t} className="st-tag blue">{t}</span>)}</div>
                      <div className="st-proj-foot">
                        <span><Hexagon size={14} />{CAT_LABEL[p.category]}</span>
                        {p.month && <span><CalendarDays size={14} />{p.month}</span>}
                        <span title="Team size"><Users size={14} />{p.team_size}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
        </div>

        <div className="st-right">
          <Button size="lg" block icon={Plus} onClick={() => setEditing({})}>Add New Project</Button>
          <Card>
            <div className="cl-row" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
              <ShieldCheck size={30} color="var(--cl-blue)" />
              <div><h3 style={{ fontSize: 17 }}>Project Verification</h3><p className="cl-muted" style={{ fontSize: 13.5 }}>Get your projects verified to increase trust with recruiters.</p></div>
            </div>
            <ul className="st-steps">
              <li><ClipboardCheck size={17} />Upload project details</li>
              <li><ImagePlus size={17} />Add images / documents</li>
              <li><FileUp size={17} />Include relevant files (CAD, code etc.)</li>
              <li><BadgeCheck size={17} />Get verified by our team</li>
            </ul>
            <Button variant="outline" block size="sm" iconRight={ArrowRight} style={{ marginTop: 16 }} onClick={() => setLearn(true)}>Learn More</Button>
          </Card>
          <Card title={<><BarChart3 size={20} />Project Stats</>}>
            {!stats ? <Skeleton h={150} /> : (
              <div className="st-stat-grid">
                {statTiles.map((t) => <div key={t.l} className="st-stat-mini"><t.icon size={20} color={t.c} /><div><b>{t.v}</b><small>{t.l}</small></div></div>)}
              </div>
            )}
          </Card>
          <Card title={<><Star size={20} color="#f5a524" fill="#f5a524" />Featured Project</>}>
            {featured ? (
              <div className="cl-row" style={{ alignItems: 'stretch' }}>
                <img src={featured.image_url ? mediaUrl(featured.image_url) : branchThumb(branch, 0)} alt="" style={{ width: 104, height: 88, objectFit: 'cover', borderRadius: 10 }} />
                <div className="cl-col" style={{ gap: 6 }}>
                  <strong style={{ color: 'var(--cl-ink)' }}>{featured.title}</strong>
                  <div><StatusBadge status={featured.status} /></div>
                  <Button variant="outline" size="sm" iconRight={ArrowRight} onClick={() => setViewing(featured)}>View Project</Button>
                </div>
              </div>
            ) : <p className="cl-muted" style={{ fontSize: 13.5 }}>Mark a project as featured from its ⋯ menu to highlight it on your profile.</p>}
          </Card>
        </div>
      </div>

      <ProjectModal project={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <ProjectView project={viewing} branch={branch} onClose={() => setViewing(null)} onEdit={(p) => { setViewing(null); setEditing(p) }} onSubmit={(p) => { setViewing(null); submit(p) }} />
      <Modal open={learn} onClose={() => setLearn(false)} title="How project verification works" footer={<Button onClick={() => setLearn(false)}>Got it</Button>}>
        <ol className="cl-col" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Add a clear title and a description of at least 30 characters: the problem, your approach and the result.</li>
          <li>Attach evidence — a photo or render, and files such as ZIP, PDF report, STEP/STL models or DWG drawings (up to 20 MB), or a link to your repository.</li>
          <li>Choose <b>Submit for verification</b>. The status changes to <i>Under Review</i>.</li>
          <li>The CoreLink team reviews the evidence and marks the project <i>Verified</i> or asks for changes.</li>
          <li>Editing the title or description of a verified project sends it back to Draft so it can be re-checked.</li>
        </ol>
      </Modal>
    </div>
  )
}

function ProjectView({ project: p, branch, onClose, onEdit, onSubmit }) {
  if (!p) return null
  return (
    <Modal open onClose={onClose} size="lg" title={p.title}
      footer={<><Button variant="secondary" icon={Pencil} onClick={() => onEdit(p)}>Edit</Button>{(p.status === 'draft' || p.status === 'rejected') && <Button icon={Send} onClick={() => onSubmit(p)}>Submit for verification</Button>}</>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <img src={p.image_url ? mediaUrl(p.image_url) : branchThumb(branch, 0)} alt="" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 12 }} />
        <div className="cl-row cl-wrap"><StatusBadge status={p.status} /><Badge>{CAT_LABEL[p.category]}</Badge>{p.month && <Badge>{p.month}</Badge>}<Badge><Users size={12} /> Team of {p.team_size}</Badge></div>
        {p.verification_note && <Alert tone="warn">{p.verification_note}</Alert>}
        <p className="st-pre">{p.description || 'No description.'}</p>
        <div className="st-tag-row">{[...p.tags, ...p.tools].map((t) => <span key={t} className="st-tag blue">{t}</span>)}</div>
        {(p.links.length > 0 || p.file_url) && (
          <div className="cl-col" style={{ gap: 6 }}>
            {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {l.label}: {l.url}</a>)}
            {p.file_url && <a href={mediaUrl(p.file_url)} target="_blank" rel="noreferrer"><Paperclip size={14} /> {p.file_name}</a>}
          </div>
        )}
      </div>
    </Modal>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function ProjectModal({ project, onClose, onSaved }) {
  const api = useApi('candidate')
  const toast = useToast()
  const isNew = project && !project.id
  const [f, setF] = useState({})
  const [image, setImage] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState({})
  React.useEffect(() => {
    if (!project) return
    const [m, y] = (project.month || '').split(' ')
    setF({
      title: project.title || '', description: project.description || '', category: project.category || 'academic',
      tags: (project.tags || []).join(', '), tools: (project.tools || []).join(', '), team_size: project.team_size || 1,
      month: m || '', year: y || String(new Date().getFullYear()),
      link_label: project.links?.[0]?.label || '', link_url: project.links?.[0]?.url || '',
    })
    setImage(null); setFile(null); setErr({})
  }, [project])
  if (!project) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    const e = {}
    if (f.title.trim().length < 2) e.title = 'Title is required'
    if (f.link_url && !/^https?:\/\/\S+/i.test(f.link_url)) e.link_url = 'Must start with http:// or https://'
    if (Number(f.team_size) < 1 || Number(f.team_size) > 50) e.team_size = '1–50'
    if (image && image.size > 5 * 1024 * 1024) e.image = 'Image must be ≤ 5 MB'
    if (file) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!ATTACH_EXT.includes(ext)) e.file = 'Allowed: ZIP, PDF, STEP, STL, DWG'
      else if (file.size > 20 * 1024 * 1024) e.file = 'Attachment must be ≤ 20 MB'
    }
    setErr(e)
    if (Object.keys(e).length) return
    const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
    const body = {
      title: f.title.trim(), description: f.description.trim(), category: f.category, tags: split(f.tags), tools: split(f.tools),
      team_size: Number(f.team_size) || 1, month: f.month ? `${f.month} ${f.year}` : '',
      links: f.link_url ? [{ label: f.link_label.trim() || 'Link', url: f.link_url.trim() }] : [],
    }
    setBusy(true)
    try {
      const p = isNew ? await api.post('/api/student/projects', body) : await api.put(`/api/student/projects/${project.id}`, body)
      if (image) { const fd = new FormData(); fd.append('file', image); await api.post(`/api/student/projects/${p.id}/image`, fd) }
      if (file) { const fd = new FormData(); fd.append('file', file); await api.post(`/api/student/projects/${p.id}/attachment`, fd) }
      toast(isNew ? 'Project added' : 'Project updated', 'success')
      onSaved()
      onClose()
    } catch (x) { toast(x.message, 'error'); onSaved() } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? 'Add new project' : 'Edit project'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? 'Add project' : 'Save changes'}</Button></>}>
      {!isNew && project.status === 'verified' && <Alert tone="warn">Changing the title or description of a verified project sends it back to Draft for re-verification.</Alert>}
      <div className="cl-grid cl-grid-2" style={{ marginTop: 10 }}>
        <Field label="Project title *" error={err.title} className="span-2"><Input value={f.title || ''} onChange={set('title')} maxLength={160} placeholder="e.g. Design and Analysis of Spur Gearbox" /></Field>
        <Field label="Description" className="span-2" hint="Problem, your approach, tools and measurable results."><Textarea value={f.description || ''} onChange={set('description')} maxLength={4000} /></Field>
        <Field label="Category"><Select value={f.category} onChange={set('category')} options={[{ value: 'academic', label: 'Academic' }, { value: 'personal', label: 'Personal' }, { value: 'team', label: 'Team' }]} /></Field>
        <Field label="Team size" error={err.team_size}><Input type="number" min={1} max={50} value={f.team_size} onChange={set('team_size')} /></Field>
        <Field label="Tags" hint="Comma separated, e.g. CAD Design, FEA"><Input value={f.tags || ''} onChange={set('tags')} /></Field>
        <Field label="Tools / software" hint="e.g. SolidWorks, ANSYS"><Input value={f.tools || ''} onChange={set('tools')} /></Field>
        <Field label="Month"><Select value={f.month} onChange={set('month')} placeholder="—" options={MONTHS} /></Field>
        <Field label="Year"><Input type="number" min={2000} max={2040} value={f.year} onChange={set('year')} /></Field>
        <Field label="Link label"><Input value={f.link_label || ''} onChange={set('link_label')} placeholder="GitHub / GrabCAD / Report" maxLength={40} /></Field>
        <Field label="Link URL" error={err.link_url}><Input value={f.link_url || ''} onChange={set('link_url')} placeholder="https://…" /></Field>
        <Field label={project.image_url ? 'Replace image' : 'Project image'} error={err.image} hint="PNG / JPG / WEBP, max 5 MB"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setImage(e.target.files?.[0] || null)} /></Field>
        <Field label={project.file_name ? `Replace attachment (${project.file_name})` : 'Attachment'} error={err.file} hint="ZIP, PDF, STEP, STL or DWG, max 20 MB"><input type="file" accept={ATTACH_EXT.join(',')} onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
    </Modal>
  )
}
