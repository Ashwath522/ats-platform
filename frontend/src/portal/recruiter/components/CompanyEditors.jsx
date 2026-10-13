/** Editors for Company Profile tabs (page 20). Each saves via PUT /api/recruiter/hiring/company. */
import React, { useEffect, useState } from 'react'
import { ImagePlus, MapPin, Plus, Save, Star, Trash2, X } from 'lucide-react'
import { Alert, Button, Card, Chip, EmptyState, Field, Input, Select, Textarea, Toggle, useToast } from '../../../ui/index.jsx'
import { useApi } from '../../../ui/useApi.js'
import { mediaUrl } from '../../../lib/api.js'
import { FilePick, H } from './HiringCommon.jsx'

export const COMPANY_TYPES = ['MNC', 'Indian MNC', 'Large Enterprise', 'Mid-size Company', 'Startup', 'PSU / Government', 'Research Organisation', 'Other']
export const SIZES = ['1-50 employees', '51-200 employees', '201-1,000 employees', '1,001-5,000 employees', '5,001-10,000 employees', '10,001+ employees']
export const FOCUS_SUGGESTIONS = ['Mechanical Engineering', 'Electrical Engineering', 'Electronics & Communication', 'Civil Engineering', 'Chemical Engineering',
  'Aerospace Engineering', 'Automotive Engineering', 'Metallurgy & Materials', 'Embedded Systems', 'Manufacturing', 'R&D', 'Quality Engineering', 'Supply Chain', 'Design & Simulation']
const BENEFIT_SUGGESTIONS = ['Health insurance', 'Relocation support', 'Hostel / PG assistance', 'Learning budget', 'Certification sponsorship', 'Transport', 'Canteen', 'Flexible hours', 'Mentorship programme', 'Performance bonus']

function useSaver(setCompany) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function save(body, msg = 'Company profile saved') {
    setBusy(true); setErr(null)
    try {
      const c = await api.put(`${H}/company`, body)
      setCompany?.(c); toast(msg, 'success')
      return c
    } catch (e) { setErr(e.message); toast(e.message, 'error'); return null } finally { setBusy(false) }
  }
  return { save, busy, err }
}

/** Chips + add input for a list of short strings. */
export function StringList({ value = [], onChange, suggestions = [], placeholder = 'Add…', max = 20, label }) {
  const [text, setText] = useState('')
  const add = (v) => {
    const t = String(v || '').trim()
    if (!t || value.includes(t) || value.length >= max) return
    onChange([...value, t]); setText('')
  }
  const rest = suggestions.filter((s) => !value.includes(s))
  return (
    <div className="cl-col" style={{ gap: 10 }}>
      <div className="hr-chipwrap">
        {value.length === 0 && <span className="hr-small">Nothing added yet.</span>}
        {value.map((v) => <Chip key={v} onRemove={() => onChange(value.filter((x) => x !== v))}>{v}</Chip>)}
      </div>
      <div className="cl-row" style={{ gap: 8 }}>
        <Input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label || placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }} />
        <Button variant="outline" icon={Plus} onClick={() => add(text)} disabled={!text.trim() || value.length >= max}>Add</Button>
      </div>
      {rest.length > 0 && (
        <div className="hr-chipwrap" aria-label="Suggestions">
          {rest.slice(0, 12).map((s) => <Chip key={s} onClick={() => add(s)}>+ {s}</Chip>)}
        </div>
      )}
      <span className="hr-small">{value.length}/{max}</span>
    </div>
  )
}

