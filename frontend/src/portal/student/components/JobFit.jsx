import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Briefcase, Check, ClipboardPaste, ExternalLink, FileText, Lightbulb, Plus, RefreshCw, Search, Sparkles, Target, X, Zap,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Chip, EmptyState, Ring, Segmented, Skeleton, Textarea, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { JobDetailsModal } from './shared.jsx'
import { useExternalApply } from './liveJobs.jsx'

const TONE_COLOR = { green: 'var(--cl-green)', blue: 'var(--cl-blue)', amber: '#f5a524', red: 'var(--cl-red)' }
const forms = (t) => { const s = String(t || '').toLowerCase().trim(); const base = s.replace(/\s*\(.*?\)\s*/g, ' ').trim(); const inner = [...s.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()); return [s, base, ...inner].filter(Boolean) }
const toneOf = (score) => (score >= 75 ? 'green' : score >= 55 ? 'blue' : score >= 40 ? 'amber' : 'red')

/**
 * "Match my resume to a job": pick any open job (or paste a JD) → ATS score,
 * what's missing, what to add, side by side with the resume — plus the jobs
 * that fit the resume best, each with Analyse / Apply.
 */
export default function JobFit({ resumeScore, hasResume, onAddSkill }) {
  const api = useApi('candidate')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState('job')
  const [q, setQ] = useState('')
  const [options, setOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [pasted, setPasted] = useState({ title: '', jd: '' })
  const [target, setTarget] = useState(null)       // job key being analysed
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [best, setBest] = useState(null)
  const [bestErr, setBestErr] = useState(null)
  const [origin, setOrigin] = useState('all')
  const [openJob, setOpenJob] = useState(null)
  const ext = useExternalApply({ onChange: () => loadBest(true) })
  const panelRef = useRef(null)

  const analyse = async (key, { refresh = false } = {}) => {
    setMode('job'); setTarget(key); setBusy(true); setError(null)
    try {
      setResult(await api.get(`/api/student/resume/job-match?job=${encodeURIComponent(key)}${refresh ? '&refresh=true' : ''}`, { cache: false }))
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (e) { setError(e.message); setResult(null) } finally { setBusy(false) }
  }
  const analysePasted = async () => {
    if (pasted.jd.trim().length < 40) { toast('Paste the full job description (at least a few lines)', 'error'); return }
    setTarget('pasted'); setBusy(true); setError(null)
    try { setResult(await api.post('/api/student/resume/job-match', { jd_text: pasted.jd, title: pasted.title })) } catch (e) { setError(e.message); setResult(null) } finally { setBusy(false) }
  }
  const loadBest = async (refresh = false) => {
    setBestErr(null)
    try { setBest(await api.get(`/api/student/resume/best-jobs?limit=8&origin=${origin}${refresh ? '&refresh=true' : ''}`, { cache: false })) } catch (e) { setBestErr(e.message); setBest(null) }
  }

  // Deep link from a job's details: /candidate/resume-skills?job=12
  const jobParam = params.get('job')
  useEffect(() => {
    if (jobParam && hasResume) {
      setOpenJob(null)
      analyse(jobParam)
      const next = new URLSearchParams(params)
      next.delete('job')
      setParams(next, { replace: true })
    }
  }, [hasResume, jobParam]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasResume) { setBest(null); loadBest() } }, [hasResume, origin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Job picker search (debounced)
  useEffect(() => {
    if (mode !== 'job') return undefined
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const d = await api.get(`/api/student/opportunities?page_size=8&sort=relevance${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        setOptions(d?.items || [])
      } catch { setOptions([]) } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q, mode, api])

  const applyFor = (job) => {
    if (!job) return
    if (job.external) ext.apply(job)
    else setOpenJob(job.id)
  }

  if (!hasResume) {
    return (
      <Card id="job-fit" title={<><Target size={20} />Match your resume to a job</>}>
        <EmptyState title="Upload your resume first" text="Then pick any job (or paste a job description) to see your ATS score, what's missing and which jobs fit you best." />
      </Card>
    )
  }

  return (
    <div className="jf-wrap" id="job-fit">
      <Card title={<><Target size={20} />Match your resume to a job</>} subtitle="See your ATS score for a specific role, what's missing and what to add — before you apply.">
        <Segmented value={mode} onChange={setMode} options={[{ id: 'job', label: 'Pick a job' }, { id: 'paste', label: 'Paste a job description' }]} />
        {mode === 'job' ? (
          <div className="jf-picker">
            <div className="cl-input-icon"><Search size={17} /><input className="cl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs by title, company or skill…" aria-label="Search jobs to analyse" /></div>
            <div className="jf-options" role="listbox" aria-label="Jobs">
              {searching && options.length === 0 ? [0, 1, 2].map((i) => <Skeleton key={i} h={46} />) : options.length === 0 ? <p className="cl-muted">No open jobs match that search.</p> : options.map((j) => (
                <button key={j.id} type="button" role="option" aria-selected={target === String(j.id)} className={`jf-option ${String(target) === String(j.id) ? 'on' : ''}`} onClick={() => analyse(String(j.id))}>
                  <span className="jf-option-main"><b className="cl-ellipsis">{j.title}</b><small className="cl-ellipsis">{j.company}{j.location ? ` · ${j.location}` : ''}{j.external ? ' · company site' : ''}</small></span>
                  <span className="jf-option-cta">{busy && String(target) === String(j.id) ? 'Analysing…' : 'Analyse'}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="cl-col" style={{ gap: 10, marginTop: 14 }}>
            <input className="cl-input" value={pasted.title} onChange={(e) => setPasted((p) => ({ ...p, title: e.target.value }))} placeholder="Job title (optional), e.g. Graduate Engineer Trainee – Design" maxLength={160} aria-label="Job title" />
            <Textarea rows={6} value={pasted.jd} onChange={(e) => setPasted((p) => ({ ...p, jd: e.target.value }))} placeholder="Paste the job description from any company site, LinkedIn or Naukri…" maxLength={12000} aria-label="Job description" />
            <Button icon={ClipboardPaste} loading={busy && target === 'pasted'} onClick={analysePasted}>Analyse my resume</Button>
          </div>
        )}
      </Card>

      <div ref={panelRef}>
        {error && <Alert tone="error">{error}</Alert>}
        {busy && !result && <Card><Skeleton h={260} /></Card>}
        {result && <FitResult r={result} resumeScore={resumeScore} busy={busy} onRefresh={() => (result.job?.pasted ? analysePasted() : analyse(target, { refresh: true }))} onApply={() => applyFor(result.job)} onAddSkill={onAddSkill} />}
      </div>

      <Card title={<><Zap size={20} color="#f5a524" />Jobs that fit your resume</>} subtitle="Ranked with the same ATS scoring recruiters see."
        action={<div className="cl-row" style={{ gap: 8 }}>
          <Segmented value={origin} onChange={setOrigin} options={[{ id: 'all', label: 'All' }, { id: 'corelink', label: 'CoreLink' }, { id: 'live', label: 'Company sites' }]} />
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => { setBest(null); loadBest(true) }} aria-label="Refresh best-fit jobs" />
        </div>}>
        {bestErr ? <Alert tone="error">{bestErr}</Alert> : !best ? <div className="cl-col" style={{ gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={74} />)}</div>
          : best.items.length === 0 ? <EmptyState title="No open jobs to rank yet" text="Check back soon — new roles sync every few hours." />
          : <div className="jf-best">{best.items.map((j, i) => (
            <div key={j.id} className="jf-best-row" style={{ '--i': i }}>
              <div className="jf-score" style={{ '--c': TONE_COLOR[j.verdict.tone] }}><b>{j.ats_score}</b><small>ATS</small></div>
              <div className="cl-grow" style={{ minWidth: 0 }}>
                <div className="cl-row" style={{ gap: 8, flexWrap: 'wrap' }}><strong className="cl-ellipsis">{j.title}</strong><Badge tone={j.verdict.tone}>{j.verdict.label}</Badge>{j.applied && <Badge tone="green">Applied</Badge>}</div>
                <small className="cl-muted cl-ellipsis" style={{ display: 'block' }}>{j.company}{j.location ? ` · ${j.location}` : ''}{j.external ? ' · apply on company site' : ''}</small>
                <div className="jf-chips">
                  {j.matched_skills.slice(0, 4).map((s) => <span key={s} className="st-tag green"><Check size={11} />{s}</span>)}
                  {j.missing_skills.slice(0, 3).map((s) => <span key={s} className="st-tag jf-miss"><X size={11} />{s}</span>)}
                </div>
              </div>
              <div className="jf-actions">
                <Button size="sm" variant="secondary" icon={Target} onClick={() => analyse(String(j.id))}>Analyse</Button>
                {j.applied ? <Button size="sm" variant="ghost" to="/candidate/applications">View</Button>
                  : <Button size="sm" icon={j.external ? ExternalLink : Briefcase} onClick={() => applyFor(j)}>Apply</Button>}
              </div>
            </div>
          ))}</div>}
      </Card>

      <JobDetailsModal jobId={openJob} onClose={() => setOpenJob(null)} onApplied={() => { loadBest(true); if (result && String(result.job?.id) === String(openJob)) analyse(String(openJob)) }} />
      {ext.prompt}
    </div>
  )
}

function FitResult({ r, resumeScore, busy, onRefresh, onApply, onAddSkill }) {
  const tone = r.verdict?.tone || toneOf(r.score)
  const color = TONE_COLOR[tone]
  const job = r.job || {}
  const have = useMemo(() => new Set((r.matched_skills || []).flatMap(forms)), [r])
  const isHave = (s) => forms(s).some((f) => have.has(f))
  return (
    <Card className="jf-result" title={<><Sparkles size={20} color="var(--cl-purple)" />{job.pasted ? 'Your fit for this job description' : `Your fit for ${job.title}`}</>}
      subtitle={job.pasted ? job.title : [job.company, job.location].filter(Boolean).join(' · ')}
      action={<Button variant="ghost" size="sm" icon={RefreshCw} loading={busy} onClick={onRefresh}>Re-analyse</Button>}>
      <div className="jf-side">
        <section className="jf-col">
          <h4><FileText size={16} />Your resume</h4>
          <div className="jf-ring-row">
            <Ring value={resumeScore ?? 0} color="#0b5cff" size={84} stroke={8} label={resumeScore ?? '—'} sub="/100" />
            <div><b>General ATS score</b><small className="cl-muted">How well your resume reads for roles in your branch.</small></div>
          </div>
          <div className="jf-label">Skills found in your resume</div>
          <div className="jf-chips">{(r.resume_skills || []).length ? r.resume_skills.slice(0, 16).map((s) => <span key={s} className={`st-tag ${isHave(s) ? 'green' : ''}`}>{s}</span>) : <span className="cl-muted">None recognised yet.</span>}</div>
        </section>
        <div className="jf-vs" aria-hidden="true">vs</div>
        <section className="jf-col">
          <h4><Briefcase size={16} />This job</h4>
          <div className="jf-ring-row">
            <Ring value={r.score} color={color} size={84} stroke={8} label={r.score} sub="/100" />
            <div><b style={{ color }}>{r.verdict?.label}</b><small className="cl-muted">{r.verdict?.advice}</small></div>
          </div>
          <div className="jf-label">What the job asks for</div>
          <div className="jf-chips">
            {(r.required_skills || []).length === 0 ? <span className="cl-muted">No specific tools listed — matched on overall content.</span> : r.required_skills.slice(0, 20).map((s) => {
              const ok = isHave(s)
              return <span key={s} className={`st-tag ${ok ? 'green' : 'jf-miss'}`}>{ok ? <Check size={11} /> : <X size={11} />}{s}</span>
            })}
          </div>
        </section>
      </div>

      <div className="jf-meters">
        <Meter label="Content match" value={r.breakdown?.semantic} />
        <Meter label="Keyword coverage" value={r.breakdown?.keywords} />
      </div>

      {(r.missing_skills?.length > 0 || r.on_profile_not_resume?.length > 0) && (
        <div className="jf-block">
          <div className="jf-label">Add what you genuinely know</div>
          <div className="jf-chips">
            {r.on_profile_not_resume.map((s) => <span key={s} className="st-tag amber" title="On your profile but not in your resume"><FileText size={11} />{s} — add to resume</span>)}
            {r.missing_skills.map((s) => <Chip key={s} onClick={() => onAddSkill?.(s)}><Plus size={13} color="var(--cl-blue)" />{s}</Chip>)}
          </div>
          <small className="cl-muted">Tap a skill to add it to your profile. Only add skills you really have — interviews will test them.</small>
        </div>
      )}

      {(r.ai_tips?.length > 0 || r.tips?.length > 0) && (
        <div className="jf-block">
          <div className="jf-label">What to change before applying</div>
          <ol className="jf-tips">
            {(r.ai_tips || []).map((t, i) => <li key={`ai${i}`}><span className="jf-tip-ico ai"><Sparkles size={14} /></span><div><b>{t.title}</b><small>{t.detail}</small></div><Badge tone="purple">AI</Badge></li>)}
            {(r.tips || []).map((t, i) => <li key={`t${i}`}><span className="jf-tip-ico"><Lightbulb size={14} /></span><div><b>{t.title}</b><small>{t.detail}</small></div></li>)}
          </ol>
        </div>
      )}

      {!job.pasted && (
        <div className="jf-apply">
          <div><b>{r.score >= 55 ? 'Good to go?' : 'Want to apply anyway?'}</b><small className="cl-muted">{job.external ? 'You’ll apply on the company’s own site.' : 'Your resume is sent to the recruiter with this ATS score.'}</small></div>
          {job.applied ? <Button variant="secondary" to="/candidate/applications">View application</Button>
            : <Button iconRight={job.external ? ExternalLink : undefined} onClick={onApply}>{job.external ? 'Apply on company site' : 'Apply now'}</Button>}
        </div>
      )}
    </Card>
  )
}

function Meter({ label, value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="jf-meter">
      <span>{label}</span>
      <div className="jf-meter-track"><i style={{ width: `${v}%`, background: TONE_COLOR[toneOf(v)] }} /></div>
      <b>{v}%</b>
    </div>
  )
}
