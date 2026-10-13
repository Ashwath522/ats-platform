/** "Latest for <branch>": fresh papers (arXiv), lectures (YouTube) and admin notes. */
import React, { useState } from 'react'
import { Download, ExternalLink, FileText, Radio, Video, BookOpen, GraduationCap } from 'lucide-react'
import { Alert, Card, EmptyState, Segmented, Skeleton, fmtDate, timeAgo } from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import { mediaUrl } from '../../../lib/api.js'
import './student.css'

const KINDS = [
  { id: '', label: 'All' },
  { id: 'paper', label: 'Papers' },
  { id: 'video', label: 'Videos' },
  { id: 'notes', label: 'Notes' },
]
const KIND_ICON = { paper: FileText, video: Video, notes: BookOpen, article: FileText, course: GraduationCap }
const KIND_LABEL = { paper: 'Research paper', video: 'Video lecture', notes: 'Notes (PDF)', article: 'Article', course: 'Course' }

export default function LiveResources({ branchId, branchLabel }) {
  const api = useApi('candidate')
  const [kind, setKind] = useState('')
  const qs = new URLSearchParams({ branch: branchId || 'all', limit: '9' })
  if (kind) qs.set('kind', kind)
  const q = useQuery(() => api.get(`/api/student/live-resources?${qs}`), [api, branchId, kind])
  const d = q.data
  return (
    <Card title={<><Radio size={20} style={{ color: '#0f766e' }} />Latest for {branchLabel}</>}
      subtitle={d?.last_synced_at ? `Fresh papers, lectures and notes · updated ${timeAgo(d.last_synced_at)}` : 'Fresh papers, lectures and notes from official sources'}
      action={<Segmented value={kind} onChange={setKind} options={KINDS} />}>
      {q.error && <Alert tone="error">{q.error.message} <button className="cl-link" onClick={q.reload}>Retry</button></Alert>}
      {q.loading && !d ? <div className="st-live-res">{[0, 1, 2].map((i) => <Skeleton key={i} h={84} />)}</div>
        : !d?.items?.length ? (
          <EmptyState icon={Radio} title={kind ? `No ${KINDS.find((k) => k.id === kind)?.label.toLowerCase()} yet` : 'Nothing new yet'}
            text="New material for your branch appears here after the next sync. The curated catalogue below is always available." />
        ) : (
          <div className="st-live-res" style={{ opacity: q.loading ? 0.6 : 1 }}>
            {d.items.map((r) => <LiveItem key={r.id} r={r} />)}
          </div>
        )}
    </Card>
  )
}

function LiveItem({ r }) {
  const Icon = KIND_ICON[r.kind] || FileText
  const href = r.file_url ? mediaUrl(r.file_url) : r.url
  const date = r.published_at || r.created_at
  const [broken, setBroken] = useState(false)
  return (
    <article className="st-live-item">
      {r.thumbnail_url && !broken ? <img src={r.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className={`st-fmt ${r.kind === 'video' ? 'video' : ''}`}><Icon size={17} /></span>}
      <div style={{ minWidth: 0 }}>
        <b className="st-clamp-2">{r.title}</b>
        <small className="cl-ellipsis">{KIND_LABEL[r.kind] || r.kind} · {r.source_label}{date ? ` · ${fmtDate(date)}` : ''}</small>
        {r.author && <small className="cl-ellipsis">{r.author}</small>}
        <div className="st-live-actions">
          {r.file_url
            ? <a href={href} target="_blank" rel="noopener noreferrer" download><Download size={13} />Download PDF</a>
            : <a href={href} target="_blank" rel="noopener noreferrer">{r.kind === 'video' ? 'Watch' : 'Open'} on {r.source_label}<ExternalLink size={12} /></a>}
        </div>
      </div>
    </article>
  )
}
