import React from 'react'

/** Legend row shown above admin charts (dot + label). */
export function ChartLegend({ items }) {
  return (
    <div className="adm-chart-legend">
      {items.map((it) => <span key={it.label}><i style={{ background: it.color }} />{it.label}</span>)}
    </div>
  )
}

function niceMax(v) {
  if (v <= 4) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 4 ? 4 : m <= 5 ? 5 : 10) * p
}
const tick = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : Math.round(v))

/** Grouped vertical bars: series [{name,color,values}], labels []. */
export function GroupedBars({ series = [], labels = [], height = 170 }) {
  const w = 600
  const pad = { l: 36, r: 8, t: 12, b: 26 }
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.map(Number))))
  const ih = height - pad.t - pad.b
  const iw = w - pad.l - pad.r
  const group = iw / Math.max(1, labels.length)
  const bw = Math.min(30, (group * 0.62) / Math.max(1, series.length))
  return (
    <svg className="cl-chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img"
      aria-label={series.map((s) => `${s.name}: ${s.values.join(', ')}`).join('; ')}>
      {Array.from({ length: 5 }, (_, i) => {
        const y = pad.t + ih - (ih * i) / 4
        return <g key={i}><line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#eef2f8" /><text x={pad.l - 6} y={y + 4} textAnchor="end">{tick((max * i) / 4)}</text></g>
      })}
      {labels.map((l, i) => {
        const cx = pad.l + group * (i + 0.5)
        const start = cx - (bw * series.length + 4 * (series.length - 1)) / 2
        return (
          <g key={i}>
            {series.map((s, si) => {
              const h = (ih * (Number(s.values[i]) || 0)) / max
              return <rect key={si} x={start + si * (bw + 4)} y={pad.t + ih - h} width={bw} height={Math.max(0, h)} rx={3} fill={s.color}><title>{`${s.name} ${l}: ${s.values[i]}`}</title></rect>
            })}
            <text x={cx} y={height - 8} textAnchor="middle">{l}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Horizontal bars with label + value (Top Engineering Branches). */
export function HBars({ rows = [], color = '#3b82f6', lastColor = '#7c8db5' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="adm-hbars">
      {rows.map((r, i) => (
        <div className="adm-hbar" key={r.label}>
          <span className="cl-ellipsis">{r.label}</span>
          <div className="adm-hbar-track"><div style={{ width: `${(r.value * 100) / max}%`, background: i === rows.length - 1 && r.id === 'other' ? lastColor : color }} /></div>
          <strong>{r.value.toLocaleString('en-IN')}</strong>
        </div>
      ))}
    </div>
  )
}
