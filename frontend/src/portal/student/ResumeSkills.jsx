import React, { useMemo, useRef, useState } from 'react'
import {
  CloudUpload, FileText, CheckCircle2, Sparkles, Lightbulb, ChevronRight, ArrowRight, Users, Plus, Search, Award, BarChart3,
  FileCheck2, Target, FolderKanban, BadgeCheck, LayoutTemplate, RefreshCw, Eye, Upload, KeyRound, Wrench,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Chip, EmptyState, Hero, Menu, Modal, Progress, Ring, Skeleton, useToast, fmtDate } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { useStudent } from './StudentShell.jsx'
import { useProfileSave, openAuthedFile } from './components/editors.jsx'
import { CertificationsList, useCertModal } from './components/certs.jsx'
import JobFit from './components/JobFit.jsx'
import './components/student.css'

const BAR_STYLE = {
  content: { icon: FileCheck2, tone: 'green', color: 'var(--cl-green)' },
  skills: { icon: Target, tone: '', color: 'var(--cl-blue)' },
  projects: { icon: FolderKanban, tone: 'amber', color: '#f5a524' },
  certifications: { icon: BadgeCheck, tone: '', color: '#2f80ed' },
  format: { icon: LayoutTemplate, tone: 'purple', color: 'var(--cl-purple)' },
}
const SUGG_ICON = { projects: FolderKanban, skills: KeyRound, certifications: Award, format: LayoutTemplate, ai: Sparkles }
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const LEVEL_PCT = { Beginner: 30, Intermediate: 62, Advanced: 88 }
const LEVEL_COLOR = { Beginner: 'var(--cl-purple)', Intermediate: '#f5a524', Advanced: 'var(--cl-blue)' }
const ALLOWED = ['.pdf', '.docx']

