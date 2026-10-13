/** Dialogs for Offers & Hiring (page 19): compose/revise, details, withdraw, joined, templates, bulk confirm. */
import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Pencil, Plus, Send, Trash2, UserCheck, XCircle } from 'lucide-react'
import {
  Alert, Avatar, Badge, Button, EmptyState, Field, Input, LogoTile, Modal, Select, Skeleton, Textarea, useToast,
} from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import { BranchTag, H, fillTemplate, fmtD, fmtDT, fmtDay } from './HiringCommon.jsx'

export const OFFER_LABEL = { draft: 'Draft', sent: 'Pending', negotiation: 'Negotiation', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', joined: 'Joined' }
export const OFFER_TONE = { draft: '', sent: 'amber', negotiation: 'amber', accepted: 'green', declined: 'red', withdrawn: 'red', joined: 'blue' }
export const OfferStatus = ({ status }) => <Badge tone={OFFER_TONE[status] ?? ''} dot>{OFFER_LABEL[status] || status}</Badge>

const FALLBACK_TEMPLATES = [{ id: 'full-time', name: 'Full-time offer', kind: 'full-time', body: 'Dear {candidate_name},\n\nWe are delighted to offer you the position of {job_title} at {company}.\n\nCTC: {ctc}\nDate of joining: {joining_date}\n\nWarm regards,\n{company}' }]
const PLACEHOLDERS = ['candidate_name', 'job_title', 'company', 'ctc', 'joining_date']
const today = () => new Date().toISOString().slice(0, 10)

/** Create (offer = null) or revise (offer = existing) an offer letter. `preset` pre-selects an application. */
export function OfferComposeModal({ open, offer, preset, templates, companyName, onClose, onSaved }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const editing = !!offer
  const tpls = templates?.length ? templates : FALLBACK_TEMPLATES
  const apps = useQuery(() => (open && !editing ? api.get(`${H}/applications?stage=offer`) : Promise.resolve(null)), [open, editing, api])
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (offer) {
      setF({ application_id: offer.application_id, template: '', ctc: offer.ctc || '', ctc_amount: offer.ctc_amount ?? '', joining_date: offer.joining_date || '',
        letter_text: offer.letter_text || '', notes: offer.notes || '' })
    } else {
      setF({ application_id: preset ? String(preset) : '', template: tpls[0].id, ctc: '', ctc_amount: '', joining_date: '', letter_text: '', notes: '', touched: false })
    }
  }, [open, offer, preset]) // eslint-disable-line react-hooks/exhaustive-deps

  const choices = (apps.data?.items || []).filter((a) => !a.has_active_offer)
  const app = editing ? offer : choices.find((a) => String(a.application_id) === String(f?.application_id))
  const vars = useMemo(() => ({
    candidate_name: app?.candidate_name, job_title: app?.job_title, company: companyName,
    ctc: f?.ctc, joining_date: f?.joining_date ? fmtDay(f.joining_date) : '',
  }), [app, companyName, f?.ctc, f?.joining_date])

  // keep the letter in sync with the template until the recruiter edits it by hand
  useEffect(() => {
    if (!f || editing || f.touched) return
    const t = tpls.find((x) => x.id === f.template)
    if (!t) return
    const text = fillTemplate(t.body, vars)
    if (text !== f.letter_text) setF((x) => ({ ...x, letter_text: text }))
  }, [vars, f?.template, f?.touched]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !f) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'letter_text' ? { touched: true } : {}) }))
  const refill = () => {
    const t = tpls.find((x) => x.id === (f.template || tpls[0].id)) || tpls[0]
    setF((x) => ({ ...x, template: t.id, letter_text: fillTemplate(t.body, vars), touched: false }))
  }

  async function save(send) {
    setErr(null)
    if (!editing && !f.application_id) return setErr('Choose a candidate.')
    if (!f.ctc.trim()) return setErr('Enter the CTC or stipend, e.g. “₹6.5 LPA”.')
    if (f.ctc_amount !== '' && (Number.isNaN(Number(f.ctc_amount)) || Number(f.ctc_amount) < 0 || Number(f.ctc_amount) > 500)) return setErr('Annual amount must be a number between 0 and 500 (LPA).')
    if (send && f.letter_text.trim().length < 20) return setErr('Write the offer letter before sending.')
    if (/\{(candidate_name|job_title|company|ctc|joining_date)\}/.test(f.letter_text) && send) return setErr('Fill in every {placeholder} in the letter before sending.')
    const body = { ctc: f.ctc.trim(), ctc_amount: f.ctc_amount === '' ? null : Number(f.ctc_amount), joining_date: f.joining_date || null,
      letter_text: f.letter_text.trim(), notes: f.notes.trim() || null }
    setBusy(send ? 'send' : 'save')
    try {
      let r
      if (editing) {
        r = await api.patch(`${H}/offers/${offer.id}`, body)
        if (send) r = await api.post(`${H}/offers/${offer.id}/send`)
        toast(send ? `Revised offer sent to ${offer.candidate_name}` : 'Offer updated', 'success')
      } else {
        r = await api.post(`${H}/offers`, { ...body, application_id: Number(f.application_id), send })
        toast(send ? `Offer letter sent to ${r.candidate_name}` : 'Offer saved as draft', 'success')
      }
      onSaved?.(r)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const canResend = editing && ['sent', 'negotiation', 'draft'].includes(offer.status)
  return (
    <Modal open onClose={onClose} size="lg" title={editing ? `Revise offer — ${offer.candidate_name}` : 'Generate offer letter'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="outline" loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>{editing ? 'Save changes' : 'Save as draft'}</Button>
        {(!editing || canResend) && <Button icon={Send} loading={busy === 'send'} disabled={!!busy} onClick={() => save(true)}>{editing ? (offer.status === 'draft' ? 'Save & send' : 'Save & resend') : 'Send offer'}</Button>}
      </>}>
      <div className="cl-col" style={{ gap: 14 }}>
        {editing ? (
          <div className="cl-row" style={{ gap: 12 }}>
            <Avatar name={offer.candidate_name} src={offer.candidate_avatar} size={42} />
            <div className="cl-grow"><strong className="hr-ink">{offer.candidate_name}</strong><div className="hr-small">{offer.job_title} · {offer.college || '—'}</div></div>
            <OfferStatus status={offer.status} />
          </div>
        ) : apps.loading ? <Skeleton h={44} /> : apps.error ? <Alert tone="error">{apps.error.message}</Alert> : choices.length === 0 ? (
          <EmptyState icon={UserCheck} title="No candidates ready for an offer" text="Shortlist or interview candidates first — anyone with an open offer is hidden here." action={<Button size="sm" variant="outline" to="/recruiter/shortlisted">Open Shortlisted</Button>} />
        ) : (
          <div className="cl-grid cl-grid-2">
            <Field label="Candidate *">
              <Select value={f.application_id} onChange={set('application_id')} placeholder="Choose a shortlisted / interviewed candidate"
                options={choices.map((a) => ({ value: String(a.application_id), label: `${a.candidate_name} — ${a.job_title}` }))} />
            </Field>
            <Field label="Template">
              <Select value={f.template} onChange={(e) => setF((x) => ({ ...x, template: e.target.value, touched: false }))} options={tpls.map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
          </div>
        )}
        {app && !editing && (
          <div className="cl-row cl-wrap hr-small" style={{ gap: 8 }}>
            <BranchTag branch={app.branch} /> {app.college || 'College not set'} {app.cgpa ? `· CGPA ${app.cgpa}` : ''} · {app.job_type === 'internship' ? 'Internship' : 'Full-time'}
            {app.interview_eval_score != null && <span className="hr-score">AI {app.interview_eval_score}</span>}
          </div>
        )}
        <div className="cl-grid cl-grid-3">
          <Field label="CTC / Stipend *" hint="Shown to the candidate"><Input value={f.ctc} maxLength={80} onChange={set('ctc')} placeholder="₹6.5 LPA or ₹25,000 / month" /></Field>
          <Field label="Annual amount (LPA)" hint="For analytics; optional"><Input type="number" min="0" max="500" step="0.1" value={f.ctc_amount} onChange={set('ctc_amount')} placeholder="6.5" /></Field>
          <Field label="Joining date"><Input type="date" value={f.joining_date} min={editing ? undefined : today()} onChange={set('joining_date')} /></Field>
        </div>
        <Field label="Offer letter" hint={f.touched || editing ? 'Edited by hand' : 'Generated from the template — edit freely'}>
          <Textarea rows={11} maxLength={20000} value={f.letter_text} onChange={set('letter_text')} />
        </Field>
        <div className="cl-row cl-wrap" style={{ gap: 6 }}>
          <span className="hr-small">Placeholders:</span>
          <div className="hr-placeholders">{PLACEHOLDERS.map((p) => <code key={p}>{`{${p}}`}</code>)}</div>
          <Button size="sm" variant="ghost" icon={FileText} onClick={refill} style={{ marginLeft: 'auto' }}>Refill from template</Button>
        </div>
        {editing && tpls.length > 0 && (
          <Field label="Replace letter with template">
            <Select value={f.template} onChange={(e) => { const t = tpls.find((x) => x.id === e.target.value); if (t) setF((x) => ({ ...x, template: t.id, letter_text: fillTemplate(t.body, vars), touched: true })) }}
              placeholder="Keep current letter" options={tpls.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
        )}
        <Field label="Internal notes" hint="Only visible to your team"><Textarea rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} placeholder="e.g. Candidate asked for relocation support" /></Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

/** Offer details: facts, letter preview, timeline and the status-appropriate actions. */
export function OfferDetailsModal({ offer, companyName, logo, onClose, onAction }) {
  const api = useApi('recruiter')
  const d = useQuery(() => (offer ? api.get(`${H}/offers/${offer.id}`) : Promise.resolve(null)), [offer?.id, offer?.updated_at, api])
  if (!offer) return null
  const o = d.data || offer
  const s = o.status
  return (
    <Modal open onClose={onClose} size="lg" title="Offer details"
      footer={<>
        {s === 'draft' && <Button variant="danger" icon={Trash2} onClick={() => onAction('delete', o)}>Delete draft</Button>}
        {['sent', 'negotiation', 'accepted'].includes(s) && <Button variant="danger" icon={XCircle} onClick={() => onAction('withdraw', o)}>Withdraw</Button>}
        {['draft', 'sent', 'negotiation', 'accepted'].includes(s) && <Button variant="secondary" icon={Pencil} onClick={() => onAction('edit', o)}>{s === 'draft' ? 'Edit draft' : 'Revise'}</Button>}
        {s === 'accepted' && <Button icon={UserCheck} onClick={() => onAction('joined', o)}>Mark as joined</Button>}
        {['draft', 'sent', 'negotiation'].includes(s) && <Button icon={Send} onClick={() => onAction('send', o)}>{s === 'draft' ? 'Send offer' : 'Resend letter'}</Button>}
        {['declined', 'withdrawn'].includes(s) && <Button icon={Plus} onClick={() => onAction('new', o)}>New offer</Button>}
      </>}>
      <div className="cl-col" style={{ gap: 16 }}>
        <div className="cl-row cl-wrap" style={{ gap: 14 }}>
          <Avatar name={o.candidate_name} src={o.candidate_avatar} size={52} />
          <div className="cl-grow" style={{ minWidth: 180 }}>
            <h3 style={{ fontSize: 18 }}>{o.candidate_name}</h3>
            <div className="hr-small">{o.job_title} · {o.college || '—'}{o.candidate_email ? ` · ${o.candidate_email}` : ''}</div>
          </div>
          <BranchTag branch={o.branch} />
          <OfferStatus status={s} />
        </div>
        <dl className="hr-info" style={{ gridTemplateColumns: '130px minmax(0,1fr)' }}>
          <dt>CTC / Stipend</dt><dd><strong>{o.ctc || '—'}</strong>{o.ctc_amount != null && <span className="hr-small"> · {o.ctc_amount} LPA</span>}</dd>
          <dt>Offer date</dt><dd>{s === 'draft' ? 'Not sent yet' : fmtD(o.offer_date)}</dd>
          <dt>Joining date</dt><dd>{fmtDay(o.joining_date)}</dd>
          <dt>Location</dt><dd>{o.job_location || '—'}</dd>
          {o.responded_at && <><dt>Responded</dt><dd>{fmtDT(o.responded_at)}</dd></>}
          {o.notes && <><dt>Internal notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</dd></>}
        </dl>
        {s === 'negotiation' && <Alert>The candidate is negotiating. Revise the CTC or joining date and resend the letter.</Alert>}
        <div className="hr-letter">
          <div className="hr-letter-head"><LogoTile name={companyName} src={logo} size={36} /><strong className="hr-ink">{companyName}</strong><span className="hr-small" style={{ marginLeft: 'auto' }}>Offer letter</span></div>
          {o.letter_text || <span className="cl-muted">No letter text yet — use Edit draft to write it.</span>}
        </div>
        <div>
          <strong className="hr-ink">Timeline</strong>
          {d.loading && !d.data ? <Skeleton h={60} /> : d.error ? <Alert tone="error">{d.error.message}</Alert> : (d.data?.timeline || []).length === 0 ? <p className="hr-sub">No events yet.</p> : (
            <ul className="hr-timeline" style={{ marginTop: 10 }}>
              {d.data.timeline.map((e, i) => <li key={i}><strong className="hr-ink">{e.label}</strong>{e.detail && <span className="cl-muted"> — {e.detail}</span>}<small>{fmtDT(e.at)}{e.by && e.by !== 'candidate' ? ` · ${e.by}` : e.by === 'candidate' ? ' · candidate' : ''}</small></li>)}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function OfferWithdrawModal({ offer, onClose, onDone }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setReason(''); setNotify(true) }, [offer])
  if (!offer) return null
  async function go() {
    setBusy(true)
    try {
      await api.post(`${H}/offers/${offer.id}/withdraw`, { notify, reason: reason.trim() || null })
      toast(`Offer withdrawn${notify && offer.status !== 'draft' ? ' — candidate notified' : ''}`, 'success')
      onDone?.(); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Withdraw offer?"
      footer={<><Button variant="secondary" onClick={onClose}>Keep offer</Button><Button variant="danger" icon={XCircle} loading={busy} onClick={go}>Withdraw offer</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p>The offer to <strong>{offer.candidate_name}</strong> for {offer.job_title} ({offer.ctc}) will be withdrawn. This cannot be undone, but you can create a new offer later.</p>
        <Field label="Reason (internal)"><Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Position put on hold" /></Field>
        <label className="cl-row" style={{ fontSize: 14 }}><input type="checkbox" className="cl-check" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the candidate</label>
      </div>
    </Modal>
  )
}

export function OfferJoinedModal({ offer, onClose, onDone }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (offer) setDate(offer.joining_date || today()) }, [offer])
  if (!offer) return null
  async function go() {
    if (!date) return toast('Pick the joining date', 'error')
    setBusy(true)
    try {
      await api.post(`${H}/offers/${offer.id}/joined`, { joining_date: date })
      toast(`${offer.candidate_name} marked as joined`, 'success')
      onDone?.(); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Mark as joined"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CheckCircle2} loading={busy} onClick={go}>Confirm joining</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <p><strong>{offer.candidate_name}</strong> accepted the offer for {offer.job_title}. Confirm the date they joined.</p>
        <Field label="Joining date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

/** Edit offer letter templates (CompanyProfile.preferences.offer_templates). */
export function OfferTemplatesModal({ open, templates = [], onClose, onSave }) {
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (open) { setRows((templates.length ? templates : FALLBACK_TEMPLATES).map((t) => ({ ...t }))); setSel(0); setErr(null) } }, [open, templates])
  if (!open) return null
  const cur = rows[sel]
  const upd = (k, v) => setRows((rs) => rs.map((r, i) => (i === sel ? { ...r, [k]: v } : r)))
  async function save() {
    const clean = rows.map((r, i) => ({ id: (r.id || `${r.name}-${i}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || `tpl-${i}`, name: r.name.trim(), kind: r.kind || 'full-time', body: r.body.trim() }))
    if (clean.some((r) => !r.name)) return setErr('Every template needs a name.')
    if (clean.some((r) => r.body.length < 10)) return setErr('Every template needs a letter body.')
    if (new Set(clean.map((r) => r.id)).size !== clean.length) return setErr('Template names must be unique.')
    setBusy(true); setErr(null)
    try { await onSave(clean); onClose() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Offer letter templates"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save templates</Button></>}>
      <div className="cl-col" style={{ gap: 12 }}>
        <div className="cl-row cl-wrap" style={{ gap: 6 }}>
          {rows.map((r, i) => <Button key={i} size="sm" variant={i === sel ? 'primary' : 'secondary'} onClick={() => setSel(i)}>{r.name || 'Untitled'}</Button>)}
          <Button size="sm" variant="outline" icon={Plus} disabled={rows.length >= 6} onClick={() => { setRows((rs) => [...rs, { id: `custom-${Date.now().toString(36)}`, name: 'New template', kind: 'full-time', body: 'Dear {candidate_name},\n\n' }]); setSel(rows.length) }}>Add</Button>
        </div>
        {cur && <>
          <div className="cl-grid cl-grid-2">
            <Field label="Name"><Input value={cur.name} maxLength={80} onChange={(e) => upd('name', e.target.value)} /></Field>
            <Field label="Type"><Select value={cur.kind} onChange={(e) => upd('kind', e.target.value)} options={[{ value: 'full-time', label: 'Full-time' }, { value: 'internship', label: 'Internship' }, { value: 'other', label: 'Other' }]} /></Field>
          </div>
          <Field label="Letter body" hint="Placeholders are filled in when you generate an offer"><Textarea rows={12} maxLength={8000} value={cur.body} onChange={(e) => upd('body', e.target.value)} /></Field>
          <div className="cl-row cl-wrap" style={{ gap: 6 }}>
            <div className="hr-placeholders">{PLACEHOLDERS.map((p) => <button type="button" key={p} style={{ border: 0, background: 'none', padding: 0 }} onClick={() => upd('body', `${cur.body}{${p}}`)}><code>{`{${p}}`}</code></button>)}</div>
            <Button size="sm" variant="ghost" icon={Trash2} disabled={rows.length <= 1} style={{ marginLeft: 'auto' }} onClick={() => { setRows((rs) => rs.filter((_, i) => i !== sel)); setSel(0) }}>Delete template</Button>
          </div>
        </>}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

const BULK_COPY = {
  remind: { title: 'Send reminder emails', text: 'Candidates with a pending offer get a reminder to respond.', btn: 'Send reminders' },
  resend: { title: 'Send / resend offer letters', text: 'Drafts are sent; pending offers get their letter again.', btn: 'Send letters' },
  joined: { title: 'Mark as joined', text: 'Accepted offers are marked as joined (joining date defaults to the planned date or today).', btn: 'Mark joined' },
  withdraw: { title: 'Withdraw offers', text: 'Selected offers are withdrawn and candidates are emailed. This cannot be undone.', btn: 'Withdraw offers', danger: true },
}

export function OfferBulkModal({ action, offers = [], onClose, onDone }) {
  const api = useApi('recruiter')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!action) return null
  const c = BULK_COPY[action]
  async function go() {
    setBusy(true)
    try {
      const r = await api.post(`${H}/offers/bulk`, { action, ids: offers.map((o) => o.id), notify: true })
      const firstErr = r.results.find((x) => !x.ok)?.error
      toast(`${r.ok} done${r.failed ? `, ${r.failed} skipped (${firstErr})` : ''}`, r.ok ? 'success' : 'error')
      onDone?.(); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={c.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={c.danger ? 'danger' : 'primary'} loading={busy} onClick={go}>{c.btn} ({offers.length})</Button></>}>
      <div className="cl-col" style={{ gap: 10 }}>
        <p className="hr-sub">{c.text} Offers that don’t qualify are skipped.</p>
        <div className="cl-list" style={{ maxHeight: 280, overflowY: 'auto' }}>
          {offers.map((o) => (
            <div key={o.id} className="cl-list-item" style={{ padding: '8px 0' }}>
              <Avatar name={o.candidate_name} src={o.candidate_avatar} size={30} />
              <span className="cl-grow"><strong className="hr-ink">{o.candidate_name}</strong> <span className="hr-small">· {o.job_title}</span></span>
              <OfferStatus status={o.status} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

