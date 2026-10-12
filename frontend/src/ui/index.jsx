/**
 * CoreLink UI v2 component library. Import from 'src/ui'.
 * Styling lives in ui.css (prefix `cl-`). Keep page code free of one-off
 * styling where a component here already covers it.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2, MoreHorizontal, X, Inbox, Check, Circle, Info } from 'lucide-react'
import { heroMedia } from '../branding/branches.js'
import { mediaUrl } from '../lib/api.js'
import './ui.css'

export const cx = (...a) => a.filter(Boolean).join(' ')

/* ── Brand ─────────────────────────────────────────────────────────── */
export function BrandMark({ size = 34 }) {
  return (
    <svg className="cl-brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="clbm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f7bff" />
          <stop offset="1" stopColor="#0b4fe0" />
        </linearGradient>
      </defs>
      <path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" fill="url(#clbm)" />
      <path d="M20 11 27.8 15.5v9L20 29l-7.8-4.5v-9Z" fill="#fff" />
      <path d="M20 15.2 24.1 17.6v4.8L20 24.8l-4.1-2.4v-4.8Z" fill="#0b5cff" />
    </svg>
  )
}

export function Brand({ sub, to = '/', size = 34 }) {
  return (
    <Link to={to} className="cl-brand" aria-label="CoreLink home">
      <BrandMark size={size} />
      <span>
        <span className="cl-brand-name">CoreLink</span>
        {sub && <span className="cl-brand-sub">{sub}</span>}
      </span>
    </Link>
  )
}

/* ── Buttons ───────────────────────────────────────────────────────── */
export function Button({ variant = 'primary', size, icon: Icon, iconRight: IconR, loading, block, to, href, className, children, ...rest }) {
  const cls = cx('cl-btn', variant, size, block && 'block', className)
  const inner = (
    <>
      {loading ? <Loader2 size={16} className="cl-spin" /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} /> : null}
      {children}
      {IconR && !loading ? <IconR size={size === 'sm' ? 15 : 17} /> : null}
    </>
  )
  if (to) return <Link to={to} className={cls} {...rest}>{inner}</Link>
  if (href) return <a href={href} className={cls} target="_blank" rel="noreferrer" {...rest}>{inner}</a>
  return <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>{inner}</button>
}

export function IconButton({ icon: Icon, label, boxed, size = 18, className, ...rest }) {
  return (
    <button type="button" className={cx('cl-icon-btn', boxed && 'boxed', className)} aria-label={label} title={label} {...rest}>
      <Icon size={size} />
    </button>
  )
}

