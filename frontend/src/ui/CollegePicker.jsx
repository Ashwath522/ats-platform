/**
 * College autocomplete + logo.
 *
 *  <CollegePicker value={name} collegeId={id} onChange={(name, meta) => …} />
 *     meta = { id, domain } when a listed college is picked, null for free text.
 *  <CollegeLogo name="RVCE" domain="rvce.edu.in" size={28} />
 *     Favicon via Google's favicon service (never stored); coloured monogram
 *     when the domain is unknown or the image fails. Looks the college up in the
 *     dataset by id / name when no domain is passed.
 *  <CollegeName name={c.college} />  — small logo + name, for read-only displays.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { collegeIndexSync, collegeLogoUrl, loadColleges, lookupCollege, searchColleges } from '../lib/colleges.js'
import { normalize } from '../lib/collegeMatch.js'
import './college.css'

const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#4f46e5', '#0891b2', '#65a30d']
const hash = (s = '') => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const STOP = new Set(['of', 'and', 'the', 'for', 'in', 'at', '&'])

/** Short monogram: a listed short alias ("RVCE", "IITB") or the initials of the name. */
export function collegeMonogram(name = '', college) {
  const short = (college?.aliases || []).find((a) => /^[A-Z0-9&-]{2,6}$/.test(a))
  if (short) return short.replace(/[&-]/g, '').slice(0, 6)
  const words = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()))
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase()
}

function useCollegeLookup(enabled, ref) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!enabled || collegeIndexSync()) return undefined
    let live = true
    loadColleges().then(() => live && force((n) => n + 1)).catch(() => {})
    return () => { live = false }
  }, [enabled])
  return enabled ? lookupCollege(ref) : null
}

export function CollegeLogo({ name = '', domain, id, size = 32, className = '' }) {
  const needLookup = !domain && !!(id || name)
  const found = useCollegeLookup(needLookup, { id, name })
  const college = found || null
  const host = domain || college?.domain || ''
  const label = college?.name || name
  const [state, setState] = useState('idle') // idle | ok | fail
  useEffect(() => { setState('idle') }, [host])
  const mono = collegeMonogram(label, college || (domain ? lookupCollege({ id, name }) : null))
  const color = COLORS[hash(label) % COLORS.length]
  const style = { width: size, height: size, color, fontSize: Math.max(8, size * ([0, 0.42, 0.38, 0.32, 0.27, 0.22, 0.19][mono.length] || 0.19)) }
  return (
    <span className={`cl-logo cl-college-logo ${className}`} style={style} title={label || undefined} aria-hidden="true">
      {state !== 'ok' && <span className="cl-college-mono">{mono}</span>}
      {host && state !== 'fail' && (
        <img src={collegeLogoUrl(host)} alt="" loading="lazy" referrerPolicy="no-referrer"
          style={state === 'ok' ? undefined : { opacity: 0 }}
          onLoad={(e) => setState(e.currentTarget.naturalWidth > 16 ? 'ok' : 'fail')}
          onError={() => setState('fail')} />
      )}
    </span>
  )
}

/** Read-only "logo + college name" inline display. */
export function CollegeName({ name, id, domain, size = 20, className = '', children }) {
  if (!name) return children ?? null
  return (
    <span className={`cl-college-name ${className}`}>
      <CollegeLogo name={name} id={id} domain={domain} size={size} />
      <span className="cl-college-name-text">{children ?? name}</span>
    </span>
  )
}