export function DetailsEditor({ company, setCompany }) {
  const { save, busy, err } = useSaver(setCompany)
  const [f, setF] = useState(null)
  const [errs, setErrs] = useState({})
  useEffect(() => {
    if (!company) return
    setF({
      name: company.name || '', tagline: company.tagline || '', legal_name: company.legal_name || '', company_type: company.company_type || '',
      size: company.size || '', founded: company.founded || '', headquarters: company.headquarters || '', location_text: company.location_text || '',
      website: company.website || '', linkedin: company.linkedin || '', industries: (company.industries || []).join(', '),
      about: company.about || '', mission: company.mission || '', vision: company.vision || '', values: (company.values || []).join('\n'),
      highlights: (company.highlights || []).map((h) => ({ ...h })),
    })
  }, [company])
  if (!f) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const url = (v) => !v || /^https?:\/\/\S+\.\S+/.test(v.trim())
  async function submit() {
    const e = {}
    if (!f.name.trim()) e.name = 'Company name is required'
    if (!url(f.website)) e.website = 'Use a full URL, e.g. https://company.com'
    if (!url(f.linkedin)) e.linkedin = 'Use a full URL, e.g. https://linkedin.com/company/…'
    if (f.founded && !/^\d{4}$/.test(f.founded.trim())) e.founded = '4-digit year'
    const values = f.values.split('\n').map((s) => s.trim()).filter(Boolean)
    if (values.length > 10) e.values = 'At most 10 values'
    const highlights = f.highlights.filter((h) => h.label.trim() || h.value.trim())
    if (highlights.some((h) => !h.label.trim() || !h.value.trim())) e.highlights = 'Each highlight needs a value and a label'
    setErrs(e)
    if (Object.keys(e).length) return
    await save({
      name: f.name.trim(), tagline: f.tagline.trim(), legal_name: f.legal_name.trim(), company_type: f.company_type, size: f.size, founded: f.founded.trim(),
      headquarters: f.headquarters.trim(), location_text: f.location_text.trim(), website: f.website.trim(), linkedin: f.linkedin.trim(),
      industries: f.industries.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10), about: f.about.trim(), mission: f.mission.trim(),
      vision: f.vision.trim(), values, highlights: highlights.map((h) => ({ label: h.label.trim(), value: h.value.trim() })),
    })
  }
  const hl = (i, k, v) => setF((x) => ({ ...x, highlights: x.highlights.map((h, j) => (j === i ? { ...h, [k]: v } : h)) }))
  return (
    <div className="cl-stack">
      <Card title="Company details" subtitle="Shown on your public company page and on every job you post.">
        <div className="cl-grid cl-grid-3">
          <Field label="Company name *" error={errs.name}><Input value={f.name} maxLength={120} onChange={set('name')} /></Field>
          <Field label="Tagline"><Input value={f.tagline} maxLength={160} onChange={set('tagline')} placeholder="Engineering for a better tomorrow" /></Field>
          <Field label="Legal name"><Input value={f.legal_name} maxLength={160} onChange={set('legal_name')} /></Field>
          <Field label="Company type"><Select value={f.company_type} onChange={set('company_type')} options={[...new Set([...COMPANY_TYPES, f.company_type].filter(Boolean))]} placeholder="Select type" /></Field>
          <Field label="Company size"><Select value={f.size} onChange={set('size')} options={[...new Set([...SIZES, f.size].filter(Boolean))]} placeholder="Select size" /></Field>
          <Field label="Founded" error={errs.founded}><Input value={f.founded} maxLength={4} inputMode="numeric" onChange={set('founded')} placeholder="1968" /></Field>
          <Field label="Headquarters"><Input value={f.headquarters} maxLength={120} onChange={set('headquarters')} placeholder="City, Country" /></Field>
          <Field label="Main location (shown in header)"><Input value={f.location_text} maxLength={120} onChange={set('location_text')} /></Field>
          <Field label="Industries" hint="Comma-separated, up to 10"><Input value={f.industries} onChange={set('industries')} placeholder="Automotive, Manufacturing" /></Field>
          <Field label="Website" error={errs.website}><Input value={f.website} maxLength={200} inputMode="url" onChange={set('website')} placeholder="https://" /></Field>
          <Field label="LinkedIn page" error={errs.linkedin}><Input value={f.linkedin} maxLength={200} inputMode="url" onChange={set('linkedin')} placeholder="https://linkedin.com/company/…" /></Field>
        </div>
      </Card>
      <Card title="About, mission & values">
        <div className="cl-col" style={{ gap: 12 }}>
          <Field label="About" hint={`${f.about.length}/3000`}><Textarea rows={5} maxLength={3000} value={f.about} onChange={set('about')} /></Field>
          <div className="cl-grid cl-grid-2">
            <Field label="Mission" hint={`${f.mission.length}/600`}><Textarea rows={3} maxLength={600} value={f.mission} onChange={set('mission')} /></Field>
            <Field label="Vision" hint={`${f.vision.length}/600`}><Textarea rows={3} maxLength={600} value={f.vision} onChange={set('vision')} /></Field>
          </div>
          <Field label="Values" hint="One per line (max 10)" error={errs.values}><Textarea rows={4} value={f.values} onChange={set('values')} placeholder={'Open and trustworthy\nFair and responsible'} /></Field>
        </div>
      </Card>
      <Card title="Key highlights" subtitle="Up to 4 numbers shown on your profile (open positions are added automatically).">
        {f.highlights.map((h, i) => (
          <div key={i} className="hr-edit-row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) auto' }}>
            <Field label={i === 0 ? 'Value' : undefined}><Input value={h.value} maxLength={30} onChange={(e) => hl(i, 'value', e.target.value)} placeholder="10,001+" aria-label={`Highlight ${i + 1} value`} /></Field>
            <Field label={i === 0 ? 'Label' : undefined}><Input value={h.label} maxLength={40} onChange={(e) => hl(i, 'label', e.target.value)} placeholder="Employees" aria-label={`Highlight ${i + 1} label`} /></Field>
            <Button variant="ghost" size="sm" icon={Trash2} aria-label="Remove highlight" onClick={() => setF((x) => ({ ...x, highlights: x.highlights.filter((_, j) => j !== i) }))} />
          </div>
        ))}
        <Button variant="outline" size="sm" icon={Plus} style={{ marginTop: 10 }} disabled={f.highlights.length >= 4} onClick={() => setF((x) => ({ ...x, highlights: [...x.highlights, { label: '', value: '' }] }))}>Add highlight</Button>
        {errs.highlights && <p className="hr-err" style={{ marginTop: 6 }}>{errs.highlights}</p>}
      </Card>
      {err && <Alert tone="error">{err}</Alert>}
      <div className="cl-row" style={{ justifyContent: 'flex-end' }}><Button icon={Save} loading={busy} onClick={submit}>Save company details</Button></div>
    </div>
  )
}

