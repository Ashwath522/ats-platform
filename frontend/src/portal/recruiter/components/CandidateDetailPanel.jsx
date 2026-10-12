import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Award, Bookmark, Building2, CalendarDays, Download, ExternalLink, FileText, Github, GraduationCap, Linkedin, Lock, Mail,
  MapPin, Medal, MessageSquarePlus, Phone, Send, ShieldCheck, Star, Trash2, Pencil, Wrench, Globe, Briefcase,
} from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, Menu, Skeleton, StatusPill, Tabs, Textarea, fmtDate, fmtTime, timeAgo, useToast,
} from '../../../ui/index.jsx'
import { mediaUrl } from '../../../lib/api.js'
import { branchThumb } from '../../../branding/branches.js'
import { API, AiResultBody, MatchPill, StagePill, VerifiedTick, branchMeta, yearLine } from './RecruiterPipelineKit.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'resume', label: 'Resume' }, { id: 'projects', label: 'Projects' }, { id: 'skills', label: 'Skills' },
  { id: 'academic', label: 'Academic' }, { id: 'applications', label: 'Applications' }, { id: 'interviews', label: 'Interviews' }, { id: 'notes', label: 'Notes' },
]
const LEVEL_PCT = { beginner: 30, basic: 30, intermediate: 60, advanced: 85, expert: 100 }

const projThumb = (p, branch, i) => (p.image_path ? mediaUrl(p.image_path) : branchThumb(branchMeta(branch).id ? branch : 'mechanical', i))

function Section({ title, action, children }) {
  return <div className="rp-sub-card"><h4>{title}{action}</h4>{children}</div>
}

function StatTile({ icon: Icon, tone, value, label }) {
  return (
    <div className="rp-stat-tile">
      <span className={`cl-ico ${tone || ''}`}><Icon size={19} /></span>
      <div style={{ minWidth: 0 }}><strong title={String(value ?? '')}>{value ?? '—'}</strong><small>{label}</small></div>
    </div>
  )
}

function Education({ c }) {
  const list = c.education || []
  if (!list.length && !c.college) return <p className="cl-muted">No education details added.</p>
  const rows = list.length ? list : [{ level: c.degree || 'Degree', institution: c.college, end_year: c.grad_year, grade: c.cgpa ? `CGPA: ${c.cgpa}/10` : '' }]
  return rows.map((e, i) => (
    <div className="rp-edu" key={i}>
      <span className="cl-ico"><Building2 size={18} /></span>
      <div><strong>{e.level || e.degree || e.field_of_study || 'Education'}{e.field_of_study && e.level ? ` — ${e.field_of_study}` : ''}</strong><small>{e.institution || '—'}</small></div>
      <div className="r">{[e.start_year, e.end_year].filter(Boolean).join(' – ')}{e.grade ? <div>{String(e.grade).match(/^[\d.]+$/) ? `CGPA: ${e.grade}` : e.grade}</div> : null}</div>
    </div>
  ))
}

function Experience({ list = [] }) {
  if (!list.length) return <p className="cl-muted">No internships or work experience added yet.</p>
  return list.map((x, i) => (
    <div className="rp-edu" key={i}>
      <span className="cl-ico teal"><Briefcase size={18} /></span>
      <div><strong>{x.title || x.role || 'Role'}</strong><small>{[x.company, x.location].filter(Boolean).join(', ')}</small>
        {x.description && <p className="cl-muted" style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.description}</p>}</div>
      <div className="r">{[x.start, x.end || (x.start ? 'Present' : '')].filter(Boolean).join(' – ')}</div>
    </div>
  ))
}

