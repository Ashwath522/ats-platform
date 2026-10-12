import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Send } from 'lucide-react'
import { Alert, Button, Chip, Field, Input, Modal, Select, Textarea, useToast } from '../../../ui/index.jsx'
import { getBranch } from '../../../branding/branches.js'
import { BRANCH_OPTIONS, EXPERIENCE, JOB_TYPES } from './RecruiterPipelineKit.jsx'

const EMPTY = {
  title: '', branch: '', job_type: 'full-time', experience_level: 'fresher', openings: '1',
  location_text: '', remote_type: 'onsite', salary_min: '', salary_max: '', currency: 'INR',
  description: '', skills: [], eligibility: '', target_colleges: [],
}
const CITIES = ['Bangalore, India', 'Pune, India', 'Chennai, India', 'Hyderabad, India', 'Mumbai, India', 'Delhi NCR, India', 'Coimbatore, India', 'Ahmedabad, India']

function fromJob(job) {
  if (!job) return EMPTY
  return {
    title: job.title || '', branch: job.branch || '', job_type: job.job_type || '', experience_level: job.experience_level || '',
    openings: job.openings != null ? String(job.openings) : '', location_text: job.location_text || '', remote_type: job.remote_type || 'onsite',
    salary_min: job.salary_min != null ? String(job.salary_min) : '', salary_max: job.salary_max != null ? String(job.salary_max) : '',
    currency: job.currency || 'INR', description: job.description || '', skills: job.skills || [],
    eligibility: job.eligibility || '', target_colleges: job.target_colleges || [],
  }
}

function ChipInput({ label, hint, values, onChange, placeholder, suggestions = [], max = 30, listId }) {
  const [text, setText] = useState('')
  const add = (raw) => {
    const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    const next = [...values]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p.slice(0, 120))
    onChange(next)
    setText('')
  }
  const remaining = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8)
  return (
    <Field label={label} hint={hint}>
      <div className="rp-chip-input">
        <Input value={text} list={listId} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text) } }} />
        <Button variant="secondary" icon={Plus} onClick={() => add(text)} disabled={!text.trim()}>Add</Button>
      </div>
      {listId && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
      {values.length > 0 && <div className="cl-chips" style={{ marginTop: 8 }}>{values.map((v) => <Chip key={v} tone="blue" onRemove={() => onChange(values.filter((x) => x !== v))}>{v}</Chip>)}</div>}
      {remaining.length > 0 && (
        <div className="cl-chips" style={{ marginTop: 8 }} aria-label="Suggestions">
          {remaining.map((s) => <Chip key={s} onClick={() => add(s)}>+ {s}</Chip>)}
        </div>
      )}
    </Field>
  )
}

/**
 * Create / edit a requisition. Uses the existing recruiter jobs API
 * (POST /api/recruiter/jobs, PUT /api/recruiter/jobs/{id}) with the v2 fields.
 * `prefill` comes from a role template.
 */