export function LocationsEditor({ company, setCompany }) {
  const { save, busy, err } = useSaver(setCompany)
  const [rows, setRows] = useState([])
  const [e, setE] = useState(null)
  useEffect(() => { setRows((company?.locations || []).map((l) => ({ ...l }))) }, [company])
  const upd = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : k === 'main' && v ? { ...r, main: false } : r)))
  async function submit() {
    if (rows.some((r) => !r.name.trim())) return setE('Every office needs a name.')
    setE(null)
    await save({ locations: rows.map((r) => ({ name: r.name.trim(), address: (r.address || '').trim(), tag: (r.tag || '').trim(), main: !!r.main })) }, 'Office locations saved')
  }
  return (
    <Card title="Office locations" subtitle="Where your engineers work. Mark one as the main office.">
      {rows.length === 0 && <EmptyState icon={MapPin} title="No offices added" text="Add your plants, R&D centres and offices." />}
      {rows.map((r, i) => (
        <div key={i} className="hr-edit-row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr) minmax(0,1fr) auto auto' }}>
          <Field label={i === 0 ? 'Office / city *' : undefined}><Input value={r.name} maxLength={80} onChange={(ev) => upd(i, 'name', ev.target.value)} placeholder="Pune (Chakan)" aria-label={`Office ${i + 1} name`} /></Field>
          <Field label={i === 0 ? 'Address' : undefined}><Input value={r.address || ''} maxLength={200} onChange={(ev) => upd(i, 'address', ev.target.value)} aria-label={`Office ${i + 1} address`} /></Field>
          <Field label={i === 0 ? 'Focus' : undefined}><Input value={r.tag || ''} maxLength={60} onChange={(ev) => upd(i, 'tag', ev.target.value)} placeholder="R&D, Manufacturing" aria-label={`Office ${i + 1} focus`} /></Field>
          <Button variant={r.main ? 'primary' : 'ghost'} size="sm" icon={Star} onClick={() => upd(i, 'main', true)} aria-pressed={!!r.main}>{r.main ? 'Main' : 'Set main'}</Button>
          <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${r.name || 'office'}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="cl-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <Button variant="outline" size="sm" icon={Plus} disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, { name: '', address: '', tag: '', main: rs.length === 0 }])}>Add office</Button>
        <Button icon={Save} loading={busy} onClick={submit}>Save locations</Button>
      </div>
      {(e || err) && <div style={{ marginTop: 10 }}><Alert tone="error">{e || err}</Alert></div>}
    </Card>
  )
}

export function HiringEditor({ company, setCompany }) {
  const { save, busy } = useSaver(setCompany)
  const [focus, setFocus] = useState([])
  const [p, setP] = useState({ employment_types: '', experience: '', locations: '', campus: '' })
  useEffect(() => {
    if (!company) return
    setFocus(company.hiring_focus || [])
    const pr = company.preferences || {}
    setP({ employment_types: pr.employment_types || '', experience: pr.experience || '', locations: pr.locations || '', campus: pr.campus || '' })
  }, [company])
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="cl-stack">
      <Card title="Hiring focus areas" subtitle="Engineering domains you hire for — used to match and recommend candidates.">
        <StringList value={focus} onChange={setFocus} suggestions={FOCUS_SUGGESTIONS} placeholder="Add a domain, e.g. Thermal Engineering" max={30} />
      </Card>
      <Card title="Hiring preferences">
        <div className="cl-grid cl-grid-2">
          <Field label="Employment types"><Input value={p.employment_types} maxLength={200} onChange={set('employment_types')} placeholder="Full-time, Internship, Apprenticeship" /></Field>
          <Field label="Experience levels"><Input value={p.experience} maxLength={200} onChange={set('experience')} placeholder="Freshers, 1–3 years" /></Field>
          <Field label="Location preference"><Input value={p.locations} maxLength={200} onChange={set('locations')} placeholder="Pune, Chennai (On-site / Hybrid)" /></Field>
          <Field label="Campus hiring"><Input value={p.campus} maxLength={200} onChange={set('campus')} placeholder="Yes — partnered with 40+ colleges" /></Field>
        </div>
      </Card>
      <div className="cl-row" style={{ justifyContent: 'flex-end' }}>
        <Button icon={Save} loading={busy} onClick={() => save({ hiring_focus: focus, preferences: p }, 'Hiring focus & preferences saved')}>Save hiring settings</Button>
      </div>
    </div>
  )
}

export function BenefitsEditor({ company, setCompany }) {
  const { save, busy } = useSaver(setCompany)
  const [list, setList] = useState([])
  useEffect(() => { setList(company?.benefits || []) }, [company])
  return (
    <Card title="Benefits & perks" subtitle="Shown to candidates on your company page and job posts.">
      <StringList value={list} onChange={setList} suggestions={BENEFIT_SUGGESTIONS} placeholder="Add a benefit" max={20} />
      <div className="cl-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><Button icon={Save} loading={busy} onClick={() => save({ benefits: list }, 'Benefits saved')}>Save benefits</Button></div>
    </Card>
  )
}

export function GalleryEditor({ company, setCompany }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const gallery = company?.gallery || []
  async function upload(file) {
    if (file.size > 5 * 1024 * 1024) return toast('Images must be under 5 MB', 'error')
    const fd = new FormData(); fd.append('file', file)
    setBusy(true)
    try { const c = await api.post(`${H}/company/gallery`, fd); setCompany?.(c); toast('Photo added', 'success') } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  async function remove(path) {
    if (!window.confirm('Delete this photo?')) return
    try { const c = await api.del(`${H}/company/gallery?path=${encodeURIComponent(path)}`); setCompany?.(c); toast('Photo deleted', 'success') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Card title="Media & gallery" subtitle={`Photos of your plants, labs and teams (${gallery.length}/12, JPG/PNG/WebP up to 5 MB).`}>
      <div className="hr-gallery big">
        {gallery.map((g) => (
          <div key={g.path} className="hr-gal-item">
            <img src={mediaUrl(g.url)} alt="Company gallery" loading="lazy" />
            <button type="button" className="del" aria-label="Delete photo" onClick={() => remove(g.path)}><X size={15} /></button>
          </div>
        ))}
        {gallery.length < 12 && (
          <FilePick onFile={upload}>{(open) => <button type="button" className="hr-gal-add" onClick={open} disabled={busy}><ImagePlus size={22} />{busy ? 'Uploading…' : 'Add photo'}</button>}</FilePick>
        )}
      </div>
    </Card>
  )
}

export function ProfileSettings({ company, setCompany }) {
  const { save } = useSaver(setCompany)
  const pub = company?.preferences?.public_profile !== false
  return (
    <Card title="Profile settings">
      <div className="hr-set-row">
        <div className="txt"><strong>Show company profile to students</strong>Students see your about, locations, hiring focus and open jobs on job pages.</div>
        <Toggle checked={pub} label="Show company profile to students" onChange={(v) => save({ preferences: { public_profile: v } }, v ? 'Profile is visible to students' : 'Profile hidden from students')} />
      </div>
      <div className="hr-set-row">
        <div className="txt"><strong>Job posting defaults & templates</strong>Default job settings, interview rounds and offer templates live in Settings → Company Settings.</div>
        <Button variant="outline" size="sm" to="/recruiter/settings?tab=company">Open settings</Button>
      </div>
    </Card>
  )
}
