/**
 * Shared bits for the admin pages (23 Platform Dashboard, 24 User Management
 * and the supporting admin pages). Page-level styling lives in admin.css
 * (prefix `adm-`); everything else comes from the shared ui kit.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, CheckCircle2, Clock3, Ban, ShieldQuestion } from 'lucide-react'
import { Badge, Button, Field, Input, Modal, Textarea, cx, fmtDate } from '../../../ui/index.jsx'
import './admin.css'

/* ── query helpers ─────────────────────────────────────────────────── */
export function qs(params) {
  const sp = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return
    sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const isoDay = (d) => {
  const x = new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))

/** "+12 new" style delta for StatTile when the previous period was empty. */
export function kpiDelta(k) {
  if (!k) return {}
  if (k.change == null) {
    return k.new ? { delta: `+${fmtNum(k.new)} new`, deltaDir: 'up', deltaNote: 'this period' } : { delta: '0%', deltaDir: 'up', deltaNote: 'vs last period' }
  }
  return { delta: k.change, deltaDir: k.change < 0 ? 'down' : 'up', deltaNote: 'vs last period' }
}

/* ── date range picker ─────────────────────────────────────────────── */
function startOfMonth(d, offset = 0) { return new Date(d.getFullYear(), d.getMonth() + offset, 1) }
function endOfMonth(d, offset = 0) { return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0) }
export function rangePresets(today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const minus = (days) => new Date(t.getTime() - days * 86400000)
  const q = Math.floor(t.getMonth() / 3) * 3
  return [
    { id: 'last4m', label: 'Last 4 months', start: startOfMonth(t, -3), end: t },
    { id: '30d', label: 'Last 30 days', start: minus(29), end: t },
    { id: '90d', label: 'Last 90 days', start: minus(89), end: t },
    { id: 'month', label: 'This month', start: startOfMonth(t), end: t },
    { id: 'lastmonth', label: 'Last month', start: startOfMonth(t, -1), end: endOfMonth(t, -1) },
    { id: 'quarter', label: 'This quarter', start: new Date(t.getFullYear(), q, 1), end: t },
    { id: 'ytd', label: 'Year to date', start: new Date(t.getFullYear(), 0, 1), end: t },
    { id: '12m', label: 'Last 12 months', start: startOfMonth(t, -11), end: t },
  ].map((p) => ({ ...p, start: isoDay(p.start), end: isoDay(p.end) }))
}
export const defaultRange = () => { const p = rangePresets()[0]; return { start: p.start, end: p.end, preset: p.id } }