function Achievements({ c }) {
  const items = [
    ...(c.certifications || []).map((x) => ({ title: x.name, sub: x.issuing_organization, year: (x.issue_date || '').slice(0, 4), icon: Medal, tone: 'red', url: x.credential_url })),
    ...(c.achievements || []).map((x) => (typeof x === 'string' ? { title: x, icon: Star, tone: 'amber' } : { title: x.title, sub: x.issuer, year: x.year, icon: Award, tone: 'amber' })),
  ]
  if (!items.length) return <p className="cl-muted">No achievements or certifications added.</p>
  return (
    <div className="cl-list">
      {items.slice(0, 6).map((a, i) => {
        const I = a.icon
        return (
          <div className="cl-list-item" key={i} style={{ padding: '8px 0' }}>
            <span className={`cl-ico ${a.tone}`} style={{ width: 32, height: 32 }}><I size={16} /></span>
            <div className="cl-grow"><div style={{ fontSize: 13.5, color: 'var(--cl-ink)', fontWeight: 500 }}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}</div>{a.sub && <small className="cl-muted">{a.sub}</small>}</div>
            <span className="cl-muted" style={{ fontSize: 12.5 }}>{a.year}</span>
          </div>
        )
      })}
    </div>
  )
}

function ProjectRow({ p, branch, i }) {
  return (
    <div className="rp-proj">
      <img src={projThumb(p, branch, i)} alt="" loading="lazy" />
      <div style={{ minWidth: 0 }}>
        <strong className="cl-ellipsis">{p.title}</strong>
        <div className="rp-skill-chips" style={{ marginTop: 4 }}>{[...(p.tags || []), ...(p.tools || [])].slice(0, 3).map((t) => <span key={t} className="cl-chip soft">{t}</span>)}</div>
      </div>
      <StatusPill status={p.status} />
    </div>
  )
}

function ResumeTab({ api, c }) {
  const toast = useToast()
  const [st, setSt] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    if (!c.applied) { setSt({ blocked: true }); return }
    api.get(`${API}/candidates/${c.candidate_id}/resume`).then((d) => alive && setSt({ data: d })).catch((e) => alive && setSt({ error: e }))
    return () => { alive = false }
  }, [api, c.candidate_id, c.applied])
  async function download() {
    try {
      const res = await api.request('GET', `${API}/candidates/${c.candidate_id}/resume/file`, undefined, { raw: true })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Download failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = st.data?.filename || 'resume'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1500)
    } catch (e) { toast(e.message, 'error') }
  }
  if (st.blocked) return <EmptyState icon={Lock} title="Resume available after they apply" text="Invite this candidate to one of your jobs — their resume becomes visible once they apply." />
  if (st.loading) return <Skeleton h={200} />
  if (st.error) return <EmptyState icon={FileText} title={st.error.status === 404 ? 'No resume uploaded' : 'Resume unavailable'} text={st.error.message} />
  return (
    <div className="cl-col" style={{ gap: 12 }}>
      <div className="cl-row cl-wrap" style={{ justifyContent: 'space-between' }}>
        <div className="cl-row"><span className="cl-ico red"><FileText size={18} /></span><div><strong>{st.data.filename}</strong><div className="cl-muted" style={{ fontSize: 12.5 }}>Uploaded {fmtDate(st.data.uploaded_at)}</div></div></div>
        <Button variant="outline" icon={Download} disabled={!st.data.file_available} title={st.data.file_available ? undefined : 'Original file not stored — showing extracted text'} onClick={download}>Download</Button>
      </div>
      {st.data.text ? <div className="rp-resume-text" tabIndex={0} aria-label="Resume text">{st.data.text}</div> : <p className="cl-muted">No text could be extracted from this resume.</p>}
    </div>
  )
}

