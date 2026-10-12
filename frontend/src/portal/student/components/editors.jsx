/** Profile editing helpers shared by Profile, Resume & Skills and Settings. */
import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Chip, Field, Input, Modal, Select, Textarea, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { BRANCHES } from '../../../branding/branches.js'
import { useStudent } from '../StudentShell.jsx'

/** save(patch) → PUT /api/candidate/profile, updates the shell's profile. */
export function useProfileSave() {
  const api = useApi('candidate')
  const toast = useToast()
  const { setProfile } = useStudent()
  const [busy, setBusy] = useState(false)
  const save = useCallback(async (patch, msg = 'Profile updated') => {
    setBusy(true)
    try {
      const p = await api.put('/api/candidate/profile', patch)
      setProfile(p)
      if (msg) toast(msg, 'success')
      return p
    } catch (e) {
      toast(e.message, 'error')
      throw e
    } finally { setBusy(false) }
  }, [api, setProfile, toast])
  return [save, busy]
}

/** Open an authenticated file (e.g. resume) in a new tab. */
export async function openAuthedFile(api, url, toast) {
  const w = window.open('', '_blank')
  try {
    const res = await api.request('GET', url, undefined, { raw: true })
    if (!res.ok) {
      let msg = 'Could not open file'
      try { msg = (await res.json()).detail || msg } catch { /* ignore */ }
      throw new Error(msg)
    }
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    if (w) w.location.href = href
    else window.location.href = href
    setTimeout(() => URL.revokeObjectURL(href), 60000)
  } catch (e) {
    if (w) w.close()
    toast?.(e.message, 'error')
  }
}

