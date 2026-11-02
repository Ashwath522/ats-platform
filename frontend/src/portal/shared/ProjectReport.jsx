/** Consolidated project analysis report — shared by student, admin and recruiter views. */
import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Download, FileText, HelpCircle, Video, XCircle } from 'lucide-react'
import { Badge, Button, Ring } from '../../ui/index.jsx'
import { CLAIM_STATUS, scoreTone, youtubeAt } from '../../lib/projectAnalysis.js'
import './project-report.css'

const SEV = {
  ok: { icon: CheckCircle2, tone: 'green' }, issue: { icon: XCircle, tone: 'red' }, warn: { icon: AlertTriangle, tone: 'amber' },
  missing: { icon: CircleSlash, tone: 'gray' }, info: { icon: HelpCircle, tone: 'blue' },
}
const TONE_COLOR = { green: '#16a34a', blue: '#0b5cff', amber: '#d97706', red: '#dc2626', gray: '#94a3b8' }
const METHOD = { parsed: 'read from file', rule: 'engineering check', vision_model: 'AI vision', transcript: 'speech', api: 'GitHub', student_claim: 'student', ocr: 'OCR' }

function EvidenceChips({ ids = [], byId, videoUrl }) {
  if (!ids.length) return null
  return (
    <div className="pr-chips">
      {ids.slice(0, 8).map((id) => {
        const e = byId[id]
        if (!e) return null
        const t = e.locator?.t || (e.source_type === 'video' ? e.source_ref : null)
        const label = e.source_type === 'video' ? `▶ ${t}` : e.source_type === 'analysis' ? 'check' : e.source_ref.split('/').pop()
        const href = t && videoUrl ? youtubeAt(videoUrl, t) : null
        const chip = <span className={`pr-chip ${e.confidence}`} title={`${e.fact}\n(${METHOD[e.method] || e.method}, ${e.confidence} confidence)`}>{label}</span>
        return href ? <a key={id} href={href} target="_blank" rel="noreferrer">{chip}</a> : <React.Fragment key={id}>{chip}</React.Fragment>
      })}
    </div>
  )
}

function ClaimRow({ c, byId, videoUrl }) {
  const [open, setOpen] = useState(false)
  const st = CLAIM_STATUS[c.status] || CLAIM_STATUS.not_checked
  return (
    <li className="pr-claim">
      <button type="button" className="pr-claim-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="pr-claim-text">{c.text}</span>
        <ChevronDown size={16} className={open ? 'pr-rot' : ''} />
      </button>
      {open && (
        <div className="pr-claim-body">
          <p>{c.reasoning || 'No explanation available.'}</p>
          {(c.evidence_ids || []).map((id) => byId[id] && (
            <div key={id} className="pr-ev-line"><code>{id}</code> {byId[id].fact} <small>({METHOD[byId[id].method] || byId[id].method}, {byId[id].confidence})</small></div>
          ))}
          <EvidenceChips ids={c.evidence_ids} byId={byId} videoUrl={videoUrl} />
        </div>
      )}
    </li>
  )
}

