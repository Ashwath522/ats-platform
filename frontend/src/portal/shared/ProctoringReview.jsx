/**
 * Reviewer view of AI-interview proctoring: overall risk, flags, event
 * timeline and the evidence snapshot gallery (click to enlarge).
 * Used by recruiters (own jobs only — enforced server-side) and admins.
 *
 *   <ProctoringReview role="recruiter" applicationId={12} />
 *   <ProctoringReview role="admin" sessionId={34} />
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Camera, ShieldAlert, ShieldCheck, Clock, ImageOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, Badge, EmptyState, IconButton, Modal, Skeleton } from '../../ui/index.jsx'
import { useApi, useQuery } from '../../ui/useApi.js'
import { EVENT_LABELS } from '../../interview/proctor-rules.js'
import './ProctoringReview.css'

const RISK_TONE = { high: 'red', medium: 'amber', low: 'green' }
const SEV_TONE = { high: 'red', medium: 'amber', low: '', info: 'blue' }

const label = (t) => EVENT_LABELS[t] || String(t || '').replace(/_/g, ' ')

function fmtClock(iso, startIso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (!startIso) return clock
  const s = Math.max(0, Math.round((d - new Date(startIso)) / 1000))
  return `${clock} · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} in`
}

/** Snapshot images need the reviewer's bearer token → fetch as blob → object URL. */
function useSnapshotUrl(api, url) {
  const [state, setState] = useState({ src: null, error: false })
  useEffect(() => {
    if (!url) return undefined
    let alive = true
    let obj = null
    api.request('GET', url, undefined, { raw: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        obj = URL.createObjectURL(await res.blob())
        if (alive) setState({ src: obj, error: false })
      })
      .catch(() => alive && setState({ src: null, error: true }))
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj) }
  }, [api, url])
  return state
}

function SnapshotImg({ api, snap, className, alt }) {
  const { src, error } = useSnapshotUrl(api, snap.url)
  if (error) return <div className={`pr-img-missing ${className || ''}`}><ImageOff size={20} /><span>Unavailable</span></div>
  if (!src) return <div className={`pr-img-loading ${className || ''}`}><Skeleton h="100%" /></div>
  return <img className={className} src={src} alt={alt} width={snap.width || undefined} height={snap.height || undefined} />
}

