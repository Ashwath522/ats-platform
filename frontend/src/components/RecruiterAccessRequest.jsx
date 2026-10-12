import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CheckCircle2, ChevronDown, Loader2, Send, ShieldQuestion } from 'lucide-react'
import { CheckList, ScoreRing, VerdictBadge } from './VerificationReport'
import './RecruiterAccessRequest.css'

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  designation: '',
  company_name: '',
  company_website: '',
  gstin: '',
  cin: '',
  linkedin_url: '',
}

// Changes to these fields re-run the live company verification.
const VERIFY_FIELDS = ['email', 'company_name', 'company_website', 'gstin', 'cin', 'linkedin_url']
const DEBOUNCE_MS = 700

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

function toFormData(values) {
  const fd = new FormData()
  Object.entries(values).forEach(([key, value]) => {
    const trimmed = (value || '').trim()
    if (trimmed) fd.append(key, trimmed)
  })
  return fd
}

async function readError(res, fallback) {
  try {
    const data = await res.json()
    if (typeof data.detail === 'string') return data.detail
    if (Array.isArray(data.detail) && data.detail[0]?.msg) return data.detail[0].msg
  } catch {
    /* ignore */
  }
  return fallback
}

export default function RecruiterAccessRequest({ onSwitchToLogin }) {
  const [values, setValues] = useState(EMPTY)
  const [showOptional, setShowOptional] = useState(false)
  const [verification, setVerification] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const abortRef = useRef(null)

  const verifyKey = useMemo(
    () => VERIFY_FIELDS.map(field => (values[field] || '').trim()).join('|'),
    [values]
  )

  useEffect(() => {
    if (!looksLikeEmail(values.email)) {
      setVerification(null)
      setVerifying(false)
      return undefined
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setVerifying(true)
      setVerifyError(null)
      try {
        const res = await fetch('/api/recruiter-requests/validate', {
          method: 'POST',
          body: toFormData(values),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(await readError(res, 'Verification is unavailable right now'))
        setVerification(await res.json())
      } catch (err) {
        if (err.name !== 'AbortError') setVerifyError(err.message || 'Verification is unavailable right now')
      } finally {
        if (abortRef.current === controller) setVerifying(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // values is intentionally read via closure; verifyKey decides when to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  function update(field) {
    return e => setValues(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/recruiter-requests', { method: 'POST', body: toFormData(values) })
      if (!res.ok) {
        const fallback = res.status === 422
          ? 'This request could not be accepted. Please use your official work email.'
          : 'Could not submit your request. Please try again.'
        throw new Error(await readError(res, fallback))
      }
      setSubmitted(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    const verdict = submitted.verification?.verdict
    return (
      <div className="rar rar-success">
        <CheckCircle2 size={48} className="rar-success-icon" aria-hidden="true" />
        <h2>Request submitted</h2>
        <p>
          Thanks, {values.name.trim().split(' ')[0] || 'there'}! We have emailed a confirmation to{' '}
          <strong>{values.email.trim()}</strong>.
        </p>
        <p className="rar-muted">
          {verdict === 'verified'
            ? 'Your company details checked out. An admin will approve your account shortly.'
            : 'An admin will review your company details. This usually takes up to one business day.'}
        </p>
        {onSwitchToLogin && (
          <button type="button" className="rar-btn rar-btn-secondary" onClick={onSwitchToLogin}>
            Back to sign in
          </button>
        )}
      </div>
    )
  }

  const blocked = verification?.blocked

  return (
    <div className="rar">
      <div className="rar-intro">
        <div className="rar-intro-icon"><Building2 size={22} aria-hidden="true" /></div>
        <div>
          <h2>Request recruiter access</h2>
          <p className="rar-muted">We verify every company before granting access. Use your official work email.</p>
        </div>
      </div>

      <div className="rar-layout">
        <form className="rar-form" onSubmit={handleSubmit}>
          <fieldset className="rar-fieldset">
            <legend>About you</legend>
            <div className="rar-grid">
              <label className="rar-field">
                <span>Full name *</span>
                <input value={values.name} onChange={update('name')} required autoComplete="name" placeholder="Priya Sharma" />
              </label>
              <label className="rar-field">
                <span>Designation</span>
                <input value={values.designation} onChange={update('designation')} autoComplete="organization-title" placeholder="Talent Acquisition Lead" />
              </label>
              <label className="rar-field">
                <span>Work email *</span>
                <input type="email" value={values.email} onChange={update('email')} required autoComplete="email" inputMode="email" placeholder="priya@yourcompany.com" />
              </label>
              <label className="rar-field">
                <span>Phone *</span>
                <input type="tel" value={values.phone} onChange={update('phone')} required autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" />
              </label>
            </div>
          </fieldset>

          <fieldset className="rar-fieldset">
            <legend>Your company</legend>
            <div className="rar-grid">
              <label className="rar-field">
                <span>Company name *</span>
                <input value={values.company_name} onChange={update('company_name')} required autoComplete="organization" placeholder="Acme Technologies Pvt Ltd" />
              </label>
              <label className="rar-field">
                <span>Company website *</span>
                <input type="url" value={values.company_website} onChange={update('company_website')} required inputMode="url" placeholder="https://yourcompany.com"
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v && !/^https?:\/\//i.test(v)) setValues(prev => ({ ...prev, company_website: `https://${v}` }))
                  }} />
              </label>
            </div>

            <button type="button" className="rar-toggle" onClick={() => setShowOptional(s => !s)} aria-expanded={showOptional}>
              <ChevronDown size={16} className={showOptional ? 'rar-rotate' : ''} aria-hidden="true" />
              Business identifiers (optional, speeds up approval)
            </button>
            {showOptional && (
              <div className="rar-grid">
                <label className="rar-field">
                  <span>GSTIN</span>
                  <input value={values.gstin} onChange={update('gstin')} maxLength={15} autoCapitalize="characters" placeholder="27AAPFU0939F1ZV" />
                </label>
                <label className="rar-field">
                  <span>CIN</span>
                  <input value={values.cin} onChange={update('cin')} maxLength={21} autoCapitalize="characters" placeholder="U72900KA2015PTC082988" />
                </label>
                <label className="rar-field rar-field-wide">
                  <span>LinkedIn company page</span>
                  <input type="url" value={values.linkedin_url} onChange={update('linkedin_url')} inputMode="url" placeholder="https://www.linkedin.com/company/your-company" />
                </label>
              </div>
            )}
          </fieldset>

          {error && <div className="rar-alert rar-alert-error" role="alert">{error}</div>}

          {verification && (
            <a href="#rar-verification" className={`rar-summary rar-summary-${verification.verdict}`}>
              <VerdictBadge verdict={verification.verdict} />
              <span>Trust score <b>{verification.score}</b>/100 · {blocked ? verification.block_reason : 'see checks below'}</span>
            </a>
          )}

          <button type="submit" className="rar-btn rar-btn-primary" disabled={submitting || blocked}>
            {submitting ? <Loader2 size={18} className="rar-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
          {onSwitchToLogin && (
            <p className="rar-switch">
              Already approved?{' '}
              <button type="button" className="rar-link" onClick={onSwitchToLogin}>Sign in</button>
            </p>
          )}
        </form>

        <aside className="rar-panel" id="rar-verification" aria-live="polite">
          <div className="rar-panel-head">
            <h3>Company verification</h3>
            {verifying && <Loader2 size={16} className="rar-spin rar-muted" aria-label="Checking" />}
          </div>
          {!verification && !verifying && !verifyError && (
            <div className="rar-panel-empty">
              <ShieldQuestion size={28} aria-hidden="true" />
              <p>Enter your work email and company website to see live verification checks.</p>
            </div>
          )}
          {verifyError && !verification && <p className="rar-muted">{verifyError}</p>}
          {verification && (
            <div className={`rar-panel-body ${verifying ? 'rar-stale' : ''}`}>
              <div className="rar-score">
                <ScoreRing score={verification.score} verdict={verification.verdict} />
                <div className="rar-score-text">
                  <VerdictBadge verdict={verification.verdict} />
                  <span className="rar-muted">Trust score out of 100</span>
                </div>
              </div>
              {blocked && verification.block_reason && (
                <div className="rar-alert rar-alert-error">{verification.block_reason}</div>
              )}
              <CheckList checks={verification.checks} hideSkipped />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
