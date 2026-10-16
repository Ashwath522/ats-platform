import React, { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Camera, Pencil, MapPin, Mail, Link2 as Linkedin, GitBranch as Github, Home, GraduationCap, Cpu, Briefcase, Award, BriefcaseBusiness, Trophy,
  FileText, Link2, Target, User, Code2, ChevronRight, Lightbulb, Eye, ArrowRight, Plus, Phone, Globe, BadgeCheck,
} from 'lucide-react'
import { Avatar, Badge, Button, Card, Chip, EmptyState, IconButton, Modal, Progress, Skeleton, Tabs, ViewAll, useToast, fmtDate } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { heroMedia, branchThumb } from '../../branding/branches.js'
import { mediaUrl } from '../../lib/api.js'
import { useStudent } from './StudentShell.jsx'
import { StatusPill } from '../../ui/index.jsx'
import {
  IdentityModal, ListEditorModal, ChipsModal, useProfileSave, openAuthedFile, EDUCATION_FIELDS, EXPERIENCE_FIELDS, ACHIEVEMENT_FIELDS,
} from './components/editors.jsx'
import { CertificationsList, useCertModal } from './components/certs.jsx'
import { CollegeLogo, CollegeName } from '../../ui/CollegePicker.jsx'
import './components/student.css'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'skills', label: 'Skills', icon: Cpu },
  { id: 'projects', label: 'Projects', icon: Briefcase },
  { id: 'certifications', label: 'Certifications', icon: Award },
  { id: 'experience', label: 'Work Experience', icon: BriefcaseBusiness },
  { id: 'achievements', label: 'Achievements', icon: Trophy },
]

const LEVEL_LABEL = { degree: 'B.E. / B.Tech', pg: 'Postgraduate', diploma: 'Diploma', pu: 'Class 12 / PU', school: 'Class 10' }
const years = (p) => (p?.grad_year ? `${p.grad_year - 4} - ${p.grad_year}` : '')
const short = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

function EditBtn({ onClick, label = 'Edit' }) {
  return <Button variant="secondary" size="sm" icon={Pencil} onClick={onClick} aria-label={label}>Edit</Button>
}