export default function ProctoringReview({ role = 'recruiter', applicationId, sessionId, compact = false }) {
  const api = useApi(role)
  const url = sessionId ? `/api/proctoring/sessions/${sessionId}` : applicationId ? `/api/proctoring/applications/${applicationId}` : null
  const q = useQuery(() => (url ? api.get(url) : Promise.resolve(null)), [api, url])
  const [open, setOpen] = useState(null) // index into snapshots
  const d = q.data
  const snaps = d?.snapshots || []
  const snapIndex = useMemo(() => Object.fromEntries(snaps.map((s, i) => [s.id, i])), [snaps])

  if (!url) return null
  if (q.loading && !d) return <div className="pr-root"><Skeleton h={90} /></div>
  if (q.error) return <Alert tone="error">Could not load proctoring: {q.error.message}</Alert>
  if (!d) return null

  const risk = d.risk || {}
  const level = risk.risk_level || 'low'
  const start = d.session?.started_at
  const events = (d.events || []).filter((e) => e.severity !== 'low' || !compact)
  const counts = Object.entries(d.event_counts && Object.keys(d.event_counts).length ? d.event_counts : (risk.counts || {}))
    .sort((a, b) => b[1] - a[1])
  const evidenceCount = snaps.filter((s) => s.kind !== 'baseline').length
  const cur = open != null ? snaps[open] : null

  return (
    <section className="pr-root" aria-label="Proctoring review">
      <div className="pr-head">
        <h4>{level === 'low' ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />} Proctoring</h4>
        <Badge tone={RISK_TONE[level]} dot>{level} risk{risk.risk_score != null ? ` · ${risk.risk_score}/100` : ''}</Badge>
        {risk.status && <Badge tone={risk.status === 'active' ? 'green' : 'amber'}>{risk.status === 'active' ? 'All checks ran' : `Checks ${risk.status}`}</Badge>}
        <span className="pr-muted"><Camera size={14} /> {evidenceCount} evidence snapshot{evidenceCount === 1 ? '' : 's'}</span>
      </div>

      {!d.session && <p className="pr-muted">No AI interview session recorded for this application yet.</p>}

      {counts.length > 0 && (
        <div className="pr-flags">
          {counts.map(([type, n]) => <span key={type} className="pr-flag">{label(type)} <b>×{n}</b></span>)}
        </div>
      )}
      {d.session && counts.length === 0 && <p className="pr-muted">No integrity events were detected during this interview.</p>}
      {risk.detectors && Object.keys(risk.detectors).length > 0 && risk.status !== 'active' && (
        <p className="pr-muted pr-small">On-device checks: {Object.entries(risk.detectors).map(([k, v]) => `${k} ${v}`).join(' · ')}. Signals may be incomplete — review with care.</p>
      )}

      {snaps.length > 0 && (
        <div className="pr-gallery" role="list">
          {snaps.map((s, i) => (
            <button key={s.id} type="button" role="listitem" className={`pr-thumb pr-sev-${s.severity}`} onClick={() => setOpen(i)}
              aria-label={`Open snapshot: ${label(s.event_type)} at ${fmtClock(s.at)}`}>
              <SnapshotImg api={api} snap={s} alt={`${label(s.event_type)} snapshot`} />
              <span className="pr-thumb-cap"><b>{s.kind === 'baseline' ? 'Identity (start)' : label(s.event_type)}</b><small>{fmtClock(s.at)}</small></span>
            </button>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <details className="pr-timeline" open={!compact && events.length <= 12}>
          <summary><Clock size={14} /> Timeline ({events.length} event{events.length === 1 ? '' : 's'})</summary>
          <ol>
            {events.map((e) => (
              <li key={e.id}>
                <span className="pr-time">{fmtClock(e.at, start)}</span>
                <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
                <span className="pr-ev">{label(e.type)}{e.details?.corroborated ? <small> · corroborated</small> : null}</span>
                {e.snapshot_id != null && snapIndex[e.snapshot_id] != null && (
                  <button type="button" className="pr-link" onClick={() => setOpen(snapIndex[e.snapshot_id])}><Camera size={13} /> View</button>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="pr-muted pr-small">
        Signals come from on-device checks and can be wrong (lighting, camera angle, glasses). An alert is a prompt for human review, not proof.
        Snapshots are visible only to the hiring company and CoreLink admins and are deleted after {d.retention_days || 90} days.
      </p>

      {d.session === null && snaps.length === 0 && compact && <EmptyState icon={ShieldCheck} title="No proctoring data" />}

      <Modal open={!!cur} onClose={() => setOpen(null)} size="lg"
        title={cur ? `${cur.kind === 'baseline' ? 'Identity snapshot (start)' : label(cur.event_type)} — ${fmtClock(cur.at, start)}` : ''}>
        {cur && (
          <div className="pr-viewer">
            <SnapshotImg api={api} snap={cur} className="pr-full" alt={`${label(cur.event_type)} evidence snapshot`} />
            <div className="pr-viewer-bar">
              <IconButton icon={ChevronLeft} label="Previous snapshot" onClick={() => setOpen((i) => Math.max(0, i - 1))} disabled={open === 0} />
              <span>
                <Badge tone={SEV_TONE[cur.severity]}>{cur.severity}</Badge>{' '}
                {open + 1} / {snaps.length} · {cur.width}×{cur.height} · {Math.round((cur.size_bytes || 0) / 1024)} KB
              </span>
              <IconButton icon={ChevronRight} label="Next snapshot" onClick={() => setOpen((i) => Math.min(snaps.length - 1, i + 1))} disabled={open === snaps.length - 1} />
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