function NotesTab({ api, c, onCount }) {
  const toast = useToast()
  const [notes, setNotes] = useState(null)
  const [text, setText] = useState('')
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = React.useCallback(() => api.get(`${API}/candidates/${c.candidate_id}/notes`).then((d) => { setNotes(d.notes); onCount?.(d.notes.length) }).catch((e) => toast(e.message, 'error')), [api, c.candidate_id, toast, onCount])
  useEffect(() => { load() }, [load])
  async function add() {
    if (!text.trim()) return toast('Write a note first', 'error')
    setBusy(true)
    try { await api.post(`${API}/candidates/${c.candidate_id}/notes`, { text: text.trim(), application_id: c.best_application_id || null }); setText(''); load(); toast('Note added', 'success') } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  async function saveEdit() {
    if (!edit.text.trim()) return toast('Note cannot be empty', 'error')
    try { await api.put(`${API}/notes/${edit.id}`, { text: edit.text.trim() }); setEdit(null); load() } catch (e) { toast(e.message, 'error') }
  }
  async function remove(n) {
    if (!window.confirm('Delete this note?')) return
    try { await api.del(`${API}/notes/${n.id}`); load(); toast('Note deleted', 'success') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="cl-col" style={{ gap: 12 }}>
      <label className="cl-field"><span>Private note</span><Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Only you can see notes. e.g. Strong in FEA, ask about internship project in round 2." /></label>
      <div><Button icon={MessageSquarePlus} loading={busy} onClick={add}>Add note</Button></div>
      {notes == null ? <Skeleton h={80} /> : notes.length === 0 ? <EmptyState title="No notes yet" text="Notes are private to your recruiter account." /> : notes.map((n) => (
        <div className="rp-note" key={n.id}>
          {edit?.id === n.id ? (
            <div className="cl-col" style={{ gap: 8 }}>
              <Textarea rows={3} maxLength={2000} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label="Edit note" />
              <div className="cl-row"><Button size="sm" onClick={saveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
            </div>
          ) : (
            <>
              <p>{n.text}</p>
              <div className="cl-row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <small>{timeAgo(n.created_at)}</small>
                <span className="cl-row" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ id: n.id, text: n.text })}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(n)}>Delete</Button>
                </span>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Right-hand candidate profile panel (page 15).
 * `c` = GET /portal/candidates/{id}. Actions are passed in by the page.
 */
export default function CandidateDetailPanel({ api, c, loading, error, onShortlist, onSchedule, onInvite, onNext, busy, onCompare }) {
  const [tab, setTab] = useState('overview')
  const [notesCount, setNotesCount] = useState(null)
  useEffect(() => { setTab('overview'); setNotesCount(null) }, [c?.candidate_id])
  if (loading && !c) return <Card className="rp-detail"><Skeleton h={120} /><div style={{ height: 16 }} /><Skeleton h={300} /></Card>
  if (error) return <Card className="rp-detail"><Alert tone="error">{error.message}</Alert></Card>
  if (!c) return <Card className="rp-detail"><EmptyState title="Select a candidate" text="Pick someone from the list to see their full profile." /></Card>
  const b = branchMeta(c.branch)
  const verifiedProjects = (c.projects || []).filter((p) => p.status === 'verified')
  const best = c.applications?.find((a) => a.application_id === c.best_application_id)
  const canShortlist = best && best.stage === 'under_review'
  const levels = c.skill_levels || {}

  return (
    <Card className="rp-detail" aria-label={`Profile of ${c.name}`}>
      <div className="rp-detail-head">
        <Avatar name={c.name} src={c.avatar_path} size={96} />
        <div style={{ minWidth: 0 }}>
          <div className="cl-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h2>{c.name}<VerifiedTick show={c.verified} size={20} /></h2>
            <div className="cl-row" style={{ gap: 6 }}>
              <MatchPill value={c.match} suffix=" Match" />
              <Menu label="More candidate actions" items={[
                { label: 'Add a note', icon: MessageSquarePlus, onClick: () => setTab('notes') },
                onCompare && { label: 'Compare with selected', icon: Star, onClick: onCompare },
                c.applied && { label: 'View in Applications', icon: FileText, to: `/recruiter/applications?job=${best?.job_id || ''}` },
                { label: 'Copy profile link', icon: ExternalLink, onClick: () => navigator.clipboard?.writeText(`${window.location.origin}/recruiter/candidates?id=${c.candidate_id}`) },
              ]} />
            </div>
          </div>
          <div className="sub">{yearLine(c) || 'Student'}<i>|</i>{c.college || 'College not added'}</div>
          <div className="sub" style={{ marginTop: 2, color: 'var(--cl-text)' }}>{b.long}{c.degree ? ` · ${c.degree}` : ''}</div>
          <div className="rp-contact">
            {c.location && <span><MapPin size={15} />{c.location}</span>}
            {c.contact_visible ? (<>
              {c.email && <a href={`mailto:${c.email}`}><Mail size={15} />{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`}><Phone size={15} />{c.phone}</a>}
            </>) : <span title={c.contact_hidden_reason}><Lock size={15} />Contact hidden until they apply</span>}
          </div>
          <div className="rp-contact">
            {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={15} color="#0a66c2" />LinkedIn</a>}
            {c.github_url && <a href={c.github_url} target="_blank" rel="noreferrer"><Github size={15} />GitHub</a>}
            {c.portfolio_url && <a href={c.portfolio_url} target="_blank" rel="noreferrer"><Globe size={15} />Portfolio</a>}
          </div>
        </div>
        <div className="rp-detail-actions">
          {c.applied ? (<>
            <Button icon={Bookmark} disabled={!canShortlist} loading={busy === 'shortlist'} onClick={() => onShortlist(best)} title={!canShortlist ? 'Already shortlisted or past this stage' : undefined}>{canShortlist ? 'Shortlist Candidate' : best?.stage === 'rejected' ? 'Rejected' : 'Shortlisted'}</Button>
            <Button variant="outline" icon={CalendarDays} disabled={!best || best.stage === 'rejected'} onClick={() => onSchedule(best)}>Schedule Interview</Button>
            <Button variant="outline" icon={ArrowRight} loading={busy === 'next'} disabled={!best} onClick={() => onNext(best)}>Move to Next Stage</Button>
          </>) : (<>
            <Button icon={Send} disabled={!c.invitable_jobs?.length} title={!c.invitable_jobs?.length ? 'You have no open jobs to share' : undefined} onClick={onInvite}>Invite to Apply</Button>
            <p className="cl-muted" style={{ fontSize: 12.5 }}>{c.name.split(' ')[0]} hasn't applied to your jobs yet. Invite them to an open role to shortlist and schedule interviews.</p>
          </>)}
        </div>
      </div>

      <Tabs className="rp-detail-tabs" tabs={TABS.map((t) => ({ ...t, count: t.id === 'applications' ? c.applications?.length : t.id === 'projects' ? c.projects?.length : t.id === 'notes' ? (notesCount ?? c.notes_count) : undefined }))} value={tab} onChange={setTab} />

      <div style={{ marginTop: 14 }}>
        {tab === 'overview' && (<>
          <div className="rp-stat-tiles" style={{ marginTop: 0 }}>
            <StatTile icon={GraduationCap} value={c.cgpa != null ? c.cgpa.toFixed(1) : '—'} label="CGPA (out of 10)" />
            <StatTile icon={Award} tone="purple" value={c.grad_year} label="Graduation Year" />
            <StatTile icon={Building2} tone="teal" value={c.college} label="Institute" />
            <StatTile icon={Wrench} value={b.id ? b.label : '—'} label="Branch" />
          </div>
          <div className="rp-two">
            <div>
              <Section title="About"><p>{c.bio || c.headline || <span className="cl-muted">No summary added yet.</span>}</p></Section>
              <Section title="Education"><Education c={c} /></Section>
              <Section title="Experience"><Experience list={c.experience} /></Section>
            </div>
            <div>
              <Section title="Key Skills" action={<button type="button" className="cl-link" onClick={() => setTab('skills')}>View All</button>}>
                {c.skills?.length ? <div className="cl-chips">{c.skills.slice(0, 10).map((s) => <span key={s} className="cl-chip blue">{s}</span>)}</div> : <p className="cl-muted">No skills listed.</p>}
              </Section>
              <Section title="Verified Projects" action={<button type="button" className="cl-link" onClick={() => setTab('projects')}>View All</button>}>
                {verifiedProjects.length ? verifiedProjects.slice(0, 3).map((p, i) => <ProjectRow key={p.id} p={p} branch={c.branch} i={i} />) : <p className="cl-muted">No verified projects yet{c.projects?.length ? ` — ${c.projects.length} under review or submitted` : ''}.</p>}
              </Section>
              <Section title="Achievements & Certifications"><Achievements c={c} /></Section>
            </div>
          </div>
        </>)}

        {tab === 'resume' && <ResumeTab api={api} c={c} />}

        {tab === 'projects' && (c.projects?.length ? (
          <div className="rp-proj-grid">
            {c.projects.map((p, i) => (
              <div key={p.id} className="cl-card cl-media-card">
                <div className="cl-media"><img src={projThumb(p, c.branch, i)} alt="" loading="lazy" /><span className="cl-media-tag"><StatusPill status={p.status} /></span></div>
                <div className="cl-media-body">
                  <h4>{p.title}</h4>
                  <p className="cl-muted" style={{ fontSize: 13 }}>{p.description || 'No description.'}</p>
                  <div className="rp-skill-chips">{[...(p.tags || []), ...(p.tools || [])].slice(0, 5).map((t) => <span key={t} className="cl-chip soft">{t}</span>)}</div>
                  <div className="cl-meta">{p.month && <span>{p.month}</span>}<span>{p.category}</span>{p.team_size > 1 && <span>Team of {p.team_size}</span>}</div>
                  {p.links?.map((l) => l?.url && <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="cl-link">{l.label || 'Link'}</a>)}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No projects shared" text="This candidate hasn't added any projects yet." />)}

        {tab === 'skills' && (<div className="rp-two">
          <Section title={`Skills (${c.skills?.length || 0})`}>
            {c.skills?.length ? c.skills.map((s) => {
              const lvl = levels[s]
              return (
                <div className="cl-progress-row" key={s} style={{ marginTop: 10 }}>
                  <span className="cl-ellipsis">{s}</span>
                  {lvl ? <><div className="cl-progress"><div style={{ width: `${LEVEL_PCT[String(lvl).toLowerCase()] || 50}%` }} /></div><span style={{ fontSize: 12.5, color: 'var(--cl-muted)' }}>{lvl}</span></> : <><span /><span className="cl-faint" style={{ fontSize: 12.5 }}>Level not set</span></>}
                </div>
              )
            }) : <p className="cl-muted">No skills listed.</p>}
          </Section>
          <div>
            <Section title="Interests">{c.interests?.length ? <div className="cl-chips">{c.interests.map((s) => <span key={s} className="cl-chip soft">{s}</span>)}</div> : <p className="cl-muted">No interests added.</p>}</Section>
            {c.applications?.length > 0 && (
              <Section title="Matched to your jobs">
                {c.applications.map((a) => <div key={a.application_id} className="cl-row" style={{ justifyContent: 'space-between', padding: '6px 0' }}><span>{a.job_title}</span><MatchPill value={a.match} /></div>)}
              </Section>
            )}
          </div>
        </div>)}

        {tab === 'academic' && (<div className="rp-two">
          <div>
            <Section title="Current programme">
              <div className="cl-col" style={{ gap: 8, fontSize: 13.5 }}>
                <div><span className="cl-muted">Degree: </span>{c.degree || '—'}</div>
                <div><span className="cl-muted">Institute: </span>{c.college || '—'}</div>
                <div><span className="cl-muted">Branch: </span>{b.long}</div>
                <div><span className="cl-muted">Year: </span>{c.current_year || '—'}</div>
                <div><span className="cl-muted">Graduation: </span>{c.grad_year || '—'}</div>
                <div><span className="cl-muted">CGPA: </span>{c.cgpa != null ? `${c.cgpa} / 10` : '—'}</div>
              </div>
            </Section>
            <Section title="Education history"><Education c={c} /></Section>
          </div>
          <Section title="Achievements & Certifications"><Achievements c={c} /></Section>
        </div>)}

        {tab === 'applications' && (c.applications?.length ? (
          <div className="cl-table-wrap rp-compact">
            <table className="cl-table cards">
              <thead><tr><th>Job</th><th>Applied</th><th>Match</th><th>ATS</th><th>Project</th><th>Interview</th><th>Stage</th><th /></tr></thead>
              <tbody>{c.applications.map((a) => (
                <tr key={a.application_id}>
                  <td data-label="Job"><div className="rp-job-title"><strong>{a.job_title}</strong><small>{a.job_code}</small></div></td>
                  <td data-label="Applied">{fmtDate(a.applied_at)}</td>
                  <td data-label="Match"><MatchPill value={a.match} /></td>
                  <td data-label="ATS">{a.ats_score ?? '—'}</td>
                  <td data-label="Project">{a.project_score != null ? Math.round(a.project_score) : '—'}</td>
                  <td data-label="Interview">{a.interview_eval_score ?? (a.interview_status && a.interview_status !== 'locked' ? a.interview_status.replace('_', ' ') : '—')}</td>
                  <td data-label="Stage"><StagePill stage={a.stage} /></td>
                  <td><Link className="cl-link" to={`/recruiter/applications?job=${a.job_id}`}>Open</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No applications to your jobs" text="Use “Invite to Apply” to share one of your open roles." />)}

        {tab === 'interviews' && (
          <div className="cl-col" style={{ gap: 16 }}>
            <Section title="Scheduled interview rounds">
              {c.interviews?.scheduled?.length ? (
                <div className="cl-list rp-upcoming">{c.interviews.scheduled.map((s) => (
                  <div className="cl-list-item" key={s.id}>
                    <span className="cl-ico"><CalendarDays size={18} /></span>
                    <div className="cl-grow"><strong>{s.round_name}</strong><small>{s.job_title} · {s.mode}{s.interviewers ? ` · ${s.interviewers}` : ''}</small>
                      {s.feedback?.notes && <small>Feedback: {s.feedback.notes}{s.feedback.rating ? ` (${s.feedback.rating}/5)` : ''}</small>}</div>
                    <time>{fmtDate(s.starts_at)}<br />{fmtTime(s.starts_at)}</time>
                    <StatusPill status={s.status} />
                  </div>
                ))}</div>
              ) : <p className="cl-muted">No human interview rounds scheduled yet.</p>}
            </Section>
            {c.interviews?.ai?.length ? c.interviews.ai.map((ai) => (
              <Section key={ai.application_id} title={<span className="cl-row"><ShieldCheck size={18} color="var(--cl-blue)" />AI interview — {ai.job_title}</span>}><AiResultBody d={ai} /></Section>
            )) : <Section title="AI interview"><p className="cl-muted">No AI interview yet. Shortlist the candidate and use “Move to Next Stage” after project verification to unlock it.</p></Section>}
          </div>
        )}

        {tab === 'notes' && <NotesTab api={api} c={c} onCount={setNotesCount} />}
      </div>
      {best && <p className="cl-muted" style={{ fontSize: 12.5, marginTop: 14 }}>Current stage for {best.job_title}: <StagePill stage={best.stage} /></p>}
      {!c.applied && c.match != null && <p className="cl-muted" style={{ fontSize: 12.5, marginTop: 14 }}><Badge tone="blue">AI</Badge> Match is the overlap between {c.name.split(' ')[0]}'s skills and your open jobs' required skills.</p>}
    </Card>
  )
}
