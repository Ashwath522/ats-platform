import React, { useEffect, useState } from 'react'
import { Alert, Avatar, Badge, Button, Modal, Skeleton } from '../../../ui/index.jsx'
import { API, BranchBadge, MatchPill, VerifiedTick, yearLine } from './RecruiterPipelineKit.jsx'

/** Side-by-side comparison of up to 3 candidates (POST /portal/candidates/compare). */
export default function CandidateCompareModal({ open, onClose, api, candidateIds = [], onView }) {
  const [state, setState] = useState({ loading: true })
  const key = candidateIds.join(',')
  useEffect(() => {
    if (!open) return
    if (!candidateIds.length) { setState({ error: 'Select 1–3 candidates to compare.' }); return }
    let alive = true
    setState({ loading: true })
    api.post(`${API}/candidates/compare`, { candidate_ids: candidateIds.slice(0, 3) })
      .then((d) => alive && setState({ data: d.candidates }))
      .catch((e) => alive && setState({ error: e.message }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])
  const rows = state.data || []
  const best = (f) => {
    const vals = rows.map(f).filter((v) => typeof v === 'number')
    return vals.length > 1 ? Math.max(...vals) : null
  }
  const num = (label, f, fmt = (v) => v) => {
    const b = best(f)
    return (
      <tr key={label}><th scope="row">{label}</th>{rows.map((r) => {
        const v = f(r)
        return <td key={r.candidate_id} className={b != null && v === b ? 'best' : undefined}>{v == null ? '—' : fmt(v)}</td>
      })}</tr>
    )
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title={`Compare candidates${rows.length ? ` (${rows.length})` : ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {state.loading && <Skeleton h={220} />}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {rows.length > 0 && (
        <div className="cl-table-wrap">
          <table className="rp-compare">
            <thead>
              <tr>
                <th />
                {rows.map((r) => (
                  <td key={r.candidate_id}>
                    <div className="rp-person">
                      <Avatar name={r.name} src={r.avatar_path} size={40} />
                      <div style={{ minWidth: 0 }}>
                        <strong>{r.name} <VerifiedTick show={r.verified} size={15} /></strong>
                        <small>{yearLine(r) || r.college}</small>
                      </div>
                    </div>
                    {onView && <Button size="sm" variant="outline" style={{ marginTop: 8 }} onClick={() => { onClose(); onView(r.candidate_id) }}>View profile</Button>}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">Branch</th>{rows.map((r) => <td key={r.candidate_id}><BranchBadge branch={r.branch} long /></td>)}</tr>
              <tr><th scope="row">College</th>{rows.map((r) => <td key={r.candidate_id}>{r.college || '—'}{r.degree ? <div className="cl-muted" style={{ fontSize: 12 }}>{r.degree}</div> : null}</td>)}</tr>
              {num('CGPA', (r) => r.cgpa, (v) => v.toFixed(1))}
              <tr><th scope="row">Match</th>{rows.map((r) => <td key={r.candidate_id}><MatchPill value={r.match} />{r.match_source === 'skills' && r.match != null && <div className="cl-muted" style={{ fontSize: 12, marginTop: 4 }}>skill overlap with your open jobs</div>}</td>)}</tr>
              <tr><th scope="row">Applied for</th>{rows.map((r) => <td key={r.candidate_id}>{r.job_title || <span className="cl-muted">Not applied to your jobs</span>}</td>)}</tr>
              {num('ATS score', (r) => r.ats_score)}
              {num('Project score', (r) => (r.project_score != null ? Math.round(r.project_score) : null))}
              {num('Interview score', (r) => r.interview_score)}
              {num('Verified projects', (r) => r.verified_projects)}
              <tr><th scope="row">Skills</th>{rows.map((r) => <td key={r.candidate_id}><div className="rp-skill-chips">{(r.skills || []).slice(0, 10).map((s) => <span key={s} className="cl-chip soft">{s}</span>)}{!r.skills?.length && <span className="cl-muted">—</span>}</div></td>)}</tr>
              <tr><th scope="row">Stage</th>{rows.map((r) => <td key={r.candidate_id}>{r.stage_label ? <Badge tone="blue">{r.stage_label}</Badge> : '—'}</td>)}</tr>
            </tbody>
          </table>
          <p className="cl-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Highlighted cells show the highest value in each row.</p>
        </div>
      )}
    </Modal>
  )
}
