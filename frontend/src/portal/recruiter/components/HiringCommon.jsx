/**
 * Shared bits for recruiter pages 18–22 (Interviews, Offers, Company Profile,
 * Analytics, Settings). Backend: /api/recruiter/hiring/* (backend/app/api/hiring.py).
 */
import React, { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Star } from 'lucide-react'
import { Badge, Button, Field, Input, PALETTE } from '../../../ui/index.jsx'
import { getBranch } from '../../../branding/branches.js'
import './Hiring.css'

export const H = '/api/recruiter/hiring'

/* ── Dates (stored UTC, shown in the browser's local zone) ───────────── */
const pad = (n) => String(n).padStart(2, '0')
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` }
export const todayKey = () => dayKey(new Date())
export const fmtT = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '')
export const fmtD = (d, o = { day: '2-digit', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('en-IN', o) : '—')
export const fmtDT = (d) => (d ? `${fmtD(d, { day: '2-digit', month: 'short' })}, ${fmtT(d)}` : '—')
export const fmtRange = (a, b) => `${fmtT(a)}${b && b !== a ? ` – ${fmtT(b)}` : ''}`
/** 'YYYY-MM-DD' (date-only strings are calendar dates, not instants). */
export const fmtDay = (s) => {
  if (!s) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : fmtD(s)
}
/** local date + time inputs → ISO (UTC) */
export const toIso = (date, time) => new Date(`${date}T${time || '00:00'}`).toISOString()
export const inputDate = (d) => dayKey(d)
export const inputTime = (d) => { const x = new Date(d); return `${pad(x.getHours())}:${pad(x.getMinutes())}` }

/* ── Branch / mode badges ────────────────────────────────────────────── */
const SOFTWARE = /software|computer|cse|\bit\b/i
export function branchInfo(b) {
  if (!b) return { label: '—', color: '#64748b', soft: '#f1f5f9' }
  if (SOFTWARE.test(b)) return { label: 'CS / Software', color: '#475569', soft: '#f1f5f9' }
  const x = getBranch(b)
  const short = { eee: 'Electrical', ece: 'ECE', automobile: 'Automotive', metallurgy: 'Metallurgy' }[x.id] || x.label
  return { label: short, color: x.color, soft: x.soft }
}
export function BranchTag({ branch }) {
  const b = branchInfo(branch)
  return <span className="hr-branch" style={{ color: b.color, background: b.soft }}>{b.label}</span>
}
export function ModeBadge({ mode }) {
  return mode === 'onsite' ? <Badge tone="purple" dot>Onsite</Badge> : <Badge tone="green" dot>Online</Badge>
}

/* ── Round colours (stable per round name) ───────────────────────────── */
const ROUND_COLORS = ['#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
export function roundColor(name, rounds = []) {
  if (name === 'AI Interview') return '#ec4899'
  const i = rounds.findIndex((r) => r.name === name)
  if (i >= 0) return ROUND_COLORS[i % ROUND_COLORS.length]
  const h = [...String(name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  return ROUND_COLORS[h % ROUND_COLORS.length]
}

/* ── Small UI pieces ─────────────────────────────────────────────────── */
/** Horizontal bar list: rows [{label, value, color, note}] */
export function HBars({ rows = [], max, showPct, total, labelWidth = 120 }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value || 0))
  return (
    <div className="hr-hbars">
      {rows.map((r, i) => (
        <div className="hr-hbar" key={r.label} style={{ gridTemplateColumns: `minmax(70px, ${labelWidth}px) minmax(60px, 1fr) auto` }}>
          <span className="cl-ellipsis" title={r.label}>{r.label}</span>
          <div className="hr-hbar-track"><div style={{ width: `${Math.max(r.value ? 3 : 0, ((r.value || 0) * 100) / m)}%`, background: r.color || PALETTE[i % PALETTE.length] }} /></div>
          <strong>{r.value}{showPct && total ? <small> ({Math.round(((r.value || 0) * 100) / total)}%)</small> : null}{r.note ? <small> {r.note}</small> : null}</strong>
        </div>
      ))}
    </div>
  )
}

export function Stars({ value = 0, onChange, size = 22 }) {
  return (
    <div className="hr-stars" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (onChange ? (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)}>
          <Star size={size} fill={n <= value ? '#f59e0b' : 'none'} color={n <= value ? '#f59e0b' : '#cbd5e1'} />
        </button>
      ) : <Star key={n} size={size} fill={n <= value ? '#f59e0b' : 'none'} color={n <= value ? '#f59e0b' : '#cbd5e1'} aria-hidden="true" />))}
    </div>
  )
}

/** Popover holding a start/end date pair + presets. value = {start, end, label} (YYYY-MM-DD). */
export function DateRangePicker({ value, onChange, presets = [], align = 'right', allowClear }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { if (open) { setDraft(value); setErr(null) } }, [open, value])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const text = value?.start ? (value.label || `${fmtDay(value.start)} – ${fmtDay(value.end)}`) : 'Any date'
  function apply() {
    if (!draft?.start || !draft?.end) return setErr('Pick both dates')
    if (draft.start > draft.end) return setErr('Start must be before end')
    onChange({ start: draft.start, end: draft.end, label: null }); setOpen(false)
  }
  return (
    <div className="hr-range" ref={ref}>
      <button type="button" className="hr-range-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <CalendarDays size={17} /><span className="cl-ellipsis">{text}</span><ChevronDown size={15} />
      </button>
      {open && (
        <div className={`hr-range-pop ${align}`} role="dialog" aria-label="Choose date range">
          {presets.length > 0 && (
            <div className="hr-range-presets">
              {presets.map((p) => (
                <button key={p.label} type="button" className={value?.label === p.label ? 'active' : ''} onClick={() => { onChange({ ...p.range(), label: p.label }); setOpen(false) }}>{p.label}</button>
              ))}
            </div>
          )}
          <div className="cl-grid cl-grid-2" style={{ gap: 10 }}>
            <Field label="From"><Input type="date" value={draft?.start || ''} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} /></Field>
            <Field label="To"><Input type="date" value={draft?.end || ''} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} /></Field>
          </div>
          {err && <small className="hr-err">{err}</small>}
          <div className="cl-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            {allowClear && <Button size="sm" variant="ghost" onClick={() => { onChange({ start: '', end: '', label: null }); setOpen(false) }}>Clear</Button>}
            <Button size="sm" onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Download an authenticated binary/text response (api.request(..., {raw:true})). */
export async function downloadResponse(res, filename) {
  if (!res.ok) {
    let msg = `Download failed (${res.status})`
    try { const j = await res.json(); if (j.detail) msg = j.detail } catch { /* ignore */ }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1500)
}

/** Fill {placeholders} in an offer template. */
export function fillTemplate(body = '', vars = {}) {
  return String(body).replace(/\{(candidate_name|job_title|company|ctc|joining_date)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : m))
}

export const pctOf = (a, b) => (b ? Math.round((a * 100) / b) : 0)