export function DateRangePicker({ value, onChange, align = 'right', compact, placeholder, allowClear, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState({ start: value.start, end: value.end })
  const [err, setErr] = useState('')
  const ref = useRef(null)
  const presets = useMemo(() => rangePresets(), [])
  useEffect(() => {
    if (!open) return
    setCustom({ start: value.start, end: value.end })
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open, value.start, value.end])
  const apply = () => {
    if (!custom.start || !custom.end) return setErr('Pick both dates')
    if (custom.start > custom.end) return setErr('Start must be before end')
    setErr('')
    onChange({ start: custom.start, end: custom.end, preset: 'custom' })
    setOpen(false)
  }
  const label = value.start && value.end ? `${fmtDate(value.start)} - ${fmtDate(value.end)}` : (placeholder || 'Any date')
  return (
    <div className={cx('adm-range', compact && 'compact')} ref={ref}>
      <button type="button" className="adm-range-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={18} />
        <span>{label}</span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className={cx('adm-range-pop', align)} role="dialog" aria-label="Choose date range">
          <div className="adm-range-presets">
            {allowClear && <button type="button" className={!value.start ? 'active' : ''} onClick={() => { onChange({ start: '', end: '', preset: '' }); setOpen(false) }}>Any date</button>}
            {presets.map((p) => (
              <button key={p.id} type="button" className={value.preset === p.id ? 'active' : ''}
                onClick={() => { onChange({ start: p.start, end: p.end, preset: p.id }); setOpen(false) }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="adm-range-custom">
            <strong>Custom range</strong>
            <Field label="From"><Input type="date" value={custom.start} max={custom.end || undefined} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} /></Field>
            <Field label="To" error={err}><Input type="date" value={custom.end} min={custom.start || undefined} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} /></Field>
            <Button size="sm" onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── pills / badges ────────────────────────────────────────────────── */
const TYPE_TONE = { candidate: 'blue', recruiter: 'purple', admin: 'orange' }
export function UserTypeBadge({ type }) {
  return <Badge tone={TYPE_TONE[type] || ''} className="adm-type">{type ? type[0].toUpperCase() + type.slice(1) : '—'}</Badge>
}

export function VerificationPill({ value }) {
  if (value === 'verified') return <Badge tone="green" className="adm-pill"><CheckCircle2 size={14} /> Verified</Badge>
  return <Badge tone="amber" className="adm-pill"><Clock3 size={14} /> Pending</Badge>
}

export function AccountPill({ value }) {
  if (value === 'suspended') return <Badge tone="red" dot className="adm-pill">Suspended</Badge>
  if (value === 'awaiting_approval') return <Badge tone="amber" className="adm-pill"><ShieldQuestion size={14} /> Awaiting approval</Badge>
  if (value === 'inactive') return <Badge dot className="adm-pill"><Ban size={13} /> Inactive</Badge>
  return <Badge tone="green" dot className="adm-pill">Active</Badge>
}

const CO_STATUS = { verified: ['green', 'Verified'], approved: ['teal', 'Approved'], pending: ['amber', 'Pending'], unverified: ['', 'Unverified'], rejected: ['red', 'Rejected'] }
export function CompanyPill({ value }) {
  const [tone, label] = CO_STATUS[value] || ['', value]
  return <Badge tone={tone} dot className="adm-pill">{label}</Badge>
}

/* ── small stat tile (page 24 style: value, label, sub-line) ───────── */
export function MiniStat({ icon: Icon, tone, value, label, sub, active, onClick }) {
  const As = onClick ? 'button' : 'div'
  return (
    <As type={onClick ? 'button' : undefined} className={cx('cl-card adm-mini', active && 'active', onClick && 'clickable')} onClick={onClick}>
      <span className={cx('adm-mini-icon', tone)}><Icon size={24} /></span>
      <span className="adm-mini-text">
        <strong>{value ?? '—'}</strong>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </As>
  )
}

/* ── confirm dialog ────────────────────────────────────────────────── */
export function ConfirmModal({ open, title, text, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose, children, requireText }) {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (open) setTyped('') }, [open])
  const blocked = requireText && typed.trim() !== requireText
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={blocked} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <div className="cl-stack" style={{ gap: 12 }}>
        {text && <p className="cl-muted" style={{ lineHeight: 1.55 }}>{text}</p>}
        {children}
        {requireText && (
          <Field label={`Type ${requireText} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        )}
      </div>
    </Modal>
  )
}

/** Modal asking for a short note (reject / flag reasons). */
export function NoteModal({ open, title, label = 'Note', placeholder, confirmLabel = 'Submit', required, busy, onSubmit, onClose, danger, extra }) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setNote(''); setErr('') } }, [open])
  const submit = () => {
    if (required && note.trim().length < 3) return setErr('Please add a short note (3+ characters)')
    onSubmit(note.trim())
  }
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{confirmLabel}</Button></>}>
      <div className="cl-stack" style={{ gap: 12 }}>
        {extra}
        <Field label={label} error={err}><Textarea value={note} maxLength={1000} placeholder={placeholder} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
      </div>
    </Modal>
  )
}

/* ── key/value list used in detail modals and the user panel ───────── */
export function KV({ rows, wide }) {
  return (
    <dl className={cx('adm-kv', wide && 'wide')}>
      {rows.filter(Boolean).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v == null || v === '' ? <span className="cl-faint">—</span> : v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function fmtDateTime(d) {
  if (!d) return '—'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return String(d)
  return `${fmtDate(x)}, ${x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

export function fmtDuration(sec) {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

/** CSV download that tolerates nested objects (flattens with a picker). */
export function toRows(items, columns) {
  return items.map((it) => Object.fromEntries(columns.map(([key, pick]) => [key, typeof pick === 'function' ? pick(it) : it[pick ?? key]])))
}

/** Timeline list for activity. */
export function Timeline({ items, limit }) {
  const list = limit ? items.slice(0, limit) : items
  if (!list.length) return <p className="cl-muted" style={{ fontSize: 13 }}>No activity recorded yet.</p>
  return (
    <ol className="adm-timeline">
      {list.map((e, i) => (
        <li key={i} className={e.tone}>
          <strong>{e.title}</strong>
          <small>{fmtDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ''}</small>
        </li>
      ))}
    </ol>
  )
}

/** Shared filter-bar select (label is visually hidden but read by screen readers). */
export function FilterSelect({ label, value, onChange, options, placeholder }) {
  return (
    <label className="adm-fsel">
      <span className="cl-sr">{label}</span>
      <select className="cl-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{placeholder || label}</option>
        {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  )
}