/* ── Cards ─────────────────────────────────────────────────────────── */
export function Card({ title, subtitle, icon: Icon, action, children, className, flush, tint, as: As = 'section', ...rest }) {
  return (
    <As className={cx('cl-card', flush && 'flush', tint && 'tint', className)} {...rest}>
      {(title || action) && (
        <div className="cl-card-head" style={flush ? { padding: '16px 18px 0' } : undefined}>
          <div>
            {title && <h3>{Icon && <Icon size={20} />}{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </As>
  )
}

export function ViewAll({ to, onClick, children = 'View All' }) {
  if (to) return <Link className="cl-link" to={to}>{children}</Link>
  return <button type="button" className="cl-link" onClick={onClick}>{children}</button>
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="cl-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="cl-page-actions">{actions}</div>}
    </div>
  )
}

/**
 * Navy banner with the branch's approved photo on the right.
 * `branch` = branch id/label (string) or catalogue object; `page` picks a
 * page-specific crop when the branch has one.
 */
export function Hero({ title, text, actions, branch, page, src, tall, script, children, showBranchNote }) {
  const media = useMemo(() => (src ? { src } : heroMedia(branch, page)), [src, branch, page])
  return (
    <section className={cx('cl-hero', tall && 'tall')}>
      {media.src ? (
        <div className="cl-hero-media"><img src={media.src} alt="" loading="eager" /></div>
      ) : media.collage ? (
        <div className="cl-hero-collage" aria-hidden="true">
          {media.collage.map((s, i) => <img key={i} src={s} alt="" />)}
        </div>
      ) : null}
      <div className="cl-hero-body">
        {typeof title === 'string' ? <h1>{title}</h1> : title}
        {text && <p>{text}</p>}
        {actions && <div className="cl-hero-actions">{actions}</div>}
        {children}
      </div>
      {script && <div className="cl-hero-script" aria-hidden="true">{script}</div>}
      {showBranchNote && media.branch && <div className="cl-hero-branch">{media.branch.long}</div>}
    </section>
  )
}

/* ── Badges / chips ────────────────────────────────────────────────── */
export function Badge({ tone, dot, children, className, ...rest }) {
  return <span className={cx('cl-badge', tone, dot && 'dot', className)} {...rest}>{children}</span>
}

const STATUS_TONES = {
  active: 'green', open: 'green', verified: 'green', accepted: 'green', shortlisted: 'green', completed: 'green', connected: 'green', joined: 'blue', hired: 'green', approved: 'green', online: 'green', offer_received: 'purple',
  under_review: 'amber', pending: 'amber', paused: 'amber', review: 'amber', negotiation: 'amber', needs_work: 'amber', in_progress: 'amber', draft: 'amber', invited: 'amber', ats_check: 'amber', applied: 'blue',
  interview: 'blue', interview_scheduled: 'blue', scheduled: 'blue', unlocked: 'blue', automated_interview: 'blue', repo_verification: 'blue', sent: 'blue', onsite: 'purple',
  rejected: 'red', closed: 'red', declined: 'red', suspended: 'red', cancelled: 'red', high_risk: 'red', failed: 'red', inactive: 'red', withdrawn: 'red', not_selected: 'red', locked: '',
  archived: '', offer: 'purple', final_result: 'purple',
}
const STATUS_LABELS = {
  ats_check: 'Under Review', repo_verification: 'Project Review', automated_interview: 'AI Interview', interview_scheduled: 'Interview Scheduled', under_review: 'Under Review', offer_received: 'Offer Received', final_result: 'Final Decision', not_selected: 'Not Selected', high_risk: 'High Risk', in_progress: 'In Progress',
}
export const statusLabel = (s) => STATUS_LABELS[s] || String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
export function StatusPill({ status, label, dot = true }) {
  const key = String(status || '').toLowerCase().replace(/\s+/g, '_')
  return <Badge tone={STATUS_TONES[key] ?? ''} dot={dot}>{label || statusLabel(status)}</Badge>
}

export function Chip({ children, onRemove, onClick, active, tone, className }) {
  return (
    <span
      className={cx('cl-chip', tone, (onClick) && 'clickable', active && 'active', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(e) : undefined}
    >
      {children}
      {onRemove && <button type="button" aria-label={`Remove ${typeof children === 'string' ? children : ''}`} onClick={(e) => { e.stopPropagation(); onRemove() }}><X size={14} /></button>}
    </span>
  )
}

/** Marks values that are illustrative rather than real data. */
export function DemoTag({ title = 'Illustrative sample — replace when the integration is connected' }) {
  return <span className="cl-demo" title={title}><Info size={11} /> Sample data</span>
}

/* ── Stats / progress / charts ─────────────────────────────────────── */
export function StatTile({ icon: Icon, tone, value, label, delta, deltaDir, deltaNote = 'vs last month', className }) {
  const dir = deltaDir || (typeof delta === 'number' && delta < 0 ? 'down' : 'up')
  return (
    <div className={cx('cl-card', className)} style={{ padding: 16 }}>
      <div className="cl-stat">
        {Icon && <div className={cx('cl-stat-icon', tone)}><Icon size={22} /></div>}
        <div className="cl-grow">
          <div className="cl-stat-value">{value ?? '—'}</div>
          <div className="cl-stat-label">{label}</div>
          {delta != null && delta !== '' && (
            <div className={cx('cl-delta', dir)}>
              {dir === 'down' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
              {typeof delta === 'number' ? `${Math.abs(delta)}%` : delta} {deltaNote && <small>{deltaNote}</small>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Progress({ value = 0, color, height }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return <div className="cl-progress" style={height ? { height } : undefined}><div style={{ width: `${v}%`, background: color }} /></div>
}

export function ProgressRow({ label, value, color, right }) {
  return (
    <div className="cl-progress-row">
      <span className="cl-ellipsis">{label}</span>
      <Progress value={value} color={color} />
      <span style={{ fontWeight: 600, color: color || 'var(--cl-blue)', minWidth: 40, textAlign: 'right' }}>{right ?? `${Math.round(value)}%`}</span>
    </div>
  )
}

/** Score ring (e.g. resume score 78/100). */
export function Ring({ value = 0, max = 100, size = 132, stroke = 11, color = '#0b5cff', track = '#e7edf7', label, sub, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / max))
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? value} ${sub ?? ''}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        {children || (<>
          <div style={{ fontSize: size * 0.27, fontWeight: 800, color: 'var(--cl-ink)', lineHeight: 1 }}>{label ?? Math.round(value)}</div>
          {sub && <div style={{ fontSize: 12.5, color: 'var(--cl-muted)', marginTop: 4 }}>{sub}</div>}
        </>)}
      </div>
    </div>
  )
}

export const PALETTE = ['#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#94a3b8', '#84cc16', '#f97316']

/** Donut chart. segments: [{label, value, color}] */
export function Donut({ segments = [], size = 150, stroke = 20, center, sub }) {
  const total = segments.reduce((a, s) => a + (Number(s.value) || 0), 0)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f8" strokeWidth={stroke} />
        {total > 0 && segments.map((s, i) => {
          const len = (c * (Number(s.value) || 0)) / total
          const gap = segments.length > 1 ? Math.min(2.5, len / 3) : 0
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color || PALETTE[i % PALETTE.length]} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
          acc += len
          return el
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: size * 0.17, fontWeight: 800, color: 'var(--cl-ink)', lineHeight: 1 }}>{center ?? total}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--cl-muted)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function Legend({ items = [], showPct, total }) {
  const t = total ?? items.reduce((a, s) => a + (Number(s.value) || 0), 0)
  return (
    <div className="cl-legend cl-grow">
      {items.map((s, i) => (
        <div className="cl-legend-item" key={s.label}>
          <i style={{ background: s.color || PALETTE[i % PALETTE.length] }} />
          <span className="cl-ellipsis">{s.label}</span>
          <span>{showPct && t ? `${Math.round((s.value * 100) / t)}%` : s.value}{showPct && t ? <small className="cl-muted" style={{ fontWeight: 500 }}> ({s.value})</small> : null}</span>
        </div>
      ))}
    </div>
  )
}

/** Vertical bar chart. data: [{label, value, color}] */
export function BarChart({ data = [], height = 190, color = '#3b82f6', showValues, yTicks = 4, labelEvery = 1 }) {
  const w = 600
  const pad = { l: 34, r: 8, t: 16, b: 26 }
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0))
  const nice = niceMax(max)
  const ih = height - pad.t - pad.b
  const iw = w - pad.l - pad.r
  const bw = Math.min(42, (iw / Math.max(1, data.length)) * 0.62)
  return (
    <svg className="cl-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(', ')}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const y = pad.t + ih - (ih * i) / yTicks
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#eef2f8" />
            <text x={pad.l - 6} y={y + 4} textAnchor="end">{Math.round((nice * i) / yTicks)}</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const x = pad.l + (iw * (i + 0.5)) / data.length
        const h = (ih * (Number(d.value) || 0)) / nice
        return (
          <g key={i}>
            <rect x={x - bw / 2} y={pad.t + ih - h} width={bw} height={Math.max(0, h)} rx={4} fill={d.color || color}><title>{`${d.label}: ${d.value}`}</title></rect>
            {showValues && <text className="val" x={x} y={pad.t + ih - h - 5} textAnchor="middle">{d.value}</text>}
            {i % labelEvery === 0 && <text x={x} y={height - 8} textAnchor="middle">{d.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

/** Line / area chart. series: [{name, color, values:[n]}], labels: [] */
export function LineChart({ series = [], labels = [], height = 190, area = true, showValues }) {
  const w = 600
  const pad = { l: 34, r: 14, t: 18, b: 26 }
  const all = series.flatMap((s) => s.values.map(Number))
  const nice = niceMax(Math.max(1, ...all))
  const ih = height - pad.t - pad.b
  const iw = w - pad.l - pad.r
  const n = Math.max(1, labels.length - 1)
  const pt = (v, i) => [pad.l + (iw * i) / n, pad.t + ih - (ih * (Number(v) || 0)) / nice]
  return (
    <svg className="cl-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={series.map((s) => `${s.name}: ${s.values.join(', ')}`).join('; ')}>
      {Array.from({ length: 5 }, (_, i) => {
        const y = pad.t + ih - (ih * i) / 4
        return <g key={i}><line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#eef2f8" /><text x={pad.l - 6} y={y + 4} textAnchor="end">{fmtTick((nice * i) / 4)}</text></g>
      })}
      {labels.map((l, i) => <text key={i} x={pt(0, i)[0]} y={height - 8} textAnchor="middle">{l}</text>)}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => pt(v, i))
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
        const c = s.color || PALETTE[si]
        return (
          <g key={si}>
            {area && pts.length > 1 && <path d={`${d} L${pts[pts.length - 1][0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z`} fill={c} opacity="0.1" />}
            <path d={d} fill="none" stroke={c} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            {pts.map((p, i) => (
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke={c} strokeWidth="2"><title>{`${s.name} ${labels[i]}: ${s.values[i]}`}</title></circle>
                {showValues && <text className="val" x={p[0]} y={p[1] - 9} textAnchor="middle">{s.values[i]}</text>}
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function niceMax(v) {
  if (v <= 5) return 5
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
}
const fmtTick = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : Math.round(v))

/* ── Tabs / segmented ──────────────────────────────────────────────── */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('cl-tabs', className)} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon
        return (
          <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={cx('cl-tab-btn', value === t.id && 'active')} onClick={() => onChange(t.id)}>
            {Icon && <Icon size={17} />}
            {t.label}
            {t.count != null && <span className="cl-tab-count">({t.count})</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="cl-seg" role="group">
      {options.map((o) => {
        const Icon = o.icon
        return <button key={o.id} type="button" className={value === o.id ? 'active' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{Icon && <Icon size={15} />}{o.label}</button>
      })}
    </div>
  )
}

/* ── Forms ─────────────────────────────────────────────────────────── */
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('cl-field', className)}>
      {label && <span>{label}</span>}
      {children}
      {error ? <small className="err">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  )
}
export const Input = React.forwardRef(function Input({ className, icon: Icon, right, ...rest }, ref) {
  if (!Icon && !right) return <input ref={ref} className={cx('cl-input', className)} {...rest} />
  return (
    <div className="cl-input-icon">
      {Icon && <Icon size={17} />}
      <input ref={ref} className={cx('cl-input', className)} style={Icon ? undefined : { paddingLeft: 12 }} {...rest} />
      {right}
    </div>
  )
})
export function Textarea({ className, ...rest }) { return <textarea className={cx('cl-textarea', className)} {...rest} /> }
export function Select({ options = [], className, placeholder, ...rest }) {
  return (
    <select className={cx('cl-select', className)} {...rest}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}
export function SearchInput({ value, onChange, placeholder = 'Search…', icon: Icon, ...rest }) {
  return <Input icon={Icon} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} {...rest} />
}
export function Toggle({ checked, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} className={cx('cl-toggle', checked && 'on')} onClick={() => onChange(!checked)} />
}

/* ── People & logos ────────────────────────────────────────────────── */
const AV_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#4f46e5', '#0891b2', '#65a30d']
const hash = (s = '') => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
export const initials = (name = '') => String(name).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'

export function Avatar({ name, src, size = 36, ring }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, fontSize: size * 0.38, background: AV_COLORS[hash(name) % AV_COLORS.length], boxShadow: ring ? '0 0 0 3px #fff, 0 0 0 4px var(--cl-line)' : undefined }
  return (
    <span className="cl-avatar" style={style} aria-hidden="true">
      {src && !broken ? <img src={mediaUrl(src)} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  )
}

/** Company "logo": uploaded logo if any, else a coloured wordmark tile (no third-party trademarks). */
export function LogoTile({ name = '', src, size = 40, wide }) {
  const color = AV_COLORS[hash(name) % AV_COLORS.length]
  const style = { width: wide ? size * 2.2 : size, height: size, color, fontSize: wide ? size * 0.36 : size * 0.4 }
  return (
    <span className="cl-logo" style={style} title={name}>
      {src ? <img src={mediaUrl(src)} alt={name} /> : wide ? name.split(/\s+/)[0].slice(0, 10) : initials(name)}
    </span>
  )
}

export function Person({ name, sub, src, size = 34 }) {
  return (
    <div className="cl-person">
      <Avatar name={name} src={src} size={size} />
      <div style={{ minWidth: 0 }}><strong className="cl-ellipsis">{name}</strong>{sub && <small className="cl-ellipsis">{sub}</small>}</div>
    </div>
  )
}

/* ── Table + pagination ────────────────────────────────────────────── */
/**
 * columns: [{key, header, render?(row), sortable?, sortValue?(row), align?, width?, hideOnMobile?}]
 * Turns into stacked cards on phones (labels from `header`).
 */
export function DataTable({ columns, rows = [], rowKey = (r) => r.id, selectable, selected, onSelect, onRowClick, loading, empty, initialSort }) {
  const [sort, setSort] = useState(initialSort || null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const val = col.sortValue || ((r) => r[col.key])
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })
      return sort.dir === 'asc' ? r : -r
    })
  }, [rows, sort, columns])
  const allSel = selectable && rows.length > 0 && rows.every((r) => selected?.has(rowKey(r)))
  const toggleAll = () => {
    const next = new Set(selected)
    if (allSel) rows.forEach((r) => next.delete(rowKey(r)))
    else rows.forEach((r) => next.add(rowKey(r)))
    onSelect(next)
  }
  const toggle = (k) => {
    const next = new Set(selected)
    next.has(k) ? next.delete(k) : next.add(k)
    onSelect(next)
  }
  return (
    <div className="cl-table-wrap">
      <table className="cl-table cards">
        <thead>
          <tr>
            {selectable && <th style={{ width: 36 }}><input type="checkbox" className="cl-check" aria-label="Select all" checked={!!allSel} onChange={toggleAll} /></th>}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }} className={c.sortable ? 'sortable' : undefined}
                onClick={c.sortable ? () => setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' })) : undefined}
                aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <span className="cl-row" style={{ gap: 4, display: 'inline-flex' }}>
                  {c.header}
                  {c.sortable && sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: 4 }, (_, i) => (
            <tr key={`sk${i}`}>{selectable && <td />}{columns.map((c) => <td key={c.key}><div className="cl-skel" style={{ height: 14 }} /></td>)}</tr>
          ))}
          {!loading && sorted.map((r) => {
            const k = rowKey(r)
            return (
              <tr key={k} className={cx(onRowClick && 'clickable', selected?.has(k) && 'selected')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="cl-check" aria-label="Select row" checked={!!selected?.has(k)} onChange={() => toggle(k)} /></td>}
                {columns.map((c) => (
                  <td key={c.key} data-label={typeof c.header === 'string' ? c.header : undefined} style={{ textAlign: c.align }} className={c.hideOnMobile ? 'hide-m' : undefined}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!loading && rows.length === 0 && (empty || <EmptyState title="Nothing here yet" />)}
    </div>
  )
}

export function usePagination(items, initialSize = 10) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  useEffect(() => { if (page > pages) setPage(1) }, [pages, page])
  const slice = items.slice((page - 1) * pageSize, page * pageSize)
  return { page, setPage, pageSize, setPageSize, pages, slice, total: items.length }
}

export function Pagination({ page, pages, total, pageSize, setPage, setPageSize, noun = 'items' }) {
  if (!total) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const nums = []
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…')
  return (
    <div className="cl-pagination">
      <span>Showing {from}–{to} of {total.toLocaleString()} {noun}</span>
      <div className="cl-row">
        <div className="cl-pages">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
          {nums.map((n, i) => n === '…' ? <span key={`e${i}`} style={{ padding: '0 4px' }}>…</span> : <button key={n} type="button" className={n === page ? 'active' : ''} onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
        </div>
        {setPageSize && (
          <select className="cl-select" style={{ width: 'auto', minHeight: 34, padding: '4px 30px 4px 10px' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} aria-label="Rows per page">
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

/* ── Overlays ──────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, footer, size }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="cl-modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('cl-modal', size)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="cl-modal-head"><h3>{title}</h3><IconButton icon={X} label="Close" onClick={onClose} /></div>
        <div className="cl-modal-body">{children}</div>
        {footer && <div className="cl-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Menu({ items, icon = MoreHorizontal, label = 'More actions', up, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  return (
    <div className="cl-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {children ? <span onClick={() => setOpen((o) => !o)}>{children}</span> : <IconButton icon={icon} label={label} onClick={() => setOpen((o) => !o)} aria-expanded={open} />}
      {open && (
        <div className={cx('cl-menu-pop', up && 'up')} role="menu">
          {items.filter(Boolean).map((it) => {
            const I = it.icon
            return it.to
              ? <Link key={it.label} to={it.to} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => setOpen(false)}>{I && <I size={16} />}{it.label}</Link>
              : <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.() }}>{I && <I size={16} />}{it.label}</button>
          })}
        </div>
      )}
    </div>
  )
}

/* Toasts */
const ToastCtx = createContext({ toast: () => {} })
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const toast = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setItems((l) => [...l, { id, message, tone }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="cl-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('cl-toast', t.tone)}>
            {t.tone === 'success' ? <Check size={17} /> : t.tone === 'error' ? <X size={17} /> : <Info size={17} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx).toast

/* ── States ────────────────────────────────────────────────────────── */
export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="cl-empty">
      <Icon size={36} />
      {title && <strong>{title}</strong>}
      {text && <span>{text}</span>}
      {action}
    </div>
  )
}
export function Skeleton({ h = 16, w = '100%', r }) { return <div className="cl-skel" style={{ height: h, width: w, borderRadius: r }} /> }
export function Alert({ tone, children, icon: Icon = Info }) { return <div className={cx('cl-alert', tone)} role={tone === 'error' ? 'alert' : 'status'}><Icon size={17} style={{ flex: '0 0 auto', marginTop: 1 }} /><div>{children}</div></div> }

export function CheckList({ items = [] }) {
  return (
    <ul className="cl-check-list">
      {items.map((it) => (
        <li key={it.label}>
          {it.done ? <Check size={16} className="ok" style={{ background: 'var(--cl-green)', color: '#fff', borderRadius: 999, padding: 2 }} /> : <Circle size={16} className="todo" />}
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Helpers ───────────────────────────────────────────────────────── */
export const fmtDate = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => {
  if (!d) return '—'
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-IN', opts)
}
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '')
export const timeAgo = (d) => {
  if (!d) return ''
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(d)
}
export const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0)

/** Download rows as CSV (used by Export buttons). */
export function downloadCsv(filename, rows, columns) {
  const cols = columns || Object.keys(rows[0] || {})
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(typeof c === 'string' ? r[c] : '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