const URL_RE = /^https?:\/\/\S+\.\S+/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Edit identity / personal fields. `fields` limits which groups are shown. */
export function IdentityModal({ open, onClose, profile, groups = ['identity', 'contact', 'links'] }) {
  const [save, busy] = useProfileSave()
  const [f, setF] = useState({})
  const [err, setErr] = useState({})
  useEffect(() => {
    if (!open || !profile) return
    setErr({})
    setF({
      full_name: profile.full_name || '', degree: profile.degree || '', college: profile.college || '', branch: profile.branch || '',
      grad_year: profile.grad_year || '', current_year: profile.current_year || '', cgpa: profile.cgpa ?? '', bio: profile.bio || '',
      headline: profile.headline || '', location_text: profile.location_text || '', contact_email: profile.contact_email || '',
      contact_phone: profile.contact_phone || '', date_of_birth: profile.date_of_birth || '', linkedin_url: profile.linkedin_url || '',
      github_url: profile.github_url || '', portfolio_url: profile.portfolio_url || '',
    })
  }, [open, profile])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    const e = {}
    if (groups.includes('identity') && !f.full_name.trim()) e.full_name = 'Name is required'
    if (f.grad_year && (Number(f.grad_year) < 1980 || Number(f.grad_year) > 2040)) e.grad_year = 'Enter a valid year'
    if (f.cgpa !== '' && (Number(f.cgpa) < 0 || Number(f.cgpa) > 10)) e.cgpa = 'CGPA must be 0–10'
    if (f.contact_email && !EMAIL_RE.test(f.contact_email)) e.contact_email = 'Enter a valid email'
    if (f.contact_phone && !/^[+\d][\d\s-]{7,15}$/.test(f.contact_phone)) e.contact_phone = 'Enter a valid phone number'
    for (const k of ['linkedin_url', 'github_url', 'portfolio_url']) if (f[k] && !URL_RE.test(f[k])) e[k] = 'Must start with http:// or https://'
    setErr(e)
    if (Object.keys(e).length) return
    const patch = {}
    const pick = {
      identity: ['full_name', 'degree', 'college', 'branch', 'grad_year', 'current_year', 'cgpa', 'bio', 'headline'],
      contact: ['location_text', 'contact_email', 'contact_phone', 'date_of_birth'],
      links: ['linkedin_url', 'github_url', 'portfolio_url'],
    }
    groups.flatMap((g) => pick[g]).forEach((k) => {
      let v = f[k]
      if (k === 'grad_year') v = v === '' ? null : Number(v)
      if (k === 'cgpa') v = v === '' ? null : Number(v)
      if (v !== null && v !== undefined) patch[k] = typeof v === 'string' ? v.trim() : v
    })
    try { await save(patch); onClose() } catch { /* toast shown */ }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Edit profile"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save changes</Button></>}>
      <div className="cl-grid cl-grid-2">
        {groups.includes('identity') && <>
          <Field label="Full name" error={err.full_name}><Input value={f.full_name || ''} onChange={set('full_name')} maxLength={80} /></Field>
          <Field label="Engineering branch">
            <Select value={f.branch || ''} onChange={set('branch')} placeholder="Select branch" options={BRANCHES.map((b) => ({ value: b.id, label: b.long }))} />
          </Field>
          <Field label="Degree" hint="e.g. B.E. in Mechanical Engineering"><Input value={f.degree || ''} onChange={set('degree')} maxLength={100} /></Field>
          <Field label="College / University"><Input value={f.college || ''} onChange={set('college')} maxLength={120} /></Field>
          <Field label="Graduation year" error={err.grad_year}><Input type="number" value={f.grad_year} onChange={set('grad_year')} /></Field>
          <Field label="Current year"><Select value={f.current_year || ''} onChange={set('current_year')} placeholder="Select" options={['1st Year', '2nd Year', '3rd Year', '4th Year', 'Graduated']} /></Field>
          <Field label="CGPA (out of 10)" error={err.cgpa}><Input type="number" step="0.01" value={f.cgpa} onChange={set('cgpa')} /></Field>
          <Field label="Headline"><Input value={f.headline || ''} onChange={set('headline')} maxLength={120} placeholder="e.g. Aspiring design engineer" /></Field>
          <Field label="About me" className="span-2" ><Textarea value={f.bio || ''} onChange={set('bio')} maxLength={1200} /></Field>
        </>}
        {groups.includes('contact') && <>
          <Field label="Location"><Input value={f.location_text || ''} onChange={set('location_text')} placeholder="City, State" maxLength={80} /></Field>
          <Field label="Contact email" error={err.contact_email}><Input type="email" value={f.contact_email || ''} onChange={set('contact_email')} /></Field>
          <Field label="Phone" error={err.contact_phone}><Input value={f.contact_phone || ''} onChange={set('contact_phone')} placeholder="+91 98765 43210" /></Field>
          <Field label="Date of birth"><Input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></Field>
        </>}
        {groups.includes('links') && <>
          <Field label="LinkedIn URL" error={err.linkedin_url}><Input value={f.linkedin_url || ''} onChange={set('linkedin_url')} placeholder="https://linkedin.com/in/…" /></Field>
          <Field label="GitHub URL" error={err.github_url}><Input value={f.github_url || ''} onChange={set('github_url')} placeholder="https://github.com/…" /></Field>
          <Field label="Portfolio URL" error={err.portfolio_url}><Input value={f.portfolio_url || ''} onChange={set('portfolio_url')} placeholder="https://…" /></Field>
        </>}
      </div>
    </Modal>
  )
}

/**
 * Edit an array of objects (education, experience, achievements).
 * fields: [{key, label, type?: 'text'|'textarea'|'select', options?, required?, placeholder?}]
 */