export function CollegePicker({
  value = '', collegeId, collegeDomain, onChange, id, placeholder = 'Start typing your college, e.g. RVCE, IIT Bombay',
  disabled, maxLength = 160, limit = 8, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, autoFocus,
}) {
  const autoId = useId()
  const inputId = id || `college-${autoId}`
  const listId = `${inputId}-list`
  const [text, setText] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [results, setResults] = useState([])
  const [loaded, setLoaded] = useState(!!collegeIndexSync())
  const [failed, setFailed] = useState(false)
  const listRef = useRef(null)
  const blurTimer = useRef(null)

  useEffect(() => { setText(value || '') }, [value])
  const ensureLoaded = () => {
    if (loaded) return
    loadColleges().then(() => setLoaded(true)).catch(() => setFailed(true))
  }
  // Debounced search.
  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => { setResults(loaded ? searchColleges(text, limit) : []); setActive(-1) }, 120)
    return () => clearTimeout(t)
  }, [text, open, loaded, limit])
  useEffect(() => () => clearTimeout(blurTimer.current), [])

  const trimmed = text.trim()
  const exact = useMemo(() => results.some((c) => normalize(c.name) === normalize(trimmed)), [results, trimmed])
  const options = useMemo(() => {
    const list = results.map((c) => ({ kind: 'college', c }))
    if (trimmed && !exact) list.push({ kind: 'free', text: trimmed })
    return list
  }, [results, trimmed, exact])
  const showList = open && !!trimmed

  useEffect(() => {
    if (active < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const choose = (opt) => {
    if (!opt) return
    if (opt.kind === 'college') {
      setText(opt.c.name)
      onChange?.(opt.c.name, { id: opt.c.id, domain: opt.c.domain || '' })
    } else {
      setText(opt.text)
      onChange?.(opt.text, null)
    }
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); ensureLoaded(); return }
      setActive((a) => (options.length ? (a + 1) % options.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (options.length ? (a <= 0 ? options.length - 1 : a - 1) : -1))
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && options[active]) { e.preventDefault(); choose(options[active]) }
      else if (showList) { e.preventDefault(); setOpen(false) }
    } else if (e.key === 'Escape') {
      if (showList) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1) }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const selected = collegeId && normalize(lookupCollege({ id: collegeId })?.name || '') === normalize(text)
  const activeId = showList && active >= 0 ? `${listId}-${active}` : undefined

  return (
    <div className="cl-college-picker">
      <div className="cl-college-input">
        {selected ? <CollegeLogo id={collegeId} name={text} domain={collegeDomain} size={24} /> : <Search size={17} aria-hidden="true" />}
        <input
          id={inputId}
          className="cl-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          value={text}
          onFocus={() => { ensureLoaded(); if (text.trim()) setOpen(true) }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120) }}
          onChange={(e) => { setText(e.target.value); setOpen(true); ensureLoaded(); onChange?.(e.target.value, null) }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul id={listId} ref={listRef} role="listbox" aria-label="College suggestions" className="cl-college-list" hidden={!showList}>
        {showList && !loaded && !failed && <li className="cl-college-note" role="presentation">Loading colleges…</li>}
        {showList && failed && <li className="cl-college-note" role="presentation">Couldn’t load the college list — you can still type your college.</li>}
        {showList && options.map((o, i) => (
          <li key={o.kind === 'college' ? o.c.id : 'free'} id={`${listId}-${i}`} data-idx={i} role="option" aria-selected={i === active}
            className={`cl-college-opt${i === active ? ' active' : ''}${o.kind === 'free' ? ' free' : ''}`}
            onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}>
            {o.kind === 'college' ? (
              <>
                <CollegeLogo name={o.c.name} domain={o.c.domain} id={o.c.id} size={32} />
                <span className="cl-college-opt-body">
                  <strong>{o.c.name}</strong>
                  <small>{[o.c.city, o.c.state].filter(Boolean).join(', ')}{o.c.type ? ` · ${o.c.type}` : ''}</small>
                </span>
              </>
            ) : (
              <>
                <span className="cl-college-free-ico"><Plus size={16} /></span>
                <span className="cl-college-opt-body">
                  <strong>Use “{o.text}”</strong>
                  <small>{results.length ? 'Not in the list? Save exactly what you typed.' : 'No match in our list — save what you typed.'}</small>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default CollegePicker
