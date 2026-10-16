/**
 * Company directory building blocks shared by student + admin pages.
 *
 *  <CompanyLogo name domain src size wide />  – the company's own site icon
 *      (Google S2 favicon service by domain; we never store logo files), with
 *      the LogoTile monogram as fallback when there is no domain or the icon
 *      fails / is only the generic placeholder.
 *  <DemoBadge />                              – "Demo" tag for fictional test companies/jobs.
 *  <CompanySearch onPick … />                 – search box with instant suggestions
 *      (logo + name + industry) from /api/student/company-directory/suggest.
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import { FlaskConical, Search } from 'lucide-react'
import { LogoTile, cx } from '../../ui/index.jsx'
import './companies.css'

export const faviconUrl = (domain) => (domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null)

export function CompanyLogo({ name = '', domain, src, size = 40, wide, className }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [domain])
  // monogram from the real words of the name ("Demo · Precision Gears" → "PG")
  if (src || !domain || failed) return <LogoTile name={String(name).replace(/^Demo\s*·\s*/, '')} src={src} size={size} wide={wide} />
  return (
    <span className={cx('cl-logo co-logo', className)} style={{ width: wide ? size * 2.2 : size, height: size }} title={name}>
      <img
        src={faviconUrl(domain)}
        alt={`${name} logo`}
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{ width: Math.round(size * 0.72), height: Math.round(size * 0.72) }}
        onError={() => setFailed(true)}
        // the favicon service answers unknown domains with a tiny generic globe
        onLoad={(e) => { if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth <= 16) setFailed(true) }}
      />
    </span>
  )
}

export function DemoBadge({ compact, className }) {
  return (
    <span className={cx('co-demo', className)} title="Fictional demo company for testing — not a real employer">
      <FlaskConical size={11} aria-hidden="true" />{compact ? 'Demo' : 'Demo company'}
    </span>
  )
}

/** Debounced suggestions for a query string. */
export function useCompanySuggest(api, q, { limit = 8, delay = 160 } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const term = (q || '').trim()
    if (!term) { setItems([]); setLoading(false); return undefined }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      api.get(`/api/student/company-directory/suggest?q=${encodeURIComponent(term)}&limit=${limit}`)
        .then((r) => { if (live) setItems(r.items || []) })
        .catch(() => { if (live) setItems([]) })
        .finally(() => { if (live) setLoading(false) })
    }, delay)
    return () => { live = false; clearTimeout(t) }
  }, [api, q, limit, delay])
  return { items, loading }
}

/**
 * Search input with a suggestion list (combobox pattern; ↑ ↓ Enter Esc).
 * onPick(company) when a suggestion is chosen; onSubmit(text) on Enter without one.
 */
export function CompanySearch({ api, value, onChange, onPick, onSubmit, placeholder = 'Search companies…', label = 'Search companies', autoFocus, footer }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const { items, loading } = useCompanySuggest(api, value)
  const boxRef = useRef(null)
  const listId = useId()

  useEffect(() => { setActive(-1) }, [items])
  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (c) => { setOpen(false); onPick?.(c) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)) }
    else if (e.key === 'Escape') { setOpen(false) }
    else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]) }
      else if (onSubmit) { e.preventDefault(); setOpen(false); onSubmit(value) }
    }
  }
  const show = open && (value || '').trim() && (items.length > 0 || !loading)

  return (
    <div className="co-search" ref={boxRef}>
      <label className="cl-sr-only" htmlFor={`${listId}-in`}>{label}</label>
      <span className="cl-input-icon co-search-input">
        <Search size={17} aria-hidden="true" />
        <input
          id={`${listId}-in`}
          className="cl-input"
          type="search"
          role="combobox"
          aria-expanded={!!show}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-o${active}` : undefined}
          autoComplete="off"
          maxLength={80}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </span>
      {show && (
        <ul className="co-suggest" role="listbox" id={`${listId}-list`} aria-label="Company suggestions">
          {items.length === 0 && <li className="co-suggest-empty">No matching companies</li>}
          {items.map((c, i) => (
            <li key={c.slug} id={`${listId}-o${i}`} role="option" aria-selected={i === active}
              className={cx('co-suggest-item', i === active && 'active')}
              onMouseDown={(e) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setActive(i)}>
              <CompanyLogo name={c.name} domain={c.domain} src={c.logo_url} size={32} />
              <span className="co-suggest-text">
                <strong className="cl-ellipsis">{c.name}</strong>
                <small className="cl-ellipsis">{c.industry || 'Company'}{c.open_roles ? ` · ${c.open_roles} open role${c.open_roles === 1 ? '' : 's'}` : ''}</small>
              </span>
              {c.is_demo && <DemoBadge compact />}
            </li>
          ))}
          {footer}
        </ul>
      )}
    </div>
  )
}