export function ListEditorModal({ open, onClose, title, items = [], fields, onSave, empty, max = 20 }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setRows(items.length ? items.map((x) => ({ ...x })) : [{}]); setErr('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const submit = async () => {
    const clean = rows.filter((r) => fields.some((f) => String(r[f.key] ?? '').trim()))
    for (const r of clean) for (const f of fields) if (f.required && !String(r[f.key] ?? '').trim()) { setErr(`${f.label} is required for every entry`); return }
    setBusy(true)
    try { await onSave(clean.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])))); onClose() } catch { /* toast shown by caller */ } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="cl-col" style={{ gap: 14 }}>
        {err && <small style={{ color: 'var(--cl-red)' }}>{err}</small>}
        {rows.length === 0 && <p className="cl-muted">{empty || 'No entries yet.'}</p>}
        {rows.map((r, i) => (
          <div key={i} className="st-mini-card">
            <div className="cl-row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ color: 'var(--cl-ink)' }}>Entry {i + 1}</strong>
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            <div className="cl-grid cl-grid-2">
              {fields.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? ' *' : '')} className={f.type === 'textarea' ? 'span-2' : undefined}>
                  {f.type === 'textarea' ? <Textarea value={r[f.key] || ''} onChange={(e) => upd(i, f.key, e.target.value)} maxLength={1000} placeholder={f.placeholder} />
                    : f.type === 'select' ? <Select value={r[f.key] || ''} onChange={(e) => upd(i, f.key, e.target.value)} options={f.options} placeholder="Select" />
                      : <Input value={r[f.key] || ''} onChange={(e) => upd(i, f.key, e.target.value)} maxLength={140} placeholder={f.placeholder} />}
                </Field>
              ))}
            </div>
          </div>
        ))}
        {rows.length < max && <Button variant="outline" icon={Plus} onClick={() => setRows((r) => [...r, {}])}>Add entry</Button>}
      </div>
    </Modal>
  )
}

/** Chips editor with free text + suggestions. */
export function ChipsModal({ open, onClose, title, values = [], suggestions = [], onSave, placeholder = 'Type and press Enter', max = 40 }) {
  const [list, setList] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setList([...values]); setText('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (v) => {
    const s = String(v || '').trim().slice(0, 50)
    if (!s || list.some((x) => x.toLowerCase() === s.toLowerCase()) || list.length >= max) return
    setList((l) => [...l, s])
    setText('')
  }
  const submit = async () => { setBusy(true); try { await onSave(list); onClose() } catch { /* toast */ } finally { setBusy(false) } }
  const sugg = suggestions.filter((s) => !list.some((x) => x.toLowerCase() === s.toLowerCase()))
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="cl-col" style={{ gap: 14 }}>
        <div className="st-chip-input">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }} />
          <Button icon={Plus} onClick={() => add(text)}>Add</Button>
        </div>
        <div className="cl-chips">{list.length ? list.map((s) => <Chip key={s} onRemove={() => setList((l) => l.filter((x) => x !== s))}>{s}</Chip>) : <span className="cl-muted">Nothing added yet.</span>}</div>
        {sugg.length > 0 && <div><small className="cl-muted">Suggestions</small><div className="cl-chips" style={{ marginTop: 6 }}>{sugg.map((s) => <Chip key={s} onClick={() => add(s)}><Plus size={13} />{s}</Chip>)}</div></div>}
      </div>
    </Modal>
  )
}

export const EDUCATION_FIELDS = [
  { key: 'level', label: 'Level', type: 'select', options: [{ value: 'degree', label: 'Bachelor’s degree' }, { value: 'pg', label: 'Postgraduate' }, { value: 'diploma', label: 'Diploma' }, { value: 'pu', label: 'Class 12 / PU' }, { value: 'school', label: 'Class 10' }], required: true },
  { key: 'institution', label: 'Institution', required: true },
  { key: 'field_of_study', label: 'Field of study' },
  { key: 'grade', label: 'Grade / CGPA' },
  { key: 'start_year', label: 'Start year' },
  { key: 'end_year', label: 'End year' },
]
export const EXPERIENCE_FIELDS = [
  { key: 'title', label: 'Title', required: true, placeholder: 'e.g. Design Intern' },
  { key: 'company', label: 'Company', required: true },
  { key: 'start', label: 'Start', placeholder: 'Jun 2025' },
  { key: 'end', label: 'End', placeholder: 'Aug 2025 or Present' },
  { key: 'description', label: 'What you did', type: 'textarea' },
]
export const ACHIEVEMENT_FIELDS = [
  { key: 'title', label: 'Achievement', required: true, placeholder: 'e.g. Finalist – National Design Competition' },
  { key: 'year', label: 'Year' },
  { key: 'issuer', label: 'Organised / issued by' },
]
