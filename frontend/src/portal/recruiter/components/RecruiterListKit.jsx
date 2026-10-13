/**
 * List-page helpers for recruiter pages 15–17 (Candidates, Applications,
 * Shortlisted): debounced search, URL-synced filters, date-range filter and
 * the per-application actions menu.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Bookmark, BookmarkMinus, CalendarDays, Eye, FileSearch, Mail, ShieldCheck, Unlock, UserRound, XCircle,
} from 'lucide-react'
import { Button, Field, Input, Menu, fmtDate } from '../../../ui/index.jsx'

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Filter state mirrored into the URL query string so links like
 * /recruiter/applications?job=3&status=shortlisted work and survive reloads.
 * `defaults` lists every key the page uses.
 */
export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams()
  const get = (k) => params.get(k) ?? defaults[k]
  const values = Object.fromEntries(Object.keys(defaults).map((k) => [k, get(k)]))
  const set = (patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v == null || v === defaults[k]) next.delete(k)
        else next.set(k, String(v))
      })
      if (!('page' in patch) && 'page' in defaults) next.delete('page')
      return next
    }, { replace: true })
  }
  return [values, set]
}

export function qs(obj) {
  const p = new URLSearchParams()
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, String(v)) })
  return p.toString()
}

export function DateRangeFilter({ from, to, onChange }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  const ref = useRef(null)
  useEffect(() => { setF(from); setT(to) }, [from, to, open])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const label = from || to ? `${from ? fmtDate(from) : 'Any'} – ${to ? fmtDate(to) : 'Today'}` : 'All dates'
  const bad = f && t && f > t
  return (
    <div className="rp-daterange" ref={ref}>
      <Button variant="secondary" icon={CalendarDays} className="rp-daterange-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}</Button>
      {open && (
        <div className="rp-daterange-pop" role="dialog" aria-label="Application date range">
          <Field label="From"><Input type="date" value={f} max={t || undefined} onChange={(e) => setF(e.target.value)} /></Field>
          <Field label="To" error={bad ? 'End date is before start date' : null}><Input type="date" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} /></Field>
          <div className="cl-row" style={{ justifyContent: 'space-between' }}>
            <Button size="sm" variant="ghost" onClick={() => { onChange('', ''); setOpen(false) }}>Clear</Button>
            <Button size="sm" disabled={bad} onClick={() => { onChange(f, t); setOpen(false) }}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Kebab menu for one application row. `on` = {profile, shortlist, reject,
 * schedule, next, email, unlock, aiResult, unshortlist}; items only render
 * when their handler is given and the action makes sense for the stage.
 */
export function AppRowMenu({ row, on }) {
  const st = row.stage
  const live = st !== 'rejected'
  return (
    <Menu label={`Actions for ${row.candidate_name}`} items={[
      on.profile && { label: 'View profile', icon: UserRound, onClick: () => on.profile(row) },
      on.shortlist && st === 'under_review' && { label: 'Shortlist', icon: Bookmark, onClick: () => on.shortlist(row) },
      on.shortlist && st === 'rejected' && { label: 'Reconsider (shortlist)', icon: Bookmark, onClick: () => on.shortlist(row) },
      on.schedule && live && st !== 'hired' && { label: 'Schedule interview', icon: CalendarDays, onClick: () => on.schedule(row) },
      on.next && live && { label: 'Move to next stage', icon: ArrowRight, onClick: () => on.next(row) },
      on.unlock && row.can_unlock && { label: 'Unlock AI interview', icon: Unlock, onClick: () => on.unlock(row) },
      on.aiResult && row.has_ai_result && { label: 'View AI interview result', icon: ShieldCheck, onClick: () => on.aiResult(row) },
      on.offer && (st === 'offer' || st === 'hired') && { label: 'Open offer', icon: FileSearch, to: `/recruiter/offers?application=${row.application_id}` },
      on.email && { label: 'Send email', icon: Mail, onClick: () => on.email(row) },
      on.unshortlist && st === 'shortlisted' && { label: 'Remove from shortlist', icon: BookmarkMinus, onClick: () => on.unshortlist(row) },
      on.reject && live && st !== 'hired' && { label: 'Reject', icon: XCircle, danger: true, onClick: () => on.reject(row) },
      on.view && { label: 'View details', icon: Eye, onClick: () => on.view(row) },
    ]} />
  )
}

export const toSchedule = (rows) => rows.filter((r) => r.stage !== 'rejected' && r.stage !== 'hired').map((r) => ({ application_id: r.application_id, candidate_name: r.candidate_name, job_title: r.job_title }))