export default function JobsFormModal({ open, onClose, api, job, prefill, colleges = [], locations = [], onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [apiError, setApiError] = useState(null)
  useEffect(() => {
    if (!open) return
    setForm(job ? fromJob(job) : { ...EMPTY, ...(prefill || {}) })
    setErrors({}); setApiError(null)
  }, [open, job, prefill])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const branchSkills = useMemo(() => (form.branch ? getBranch(form.branch).skills : []), [form.branch])
  const editing = !!job

  function validate(publish) {
    const e = {}
    if (form.title.trim().length < 3) e.title = 'Enter a job title (at least 3 characters).'
    if (!form.branch) e.branch = 'Pick the engineering branch.'
    if (!form.job_type) e.job_type = 'Pick a job type.'
    if (form.description.trim().length < 30) e.description = 'Describe the role in at least 30 characters.'
    if (publish && form.skills.length === 0) e.skills = 'Add at least one required skill before publishing.'
    if (publish && !form.location_text.trim() && form.remote_type !== 'remote') e.location_text = 'Add a location (or choose Remote).'
    const o = form.openings === '' ? null : Number(form.openings)
    if (o != null && (!Number.isInteger(o) || o < 1 || o > 1000)) e.openings = 'Openings must be a whole number from 1 to 1000.'
    const mn = form.salary_min === '' ? null : Number(form.salary_min)
    const mx = form.salary_max === '' ? null : Number(form.salary_max)
    if ((mn != null && (Number.isNaN(mn) || mn < 0)) || (mx != null && (Number.isNaN(mx) || mx < 0))) e.salary = 'Salary must be a positive number.'
    else if (mn != null && mx != null && mn > mx) e.salary = 'Minimum salary cannot be more than the maximum.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save(mode) {
    // mode: 'draft' | 'publish' | 'update'
    const publish = mode === 'publish' || (mode === 'update' && job?.status === 'open')
    if (!validate(publish)) return
    setBusy(mode); setApiError(null)
    const fd = new FormData()
    const put = (k, v) => { if (v !== undefined && v !== null) fd.append(k, v) }
    put('title', form.title.trim())
    put('description', form.description.trim())
    put('branch', form.branch)
    put('job_type', form.job_type)
    put('experience_level', form.experience_level)
    if (form.openings !== '') put('openings', String(Number(form.openings)))
    if (form.salary_min !== '') put('salary_min', String(Number(form.salary_min)))
    if (form.salary_max !== '') put('salary_max', String(Number(form.salary_max)))
    put('currency', form.currency)
    put('remote_type', form.remote_type)
    put('requirements', form.skills.join(', '))
    put('eligibility', form.eligibility.trim())
    put('target_colleges', JSON.stringify(form.target_colleges))
    if (!editing || form.location_text !== (job.location_text || '')) put('location_text', form.location_text.trim())
    try {
      let saved
      if (editing) {
        if (mode === 'publish') put('status', 'open')
        saved = await api.put(`/api/recruiter/jobs/${job.id}`, fd)
      } else {
        put('status', mode === 'publish' ? 'open' : 'draft')
        saved = await api.post('/api/recruiter/jobs', fd)
      }
      toast(editing ? (mode === 'publish' ? 'Job published' : 'Job updated') : mode === 'publish' ? 'Job published — candidates can apply now' : 'Saved as draft', 'success')
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setApiError(e.message)
    } finally { setBusy(null) }
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      {(!editing || job?.status === 'draft') && <Button variant="outline" icon={Save} loading={busy === 'draft' || (editing && busy === 'update')} onClick={() => save(editing ? 'update' : 'draft')}>{editing ? 'Save draft' : 'Save as Draft'}</Button>}
      {editing && job?.status !== 'draft'
        ? <Button icon={Save} loading={busy === 'update'} onClick={() => save('update')}>Save changes</Button>
        : <Button icon={Send} loading={busy === 'publish'} onClick={() => save('publish')}>Publish Job</Button>}
    </>
  )

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit job — ${job.title}` : 'Create a new job'} footer={footer}>
      <div className="cl-col" style={{ gap: 14 }}>
        {prefill && !editing && <Alert>Pre-filled from the “{prefill.title}” template — review and adjust before publishing.</Alert>}
        <section className="rp-form-section" aria-labelledby="jf-1">
          <h4 id="jf-1"><span>1</span>Role basics</h4>
          <Field label="Job title" error={errors.title}><Input value={form.title} maxLength={200} onChange={set('title')} placeholder="e.g. Mechanical Design Intern" autoFocus /></Field>
          <div className="cl-grid cl-grid-2">
            <Field label="Branch / domain" error={errors.branch}><Select value={form.branch} onChange={set('branch')} placeholder="Select branch" options={BRANCH_OPTIONS} /></Field>
            <Field label="Job type" error={errors.job_type}><Select value={form.job_type} onChange={set('job_type')} placeholder="Select type" options={JOB_TYPES} /></Field>
            <Field label="Experience level"><Select value={form.experience_level} onChange={set('experience_level')} placeholder="Any" options={EXPERIENCE} /></Field>
            <Field label="Openings" error={errors.openings}><Input type="number" min={1} max={1000} inputMode="numeric" value={form.openings} onChange={set('openings')} /></Field>
          </div>
        </section>
        <section className="rp-form-section" aria-labelledby="jf-2">
          <h4 id="jf-2"><span>2</span>Location &amp; compensation</h4>
          <div className="cl-grid cl-grid-2">
            <Field label="Location" error={errors.location_text}>
              <Input value={form.location_text} list="jf-cities" maxLength={120} onChange={set('location_text')} placeholder="City, State" />
              <datalist id="jf-cities">{[...new Set([...locations, ...CITIES])].map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Work mode"><Select value={form.remote_type} onChange={set('remote_type')} options={[{ value: 'onsite', label: 'On-site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' }]} /></Field>
            <Field label={`Salary min (${form.currency} / year)`} error={errors.salary}><Input type="number" min={0} inputMode="numeric" value={form.salary_min} onChange={set('salary_min')} placeholder="e.g. 450000" /></Field>
            <Field label={`Salary max (${form.currency} / year)`}><Input type="number" min={0} inputMode="numeric" value={form.salary_max} onChange={set('salary_max')} placeholder="e.g. 800000" /></Field>
            <Field label="Currency"><Select value={form.currency} onChange={set('currency')} options={['INR', 'USD', 'EUR']} /></Field>
          </div>
        </section>
        <section className="rp-form-section" aria-labelledby="jf-3">
          <h4 id="jf-3"><span>3</span>Description &amp; requirements</h4>
          <Field label="Job description" error={errors.description} hint={`${form.description.trim().length} characters · responsibilities, projects, team and growth`}>
            <Textarea rows={6} value={form.description} maxLength={10000} onChange={set('description')} placeholder="What will this engineer work on? Which tools, products and teams?" />
          </Field>
          <ChipInput label="Required skills" hint={errors.skills ? undefined : 'Press Enter or comma to add. Used for AI matching and “Top Skills in Demand”.'} values={form.skills} onChange={set('skills')} placeholder="e.g. SolidWorks" suggestions={branchSkills} max={25} />
          {errors.skills && <small className="err" style={{ color: 'var(--cl-red)', fontSize: 12 }}>{errors.skills}</small>}
        </section>
        <section className="rp-form-section" aria-labelledby="jf-4">
          <h4 id="jf-4"><span>4</span>Eligibility &amp; campus targeting</h4>
          <Field label="Eligibility criteria" hint="e.g. B.E./B.Tech Mechanical 2026–27, CGPA ≥ 7.0, no active backlogs"><Textarea rows={3} value={form.eligibility} maxLength={2000} onChange={set('eligibility')} /></Field>
          <ChipInput label="Target colleges" hint="Highlight colleges you want to hire from." values={form.target_colleges} onChange={set('target_colleges')} placeholder="e.g. NIT Trichy" suggestions={colleges} listId="jf-colleges" />
        </section>
        {apiError && <Alert tone="error">{apiError}</Alert>}
      </div>
    </Modal>
  )
}