export default function ResumeSkills() {
  const api = useApi('candidate')
  const toast = useToast()
  const { profile, setProfile, branch } = useStudent()
  const [save] = useProfileSave()
  const insights = useQuery(() => api.get('/api/student/resume/insights'), [api])
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [detail, setDetail] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [skillQ, setSkillQ] = useState('')
  const fileRef = useRef(null)
  const cert = useCertModal()

  const ins = insights.data
  const skills = profile?.skills || []
  const levels = profile?.skill_levels || {}
  const suggested = useMemo(() => {
    const have = new Set(skills.map((s) => s.toLowerCase()))
    const pool = [...(ins?.suggested_skills || []), ...branch.skills]
    return [...new Set(pool)].filter((s) => !have.has(s.toLowerCase())).slice(0, 12)
  }, [ins, branch, skills])

  const upload = async (file) => {
    if (!file) return
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED.includes(ext)) { toast('Please upload a PDF or DOCX file', 'error'); return }
    if (file.size > 5 * 1024 * 1024) { toast('File is larger than 5 MB', 'error'); return }
    const fd = new FormData()
    fd.append('file', file)
    setUploading(true)
    try {
      setProfile(await api.post('/api/candidate/profile/resume', fd))
      toast('Resume uploaded — analysing…', 'success')
      await insights.reload()
    } catch (e) { toast(e.message, 'error') } finally { setUploading(false) }
  }
  const reanalyse = async () => {
    setRefreshing(true)
    try { insights.setData(await api.get('/api/student/resume/insights?refresh=true')); toast('Analysis refreshed', 'success') } catch (e) { toast(e.message, 'error') } finally { setRefreshing(false) }
  }

  const addSkill = async (raw) => {
    const s = String(raw || '').trim().slice(0, 50)
    if (!s) return
    if (skills.some((x) => x.toLowerCase() === s.toLowerCase())) { toast(`${s} is already in your skills`); return }
    if (skills.length >= 40) { toast('You can add up to 40 skills', 'error'); return }
    try { await save({ skills: [...skills, s] }, `Added ${s}`); setSkillQ('') } catch { /* toast shown */ }
  }
  const removeSkill = async (s) => {
    const nextLevels = { ...levels }
    delete nextLevels[s]
    try { await save({ skills: skills.filter((x) => x !== s), skill_levels: nextLevels }, `Removed ${s}`) } catch { /* */ }
  }
  const setLevel = async (s, lvl) => {
    const next = { ...levels }
    if (lvl) next[s] = lvl; else delete next[s]
    try { await save({ skill_levels: next }, `${s}: ${lvl || 'level cleared'}`) } catch { /* */ }
  }

  const resume = profile?.resume
  const scoreColor = !ins?.has_resume ? 'transparent' : ins.score >= 70 ? '#0b5cff' : ins.score >= 45 ? '#f59e0b' : '#ef4444'

  return (
    <div className="st-page">
      <Hero branch={branch} page="resume" title="Resume & Skills" text="Showcase your skills and get AI-powered feedback to stand out to top companies." />

      <div className="cl-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card title={<><FileText size={20} />Upload Your Resume</>}>
          <input ref={fileRef} type="file" accept=".pdf,.docx" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
          <div className={`st-drop ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files?.[0]) }}>
            <CloudUpload size={44} color="#2f7bff" />
            <strong>Drag and drop your resume here</strong>
            <small className="cl-muted">PDF or DOCX (Max 5 MB)</small>
            <Button block loading={uploading} onClick={() => fileRef.current?.click()} style={{ marginTop: 10, maxWidth: 320 }}>Choose File</Button>
          </div>
          {resume && (
            <div className="st-file-row" style={{ marginTop: 14 }}>
              <span className="cl-ico red"><FileText size={20} /></span>
              <div className="cl-grow" style={{ minWidth: 0 }}><strong className="cl-ellipsis">{resume.filename}</strong><small>Uploaded on {fmtDate(resume.uploaded_at)}</small></div>
              <CheckCircle2 size={22} color="#fff" fill="var(--cl-green)" />
              <Menu label="Resume actions" items={[
                { label: 'View resume', icon: Eye, onClick: () => openAuthedFile(api, '/api/student/resume/file', toast) },
                { label: 'Replace', icon: Upload, onClick: () => fileRef.current?.click() },
                { label: 'Re-run analysis', icon: RefreshCw, onClick: reanalyse },
              ]} />
            </div>
          )}
        </Card>

        <Card title={<><Sparkles size={20} />AI Resume Analysis</>}>
          {insights.loading ? <Skeleton h={250} /> : insights.error ? <Alert tone="error">{insights.error.message}</Alert> : (
            <>
              <div className="cl-row" style={{ gap: 20, marginBottom: 14, alignItems: 'center' }}>
                <Ring value={ins.score ?? 0} color={scoreColor} size={118} stroke={11} label={ins.has_resume ? ins.score : '—'} sub="/100" />
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: ins.score >= 65 ? 'var(--cl-green)' : ins.score >= 45 ? 'var(--cl-amber)' : 'var(--cl-red)' }}>{ins.headline}</div>
                  <p className="cl-muted" style={{ fontSize: 13.5, marginTop: 4 }}>{ins.summary}</p>
                  {ins.best_role && <small className="cl-muted">Compared with: {ins.best_role}</small>}
                </div>
              </div>
              <div className="st-bars">
                {ins.bars.map((b) => {
                  const st = BAR_STYLE[b.key]
                  return (
                    <div key={b.key} className="st-bar">
                      <span className={`cl-ico ${st.tone}`}><st.icon size={14} /></span>
                      <span>{b.label}</span>
                      <Progress value={b.score} color={st.color} height={6} />
                      <b style={{ color: st.color }}>{b.score}%</b>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Card>

        <Card title={<><Lightbulb size={20} color="#f5a524" />AI Suggestions</>} className="tint" action={ins?.ai_enriched ? <Badge tone="purple">AI</Badge> : null}>
          {insights.loading ? <Skeleton h={250} /> : (
            <>
              {(ins?.suggestions || []).slice(0, 5).map((s) => {
                const I = SUGG_ICON[s.area] || Wrench
                return (
                  <button key={s.id} type="button" className="st-tip" onClick={() => setDetail(s.id)} title={s.detail}>
                    <span className="cl-ico"><I size={16} /></span><span style={{ fontSize: 13.5 }}>{s.title}</span><ChevronRight size={17} />
                  </button>
                )
              })}
              <Button variant="outline" block iconRight={ArrowRight} style={{ marginTop: 12 }} onClick={() => setDetail(true)} disabled={!ins?.has_resume}>View Detailed Feedback</Button>
            </>
          )}
        </Card>
      </div>

      <JobFit hasResume={!!ins?.has_resume} resumeScore={ins?.score} onAddSkill={addSkill} />

      <div className="st-split">
        <Card title={<><Users size={20} />Your Skills</>} subtitle="Add and organize your technical and core engineering skills.">
          <form className="st-chip-input" onSubmit={(e) => { e.preventDefault(); addSkill(skillQ) }}>
            <div className="cl-input-icon"><Search size={17} /><input className="cl-input" list="st-skill-list" value={skillQ} onChange={(e) => setSkillQ(e.target.value)} placeholder={`Search or add a skill (e.g. ${branch.skills.slice(0, 3).join(', ')}…)`} aria-label="Search or add a skill" maxLength={50} /></div>
            <datalist id="st-skill-list">{[...new Set([...(ins?.role_skills || []), ...branch.skills])].map((s) => <option key={s} value={s} />)}</datalist>
            <Button type="submit" icon={Plus}>Add Skill</Button>
          </form>
          <div className="cl-chips" style={{ marginTop: 14 }}>
            {skills.length === 0 ? <span className="cl-muted">No skills yet — add the tools and methods you know.</span>
              : skills.map((s) => <Chip key={s} onRemove={() => removeSkill(s)}>{s}</Chip>)}
          </div>
        </Card>
        <Card title={<><Sparkles size={20} color="var(--cl-purple)" />Suggested Skills</>} subtitle={`Common in ${branch.long} roles`}>
          {suggested.length === 0 ? <p className="cl-muted">You already list the common skills for your branch.</p> : (
            <div className="cl-chips">{suggested.map((s) => <Chip key={s} onClick={() => addSkill(s)}><Plus size={13} color="var(--cl-blue)" />{s}</Chip>)}</div>
          )}
        </Card>
      </div>

      <div className="cl-grid cl-grid-2">
        <Card title={<><Award size={20} />Certifications & Courses</>} subtitle="Showcase your certifications and completed courses." action={<Button variant="outline" size="sm" icon={Plus} onClick={cert.show}>Add Certification</Button>}>
          <CertificationsList certs={profile?.certifications || []} />
        </Card>
        <Card title={<><BarChart3 size={20} />Technical Proficiency</>} subtitle="Rate your proficiency level for each skill.">
          {skills.length === 0 ? <EmptyState title="Add skills first" text="Your skills will appear here so you can rate them." /> : skills.map((s) => {
            const lvl = levels[s]
            return (
              <div key={s} className="st-prof">
                <span className="cl-ellipsis">{s}</span>
                <Progress value={LEVEL_PCT[lvl] || 0} color={LEVEL_COLOR[lvl]} height={6} />
                <select className="cl-select" value={lvl || ''} onChange={(e) => setLevel(s, e.target.value)} aria-label={`Proficiency for ${s}`}>
                  <option value="">Not set</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )
          })}
        </Card>
      </div>

      {cert.modal}
      <Modal open={!!detail} onClose={() => setDetail(false)} size="lg" title="Detailed resume feedback"
        footer={<><Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={reanalyse}>Re-analyse</Button><Button onClick={() => setDetail(false)}>Done</Button></>}>
        {ins && (
          <div className="cl-col" style={{ gap: 16 }}>
            {!ins.has_resume && <Alert tone="warn">Upload your resume to get detailed feedback.</Alert>}
            {typeof detail === 'string' && (() => { const s = ins.suggestions.find((x) => x.id === detail); return s ? <Alert tone="success" icon={Lightbulb}><b>{s.title}.</b> {s.detail}</Alert> : null })()}
            {ins.bars.map((b) => (
              <div key={b.key} className="st-mini-card" style={{ gap: 8 }}>
                <div className="cl-row" style={{ justifyContent: 'space-between' }}><strong style={{ color: 'var(--cl-ink)' }}>{b.label}</strong><b style={{ color: BAR_STYLE[b.key].color }}>{b.score}%</b></div>
                <Progress value={b.score} color={BAR_STYLE[b.key].color} />
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }} className="cl-muted">{(ins.details?.[b.key] || []).map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            ))}
            <div>
              <h4 style={{ fontSize: 15, marginBottom: 8 }}>All suggestions</h4>
              {ins.suggestions.map((s) => <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--cl-line-2)' }}><b>{s.title}</b>{s.source === 'ai' && <Badge tone="purple" style={{ marginLeft: 6 }}>AI</Badge>}<div className="cl-muted" style={{ fontSize: 13.5 }}>{s.detail}</div></div>)}
            </div>
            {(ins.missing_skills || []).length > 0 && <div><h4 style={{ fontSize: 15, marginBottom: 8 }}>Keywords to consider (only if you genuinely have them)</h4><div className="cl-chips">{ins.missing_skills.map((s) => <Chip key={s} onClick={() => addSkill(s)}><Plus size={13} />{s}</Chip>)}</div></div>}
            {ins.computed_at && <small className="cl-muted">Analysed {fmtDate(ins.computed_at)} · deterministic scoring{ins.ai_enriched ? ' + AI suggestions' : ''}.</small>}
          </div>
        )}
      </Modal>
    </div>
  )
}