export default function Profile() {
  const api = useApi('candidate')
  const toast = useToast()
  const navigate = useNavigate()
  const { profile, setProfile, branch, displayName } = useStudent()
  const [save] = useProfileSave()
  const [tab, setTab] = useState('overview')
  const [modal, setModal] = useState(null) // identity | about | interests | skills | education | experience | achievements | preview | portfolio
  const [uploading, setUploading] = useState(null)
  const cert = useCertModal()
  const projects = useQuery(() => api.get('/api/student/projects'), [api])
  const avatarRef = useRef(null)
  const coverRef = useRef(null)
  const resumeRef = useRef(null)

  const upload = async (kind, file) => {
    if (!file) return
    const limit = kind === 'resume' ? 5 : 5
    if (file.size > limit * 1024 * 1024) { toast(`File too large (max ${limit} MB)`, 'error'); return }
    const url = { avatar: '/api/candidate/profile/avatar', cover: '/api/candidate/profile/cover-photo', resume: '/api/candidate/profile/resume' }[kind]
    const fd = new FormData()
    fd.append('file', file)
    setUploading(kind)
    try {
      setProfile(await api.post(url, fd))
      toast(kind === 'resume' ? 'Resume uploaded' : kind === 'avatar' ? 'Profile photo updated' : 'Cover photo updated', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setUploading(null) }
  }

  const tips = useMemo(() => {
    if (!profile) return []
    const t = []
    const done = Object.fromEntries((profile.completion?.items || []).map((i) => [i.key, i.done]))
    if (!done.projects) t.push({ text: 'Add more projects to showcase your practical skills.', icon: Briefcase, to: '/candidate/projects' })
    if (!done.certifications) t.push({ text: 'Include certifications to stand out.', icon: Award, onClick: () => setTab('certifications') })
    if (!done.resume) t.push({ text: 'Upload your resume so recruiters can review it.', icon: FileText, onClick: () => resumeRef.current?.click() })
    if (!done.skills) t.push({ text: 'Add at least 3 skills relevant to your branch.', icon: Cpu, onClick: () => setModal('skills') })
    if (!done.portfolio) t.push({ text: 'Link your LinkedIn, GitHub or portfolio.', icon: Link2, onClick: () => setModal('identity') })
    if (!done.personal) t.push({ text: 'Complete your name and contact details.', icon: User, onClick: () => setModal('identity') })
    if (!profile.bio) t.push({ text: 'Write a short About Me summary.', icon: Pencil, onClick: () => setModal('identity') })
    if (!(profile.achievements || []).length) t.push({ text: 'Add achievements such as competitions or awards.', icon: Trophy, onClick: () => setModal('achievements') })
    if (!profile.avatar_url) t.push({ text: 'Add a professional profile photo.', icon: Camera, onClick: () => avatarRef.current?.click() })
    return t
  }, [profile])

  if (!profile) return <div className="st-page"><Skeleton h={320} /><Skeleton h={240} /></div>

  const cover = profile.cover_photo_url ? mediaUrl(profile.cover_photo_url) : (heroMedia(branch, 'profile').src || branchThumb(branch, 0))
  const edu = profile.education || []
  const primaryEdu = edu.find((e) => e.level === 'degree') || edu[0]
  const degree = profile.degree || (primaryEdu ? `${LEVEL_LABEL[primaryEdu.level] || ''} ${primaryEdu.field_of_study || ''}`.trim() : `B.E. in ${branch.long}`)
  const college = profile.college || primaryEdu?.institution
  const collegeMeta = profile.college ? profile.college_meta : (primaryEdu?.institution_id ? { id: primaryEdu.institution_id, domain: primaryEdu.institution_domain } : null)
  const projList = projects.data?.projects || []

  const about = (
    <Card title={<><User size={20} />About Me</>} action={<EditBtn onClick={() => setModal('identity')} />}>
      {profile.bio ? <p className="cl-muted" style={{ lineHeight: 1.6 }}>{profile.bio}</p> : <p className="cl-muted">Tell recruiters about your interests and goals. <button className="cl-link" onClick={() => setModal('identity')}>Add a summary</button></p>}
    </Card>
  )
  const eduCard = (
    <Card title={<><GraduationCap size={20} />Education</>} action={<EditBtn onClick={() => setModal('education')} />}>
      {edu.length === 0 && !college ? <p className="cl-muted">No education added yet.</p> : (
        <div className="cl-col" style={{ gap: 14 }}>
          {(edu.length ? edu : [{ institution: college, field_of_study: degree }]).slice(0, tab === 'education' ? 20 : 2).map((e, i) => (
            <div key={i} className="cl-row" style={{ alignItems: 'flex-start' }}>
              {e.institution && !['pu', 'school'].includes(e.level)
                ? <CollegeLogo name={e.institution} id={e.institution_id || (e.institution === profile.college ? profile.college_meta?.id : undefined)} domain={e.institution_domain || (e.institution === profile.college ? profile.college_meta?.domain : undefined)} size={36} />
                : <span className="cl-ico"><BadgeCheck size={18} /></span>}
              <div style={{ fontSize: 14 }}>
                <strong style={{ color: 'var(--cl-ink)', fontWeight: 600 }}>{e.field_of_study ? `${LEVEL_LABEL[e.level] ? LEVEL_LABEL[e.level] + ' – ' : ''}${e.field_of_study}` : LEVEL_LABEL[e.level] || degree}</strong>
                <div className="cl-muted">{e.institution}</div>
                {(e.start_year || e.end_year) && <div className="cl-muted">{e.start_year} - {e.end_year}</div>}
                {(e.grade || (i === 0 && profile.cgpa)) && <div>CGPA: <b>{e.grade || `${profile.cgpa} / 10`}</b></div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
  const skillsCard = (
    <Card title={<><Code2 size={20} />Technical Skills</>} action={<EditBtn onClick={() => setModal('skills')} />}>
      {(profile.skills || []).length ? <div className="cl-chips">{profile.skills.map((s) => <Chip key={s}>{s}{profile.skill_levels?.[s] ? <small className="cl-muted">· {profile.skill_levels[s]}</small> : null}</Chip>)}</div>
        : <p className="cl-muted">No skills yet. <button className="cl-link" onClick={() => setModal('skills')}>Add skills</button></p>}
    </Card>
  )
  const achCard = (
    <Card title={<><Trophy size={20} />Achievements</>} action={<EditBtn onClick={() => setModal('achievements')} />}>
      {(profile.achievements || []).length === 0 ? <p className="cl-muted">No achievements yet. <button className="cl-link" onClick={() => setModal('achievements')}>Add one</button></p> : (
        <div className="cl-list">
          {profile.achievements.map((a, i) => (
            <button key={i} type="button" className="cl-list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--cl-line-2)', width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setModal('achievements')}>
              <span className={`cl-ico ${i % 2 ? 'amber' : 'red'}`}><Trophy size={18} /></span>
              <span className="cl-grow"><span style={{ display: 'block', color: 'var(--cl-ink)' }}>{a.title}</span><small className="cl-muted">{[a.issuer, a.year].filter(Boolean).join(' · ')}</small></span>
              <ChevronRight size={16} color="var(--cl-blue)" />
            </button>
          ))}
        </div>
      )}
    </Card>
  )
  const expCard = (
    <Card title={<><BriefcaseBusiness size={20} />Work Experience</>} action={<EditBtn onClick={() => setModal('experience')} />}>
      {(profile.experience || []).length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No experience added" text="Add internships, industrial training or part-time work." action={<Button size="sm" icon={Plus} onClick={() => setModal('experience')}>Add experience</Button>} /> : (
        <div className="cl-list">
          {profile.experience.map((x, i) => (
            <div key={i} className="cl-list-item" style={{ alignItems: 'flex-start' }}>
              <span className="cl-ico purple"><BriefcaseBusiness size={18} /></span>
              <div className="cl-grow"><strong style={{ color: 'var(--cl-ink)' }}>{x.title}</strong> <span className="cl-muted">· {x.company}</span>
                <div className="cl-muted" style={{ fontSize: 13 }}>{[x.start, x.end].filter(Boolean).join(' – ')}</div>
                {x.description && <p style={{ marginTop: 4, fontSize: 13.5 }}>{x.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
  const projCard = (
    <Card title={<><Briefcase size={20} />Projects</>} action={<ViewAll to="/candidate/projects">Manage projects</ViewAll>}>
      {projects.loading ? <Skeleton h={120} /> : projList.length === 0 ? <EmptyState icon={Briefcase} title="No projects yet" action={<Button size="sm" to="/candidate/projects" icon={Plus}>Add a project</Button>} /> : (
        <div className="cl-grid cl-grid-3">
          {projList.map((p, i) => (
            <Link key={p.id} to="/candidate/projects" className="cl-card cl-media-card" style={{ color: 'inherit' }}>
              <div className="cl-media"><img src={p.image_url ? mediaUrl(p.image_url) : branchThumb(branch, i)} alt="" loading="lazy" /><span className="cl-media-tag"><StatusPill status={p.status} /></span></div>
              <div className="cl-media-body"><h4 className="cl-ellipsis">{p.title}</h4><small className="cl-muted">{p.category} project{p.month ? ` · ${p.month}` : ''}</small></div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )

  return (
    <div className="st-page">
      <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => { upload('avatar', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { upload('cover', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={resumeRef} type="file" accept=".pdf,.docx" hidden onChange={(e) => { upload('resume', e.target.files?.[0]); e.target.value = '' }} />

      <div className="st-split">
        <div className="st-page">
          <section className="cl-card flush">
            <div className="st-cover">
              <img src={cover} alt="" />
              {!profile.cover_photo_url && <div className="st-cover-script" aria-hidden="true">Building<br />a better future<br />through engineering</div>}
              <Button size="sm" className="st-cover-btn" icon={Camera} loading={uploading === 'cover'} onClick={() => coverRef.current?.click()}>Change Cover</Button>
            </div>
            <div className="st-identity">
              <div className="st-avatar-wrap">
                <Avatar name={displayName} src={profile.avatar_url} size={140} />
                <button type="button" className="st-avatar-btn" aria-label="Change profile photo" onClick={() => avatarRef.current?.click()} disabled={uploading === 'avatar'}><Camera size={16} /></button>
              </div>
              <div style={{ paddingTop: 16, minWidth: 0 }}>
                <div className="cl-row cl-wrap"><h2>{displayName || 'Your name'}</h2><EditBtn onClick={() => setModal('identity')} label="Edit profile" /></div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--cl-ink)', marginTop: 6 }}>{degree}</div>
                <div className="cl-muted cl-college-line" style={{ marginTop: 4 }}>{college
                  ? <><CollegeName name={college} id={collegeMeta?.id} domain={collegeMeta?.domain} size={24} />{years(profile) && <span className="cl-college-extra">{years(profile)}</span>}</>
                  : years(profile) || <button className="cl-link" onClick={() => setModal('identity')}>Add your college</button>}</div>
                {profile.headline && <div style={{ marginTop: 10, fontSize: 14 }}>{profile.headline}</div>}
                {!profile.headline && profile.bio && <p className="cl-muted" style={{ marginTop: 10, fontSize: 13.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{profile.bio}</p>}
              </div>
              <div className="st-links">
                <span><MapPin size={16} />{profile.location_text || <span className="cl-muted">Add location</span>}</span>
                {profile.contact_email && <a href={`mailto:${profile.contact_email}`}><Mail size={16} />{profile.contact_email}</a>}
                {profile.linkedin_url ? <a href={profile.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={16} />{short(profile.linkedin_url)}</a> : <button className="cl-link" style={{ textAlign: 'left' }} onClick={() => setModal('identity')}><Linkedin size={16} style={{ verticalAlign: -3 }} /> Add LinkedIn</button>}
                {profile.github_url ? <a href={profile.github_url} target="_blank" rel="noreferrer"><Github size={16} />{short(profile.github_url)}</a> : <button className="cl-link" style={{ textAlign: 'left' }} onClick={() => setModal('identity')}><Github size={16} style={{ verticalAlign: -3 }} /> Add GitHub</button>}
              </div>
            </div>
          </section>

          <Card flush><div style={{ padding: '0 10px' }}><Tabs tabs={TABS} value={tab} onChange={setTab} className="st-profile-tabs" /></div></Card>

          {tab === 'overview' && <>
            <div className="cl-grid cl-grid-3">
              <div className="st-mini-card">
                <div className="st-mini-head"><span className="cl-ico"><FileText size={20} /></span><div><strong>Resume</strong><small>Your latest resume</small></div></div>
                {profile.resume ? (
                  <div className="st-file-row"><span className="cl-ico red"><FileText size={18} /></span><div style={{ minWidth: 0 }}><strong className="cl-ellipsis">{profile.resume.filename}</strong><small>Updated {fmtDate(profile.resume.uploaded_at)}</small></div></div>
                ) : <p className="cl-muted" style={{ fontSize: 13.5 }}>No resume uploaded yet.</p>}
                <div className="cl-grid cl-grid-2" style={{ gap: 10 }}>
                  <Button variant="outline" size="sm" disabled={!profile.resume} onClick={() => openAuthedFile(api, '/api/student/resume/file', toast)}>View</Button>
                  <Button variant="outline" size="sm" loading={uploading === 'resume'} onClick={() => resumeRef.current?.click()}>{profile.resume ? 'Replace' : 'Upload'}</Button>
                </div>
              </div>
              <div className="st-mini-card">
                <div className="st-mini-head"><span className="cl-ico"><Link2 size={20} /></span><div><strong>Portfolio</strong><small>Showcase your work</small></div></div>
                {profile.portfolio_url ? (
                  <div className="st-file-row"><span className="cl-ico"><Globe size={18} /></span><div style={{ minWidth: 0 }}><a className="cl-ellipsis" style={{ display: 'block', fontWeight: 600 }} href={profile.portfolio_url} target="_blank" rel="noreferrer">{short(profile.portfolio_url)}</a><small>Portfolio link</small></div></div>
                ) : <p className="cl-muted" style={{ fontSize: 13.5 }}>Add a link to GrabCAD, GitHub Pages, Behance or a personal site.</p>}
                <div className="cl-row" style={{ justifyContent: 'center' }}>
                  {profile.portfolio_url ? <Button variant="outline" size="sm" href={profile.portfolio_url}>Visit</Button> : null}
                  <Button variant="outline" size="sm" onClick={() => setModal('identity')}>{profile.portfolio_url ? 'Edit' : 'Add link'}</Button>
                </div>
              </div>
              <div className="st-mini-card">
                <div className="st-mini-head">
                  <span className="cl-ico red"><Target size={20} /></span><div className="cl-grow"><strong>Areas of Interest</strong><small>Select your preferred domains</small></div>
                  <IconButton icon={Pencil} boxed label="Edit areas of interest" onClick={() => setModal('interests')} />
                </div>
                <div className="cl-chips">{(profile.interests || []).length ? profile.interests.map((x) => <Chip key={x} className="soft">{x}</Chip>) : branch.domains.map((d) => <Chip key={d} onClick={() => save({ interests: [...(profile.interests || []), d] }, `Added ${d}`)}><Plus size={13} />{d}</Chip>)}</div>
              </div>
            </div>
            <div className="cl-grid cl-grid-2">
              <div className="st-page">{about}{skillsCard}</div>
              <div className="st-page">{eduCard}{achCard}</div>
            </div>
          </>}
          {tab === 'education' && eduCard}
          {tab === 'skills' && skillsCard}
          {tab === 'projects' && projCard}
          {tab === 'certifications' && <Card title={<><Award size={20} />Certifications</>} action={<Button size="sm" variant="outline" icon={Plus} onClick={cert.show}>Add Certification</Button>}><CertificationsList certs={profile.certifications || []} /></Card>}
          {tab === 'experience' && expCard}
          {tab === 'achievements' && achCard}
        </div>

        <div className="st-right">
          <Card title="Profile Completion" action={<b style={{ color: 'var(--cl-blue)', fontSize: 18 }}>{profile.completion?.percent ?? 0}%</b>}>
            <Progress value={profile.completion?.percent} height={8} />
            <ul className="cl-check-list" style={{ marginTop: 16 }}>
              {(profile.completion?.items || []).map((i) => (
                <li key={i.key}><span className={`st-check-dot ${i.done ? 'ok' : 'todo'}`}>✓</span><span className={i.done ? '' : 'cl-muted'}>{i.label}</span></li>
              ))}
            </ul>
          </Card>
          <Card title={<><Lightbulb size={20} color="#f5a524" />Profile Tips</>}>
            {tips.length === 0 ? <p className="cl-muted">Great work — your profile covers everything recruiters look for.</p> : tips.slice(0, 4).map((t) => (
              t.to ? <Link key={t.text} to={t.to} className="st-tip"><span className="cl-ico"><t.icon size={17} /></span><span>{t.text}</span><ChevronRight size={17} /></Link>
                : <button key={t.text} type="button" className="st-tip" onClick={t.onClick}><span className="cl-ico"><t.icon size={17} /></span><span>{t.text}</span><ChevronRight size={17} /></button>
            ))}
          </Card>
          <Card title={<><Eye size={20} />Profile Preview</>} subtitle="See how your profile looks to recruiters and companies.">
            <button type="button" className="st-preview-thumb" style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }} onClick={() => setModal('preview')} aria-label="Open profile preview">
              <div className="cl-row"><Avatar name={displayName} src={profile.avatar_url} size={44} /><div style={{ minWidth: 0 }}><strong className="cl-ellipsis" style={{ display: 'block', color: 'var(--cl-ink)' }}>{displayName}</strong><small className="cl-muted cl-ellipsis" style={{ display: 'block' }}>{degree}</small></div></div>
              <div className="cl-chips" style={{ marginTop: 10 }}>{(profile.skills || []).slice(0, 4).map((s) => <span key={s} className="st-tag">{s}</span>)}</div>
            </button>
            <Button variant="outline" block iconRight={ArrowRight} style={{ marginTop: 14 }} onClick={() => setModal('preview')}>View Profile</Button>
          </Card>
        </div>
      </div>

      <IdentityModal open={modal === 'identity'} onClose={() => setModal(null)} profile={profile} />
      <ListEditorModal open={modal === 'education'} onClose={() => setModal(null)} title="Education" items={edu} fields={EDUCATION_FIELDS}
        onSave={async (list) => { try { setProfile(await api.put('/api/candidate/profile/education', list)); toast('Education saved', 'success') } catch (e) { toast(e.message, 'error'); throw e } }} />
      <ListEditorModal open={modal === 'experience'} onClose={() => setModal(null)} title="Work experience" items={profile.experience || []} fields={EXPERIENCE_FIELDS} onSave={(list) => save({ experience: list }, 'Experience saved')} />
      <ListEditorModal open={modal === 'achievements'} onClose={() => setModal(null)} title="Achievements" items={profile.achievements || []} fields={ACHIEVEMENT_FIELDS} onSave={(list) => save({ achievements: list }, 'Achievements saved')} />
      <ChipsModal open={modal === 'interests'} onClose={() => setModal(null)} title="Areas of interest" values={profile.interests || []} suggestions={branch.domains} max={10} onSave={(list) => save({ interests: list }, 'Interests saved')} placeholder="Add a domain" />
      <ChipsModal open={modal === 'skills'} onClose={() => setModal(null)} title="Technical skills" values={profile.skills || []} suggestions={branch.skills} onSave={(list) => save({ skills: list }, 'Skills saved')} placeholder="Add a skill (e.g. SolidWorks)" />
      {cert.modal}
      <PreviewModal open={modal === 'preview'} onClose={() => setModal(null)} profile={profile} name={displayName} degree={degree} college={college} collegeMeta={collegeMeta} projects={projList} branch={branch} />
    </div>
  )
}

/** The profile as a recruiter sees it (respects the student's privacy settings). */
function PreviewModal({ open, onClose, profile, name, degree, college, collegeMeta, projects, branch }) {
  const privacy = profile.privacy || {}
  const showContact = (privacy.show_contact || 'shortlisted') === 'all'
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Profile preview — recruiter view">
      <div className="cl-col" style={{ gap: 16 }}>
        {privacy.visibility === 'private' && <div className="cl-alert warn">Your profile is set to private — recruiters can only see it for jobs you apply to. Change this in Settings → Privacy.</div>}
        <div className="cl-row" style={{ alignItems: 'flex-start' }}>
          <Avatar name={name} src={profile.avatar_url} size={72} />
          <div className="cl-grow">
            <h3 style={{ fontSize: 20 }}>{name}</h3>
            <div style={{ fontWeight: 600 }}>{degree}</div>
            <div className="cl-muted cl-college-line">{college && <CollegeName name={college} id={collegeMeta?.id} domain={collegeMeta?.domain} size={20} />}{[years(profile), profile.location_text].filter(Boolean).map((x) => <span key={x} className="cl-college-extra">{x}</span>)}</div>
            <div className="cl-row cl-wrap" style={{ marginTop: 8 }}>
              <Badge tone="blue">{branch.label}</Badge>
              {profile.cgpa ? <Badge>CGPA {profile.cgpa}</Badge> : null}
              {profile.resume && <Badge tone="green">Resume on file</Badge>}
            </div>
          </div>
        </div>
        {profile.bio && <p className="cl-muted" style={{ lineHeight: 1.6 }}>{profile.bio}</p>}
        <div>
          <h4 style={{ fontSize: 14.5, marginBottom: 8 }}>Skills</h4>
          <div className="cl-chips">{(profile.skills || []).map((s) => <Chip key={s}>{s}{profile.skill_levels?.[s] ? ` · ${profile.skill_levels[s]}` : ''}</Chip>)}</div>
        </div>
        {projects.length > 0 && <div><h4 style={{ fontSize: 14.5, marginBottom: 8 }}>Projects</h4>
          {projects.slice(0, 4).map((p) => <div key={p.id} className="cl-row" style={{ padding: '6px 0' }}><span className="cl-grow">{p.title}</span><StatusPill status={p.status} /></div>)}</div>}
        {(profile.certifications || []).length > 0 && <div><h4 style={{ fontSize: 14.5, marginBottom: 8 }}>Certifications</h4>{profile.certifications.map((c, i) => <div key={i} className="cl-muted">• {c.name} — {c.issuing_organization}</div>)}</div>}
        <div className="cl-row cl-wrap" style={{ gap: 16, fontSize: 13.5 }}>
          {showContact ? <>{profile.contact_email && <span><Mail size={14} /> {profile.contact_email}</span>}{profile.contact_phone && <span><Phone size={14} /> {profile.contact_phone}</span>}</>
            : <span className="cl-muted">Contact details are shown only to companies that shortlist you.</span>}
          {profile.linkedin_url && <a href={profile.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={14} /> LinkedIn</a>}
          {profile.github_url && <a href={profile.github_url} target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a>}
        </div>
      </div>
    </Modal>
  )
}