function Table({ head, rows }) {
  if (!rows?.length) return null
  return (
    <div className="pr-table-wrap">
      <table className="pr-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]}>{c ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

const PIN_STATUS = { ok: ['green', 'Match'], mismatch: ['red', 'Not wired'], unused: ['amber', 'Unused in code'], unchecked: ['gray', 'No wiring file'], circuit_only: ['gray', 'Circuit only'] }

function ComponentsData({ data, domain }) {
  if (!data) return null
  if (domain === 'electronics' || domain === 'robotics_iot') {
    return (
      <>
        <Table head={['Part', 'Value / type', 'Source']} rows={(data.table || []).map((c) => [c.name, c.value, c.source])} />
        {!!data.libraries?.length && <p className="pr-small"><b>Code libraries:</b> {data.libraries.join(', ')}</p>}
        {!!data.from_photos?.length && <p className="pr-small"><b>Read from photos (medium confidence):</b> {data.from_photos.join(', ')}</p>}
      </>
    )
  }
  if (domain === 'software' || domain === 'ai_ml') {
    return (
      <>
        {!!data.stack?.length && <div className="pr-tags">{data.stack.map((s) => <span key={s} className="st-tag blue">{s}</span>)}</div>}
        {!!data.models?.length && <p className="pr-small"><b>Models:</b> {data.models.join(', ')}</p>}
        <Table head={['Dataset', 'Rows', 'Columns', 'Missing %', 'Duplicates']} rows={(data.datasets || []).map((d) => [d.file, d.rows, d.cols, d.missing_pct, d.duplicates])} />
      </>
    )
  }
  if (domain === 'mechanical') {
    return (
      <>
        {!!data.parts?.length && <div className="pr-tags">{data.parts.map((s) => <span key={s} className="st-tag">{s}</span>)}</div>}
        <Table head={['Mesh', 'Triangles', 'Size (x × y × z)', 'Closed solid']} rows={(data.meshes || []).map((m) => [m.file, m.triangles, m.bbox ? m.bbox.map((x) => +x.toFixed(2)).join(' × ') : '—', m.watertight ? 'Yes' : 'No'])} />
        {!!data.dimensions?.length && <p className="pr-small"><b>Drawing dimensions:</b> {data.dimensions.join(', ')}</p>}
      </>
    )
  }
  if (domain === 'civil') {
    return (
      <>
        <Table head={['Element', 'Count']} rows={Object.entries(data.elements || {}).map(([k, v]) => [k, v])} />
        {!!data.storeys?.length && <p className="pr-small"><b>Storeys:</b> {data.storeys.join(', ')}</p>}
        {!!data.materials?.length && <p className="pr-small"><b>Materials:</b> {data.materials.join(', ')}</p>}
      </>
    )
  }
  return <Table head={['Document', 'Pages', 'Words']} rows={(data.documents || []).map((d) => [d.file, d.pages, d.words])} />
}

function VideoData({ video, videoUrl }) {
  if (!video) return null
  return (
    <ol className="pr-timeline">
      {(video.segments || []).map((s, i) => {
        const href = videoUrl ? youtubeAt(videoUrl, s.start) : null
        return (
          <li key={i}>
            {href ? <a href={href} target="_blank" rel="noreferrer" className="pr-ts">{s.start}</a> : <span className="pr-ts">{s.start}</span>}
            <div>
              {!!s.visible?.length && <div><b>Visible:</b> {s.visible.join(', ')}</div>}
              {!!s.actions?.length && <div><b>Action:</b> {s.actions.join(', ')}</div>}
              {(s.inputs?.length || s.outputs?.length) ? <div><b>Input → output:</b> {(s.inputs || []).join(', ') || '—'} → {(s.outputs || []).join(', ') || '—'}</div> : null}
            </div>
          </li>
        )
      })}
      {video.challenge_code_found !== undefined && (
        <li className="pr-code"><Badge tone={video.challenge_code_found ? 'green' : 'amber'}>{video.challenge_code_found ? 'Verification code found in video' : 'Verification code not found'}</Badge></li>
      )}
    </ol>
  )
}

export default function ProjectReport({ result, videoUrl, onDownload, downloading, hideEvidence }) {
  const [showEv, setShowEv] = useState(false)
  const byId = useMemo(() => Object.fromEntries((result?.evidence || []).map((e) => [e.id, e])), [result])
  if (!result) return null
  const sc = result.scores || {}
  const claims = Object.fromEntries((result.claims || []).map((c) => [c.id, c]))
  const domain = result.domain || result.report?.domain
  const sections = result.report?.sections || []
  const tone = scoreTone(sc.overall)
  return (
    <div className="pr-root">
      <div className="pr-top">
        <Ring value={sc.overall ?? 0} size={112} stroke={10} color={TONE_COLOR[tone]} label={sc.overall == null ? '—' : sc.overall} sub="/100" />
        <div className="pr-top-text">
          <strong>Evidence score</strong>
          <span className="cl-muted">Based on {sc.coverage ?? 0}% of the {result.report?.domain_label || ''} rubric that had evidence.</span>
          {sc.note && <small className="cl-muted">{sc.note}</small>}
          {onDownload && <Button size="sm" variant="outline" icon={Download} loading={downloading} onClick={onDownload}>Download PDF</Button>}
        </div>
      </div>
      <div className="pr-dims">
        {Object.entries(sc.dimensions || {}).map(([k, d]) => (
          <div key={k} className="pr-dim" title={d.reason}>
            <div className="pr-dim-head"><span>{d.label}</span><b>{d.score == null ? 'Not enough evidence' : `${d.score}/10`}</b></div>
            <div className="pr-bar"><i style={{ width: `${(d.score || 0) * 10}%`, background: TONE_COLOR[scoreTone(d.score == null ? null : d.score * 10)] }} /></div>
            <small>{d.reason}</small>
          </div>
        ))}
      </div>

      {sections.map((sec) => {
        if (sec.evidence) return null
        const items = sec.items || []
        return (
          <section key={sec.id} className="pr-sec">
            <h4>{sec.id === 'video' && <Video size={16} />}{sec.title}</h4>
            {sec.text && <p>{sec.text}</p>}
            {sec.id === 'components' && <ComponentsData data={sec.data} domain={domain} />}
            {sec.id === 'video' && <VideoData video={sec.data} videoUrl={videoUrl} />}
            {!!items.length && (
              <ul className="pr-items">
                {items.map((it, i) => {
                  const s = SEV[it.severity]
                  const Icon = s?.icon
                  return <li key={i}>{Icon && <Icon size={15} className={`pr-sev ${s.tone}`} />}<span>{it.text}</span>{it.evidence_id && <EvidenceChips ids={byId[it.evidence_id]?.source_type === 'analysis' ? (result.domain_data?.findings || []).find((f) => f.id === it.evidence_id)?.evidence_ids || [] : [it.evidence_id]} byId={byId} videoUrl={videoUrl} />}</li>
                })}
              </ul>
            )}
            {sec.id === 'architecture' && sec.data?.pin_map && (
              <Table head={['Pin', 'Used in code as', 'Circuit', 'Status']} rows={sec.data.pin_map.map((r) => {
                const [t, l] = PIN_STATUS[r.status] || ['gray', r.status]
                return [r.pin, r.code || '—', r.circuit || '—', <Badge key="b" tone={t}>{l}</Badge>]
              })} />
            )}
            {sec.claims && (sec.claims.length
              ? <ul className="pr-claims">{sec.claims.map((id) => claims[id] && <ClaimRow key={id} c={claims[id]} byId={byId} videoUrl={videoUrl} />)}</ul>
              : <p className="cl-muted">None.</p>)}
          </section>
        )
      })}

      {!hideEvidence && (
        <section className="pr-sec">
          <button type="button" className="pr-ev-toggle" onClick={() => setShowEv((x) => !x)} aria-expanded={showEv}>
            <FileText size={16} /> Evidence references & confidence ({result.evidence?.length || 0}) <ChevronDown size={16} className={showEv ? 'pr-rot' : ''} />
          </button>
          {showEv && (
            <ul className="pr-evlist">
              {(result.evidence || []).map((e) => (
                <li key={e.id}><code>{e.id}</code><span>{e.fact}</span><small>{e.source_type}: {e.source_ref} · {METHOD[e.method] || e.method} · {e.confidence}</small></li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!!result.warnings?.length && !hideEvidence && (
        <details className="pr-warn"><summary>{result.warnings.length} note(s) from the file reader</summary><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      )}
    </div>
  )
}
