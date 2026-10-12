import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import './VerificationReport.css'

export const VERDICT_META = {
  verified: { label: 'Verified', Icon: ShieldCheck, className: 'vr-verdict--verified' },
  review: { label: 'Needs review', Icon: ShieldAlert, className: 'vr-verdict--review' },
  high_risk: { label: 'High risk', Icon: ShieldX, className: 'vr-verdict--high_risk' },
}

const STATUS_META = {
  pass: { Icon: CheckCircle2, label: 'Passed' },
  warn: { Icon: AlertTriangle, label: 'Warning' },
  fail: { Icon: XCircle, label: 'Failed' },
  skip: { Icon: MinusCircle, label: 'Skipped' },
}

export function VerdictBadge({ verdict, score }) {
  const meta = VERDICT_META[verdict]
  if (!meta) return <span className="vr-verdict vr-verdict--unknown">Not verified</span>
  const { Icon, label, className } = meta
  return (
    <span className={`vr-verdict ${className}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
      {typeof score === 'number' && <span className="vr-verdict-score">{score}</span>}
    </span>
  )
}

export function ScoreRing({ score = 0, verdict, size = 64 }) {
  const stroke = 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, Number(score) || 0))
  const offset = circumference * (1 - clamped / 100)
  return (
    <div className={`vr-ring vr-ring--${verdict || 'unknown'}`} style={{ width: size, height: size }}
      role="img" aria-label={`Verification score ${clamped} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="vr-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="vr-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="vr-ring-label">{clamped}</span>
    </div>
  )
}

export function CheckList({ checks = [], hideSkipped = false }) {
  const visible = hideSkipped ? checks.filter(c => c.status !== 'skip') : checks
  if (!visible.length) return null
  return (
    <ul className="vr-checks">
      {visible.map(check => {
        const meta = STATUS_META[check.status] || STATUS_META.skip
        const { Icon } = meta
        return (
          <li key={check.id} className={`vr-check vr-check--${check.status}`}>
            <Icon size={16} className="vr-check-icon" aria-label={meta.label} />
            <div className="vr-check-body">
              <div className="vr-check-label">{check.label}</div>
              {check.detail && <div className="vr-check-detail">{check.detail}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Renders a verification dict from the backend:
 * { score, verdict, blocked, block_reason, checks: [{id,label,status,detail,weight}], domain }
 */
export default function VerificationReport({ verification, compact = false }) {
  if (!verification) {
    return <div className="vr-empty">No verification data for this request.</div>
  }
  const { score, verdict, checks = [], blocked, block_reason: blockReason, domain, website_title: title } = verification
  const counts = checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {})
  return (
    <div className={`vr ${compact ? 'vr--compact' : ''}`}>
      <div className="vr-header">
        <ScoreRing score={score} verdict={verdict} size={compact ? 52 : 64} />
        <div className="vr-header-text">
          <VerdictBadge verdict={verdict} />
          <div className="vr-summary">
            {counts.pass || 0} passed · {counts.warn || 0} warnings · {counts.fail || 0} failed
          </div>
          {(domain || title) && (
            <div className="vr-domain">
              {domain && <span>{domain}</span>}
              {title && <span className="vr-domain-title">“{title}”</span>}
            </div>
          )}
        </div>
      </div>
      {blocked && blockReason && <div className="vr-blocked">{blockReason}</div>}
      <CheckList checks={checks} hideSkipped={compact} />
    </div>
  )
}
