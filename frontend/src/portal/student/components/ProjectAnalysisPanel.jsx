/** Student side of project analysis: evidence files, demo video, run analysis, see the report. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FileUp, Film, Loader2, RefreshCw, ScanSearch, Trash2, Upload, X } from 'lucide-react'
import { Alert, Badge, Button, useToast } from '../../../ui/index.jsx'
import { useApi, useQuery } from '../../../ui/useApi.js'
import {
  DEFAULT_LIMITS, fmtBytes, isRunning, stageRows, uploadWithProgress, validateProjectFile,
} from '../../../lib/projectAnalysis.js'
import ProjectReport from '../../shared/ProjectReport.jsx'
import '../../shared/project-report.css'

const POLL_MS = 2500

function Stepper({ job }) {
  const rows = stageRows(job?.stages)
  return (
    <ol className="pa-steps" aria-live="polite">
      {rows.map((r) => (
        <li key={r.name} className={`pa-step ${r.state}`}>
          <span className="pa-step-dot" aria-hidden>{r.state === 'done' ? <Check size={12} /> : r.state === 'failed' ? <X size={12} /> : null}</span>
          <div><b>{r.label}</b>{r.message && <small>{r.message}</small>}</div>
        </li>
      ))}
    </ol>
  )
}

export default function ProjectAnalysisPanel({ project, onChanged }) {
  const api = useApi('candidate')
  const toast = useToast()
  const pid = project.id
  const domains = useQuery(() => api.get('/api/student/project-domains'), [api])
  const dom = domains.data?.domains?.find((d) => d.key === project.domain)
  const limits = domains.data?.limits || DEFAULT_LIMITS
  const [files, setFiles] = useState([])
  const [frames, setFrames] = useState([])
  const [uploads, setUploads] = useState([])          // {name, pct, error}
  const [over, setOver] = useState(false)
  const [job, setJob] = useState(null)
  const [starting, setStarting] = useState(false)
  const [video, setVideo] = useState(null)             // {pct, label} while extracting
  const [code, setCode] = useState(project.challenge_code)
  const [pdfBusy, setPdfBusy] = useState(false)
  const inputRef = useRef(null)
  const timer = useRef(null)

  const loadFiles = useCallback(async () => {
    const d = await api.get(`/api/student/projects/${pid}/files`, { cache: false })
    setFiles(d.files || []); setFrames(d.frames || [])
  }, [api, pid])

  const loadJob = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const d = await api.get(`/api/student/projects/${pid}/analysis`, { cache: false })
      setJob(d.status === 'none' ? null : d)
      if (isRunning(d)) timer.current = setTimeout(loadJob, POLL_MS)
    } catch (e) { /* keep last state */ }
  }, [api, pid])

  useEffect(() => { loadFiles(); loadJob(); return () => clearTimeout(timer.current) }, [loadFiles, loadJob])

  const addFiles = async (list) => {
    const queue = [...list]
    let current = [...files]
    for (const f of queue) {
      const err = validateProjectFile(f, dom?.extensions || [], current, limits)
      if (err) { setUploads((u) => [...u, { name: f.name, error: err }]); continue }
      setUploads((u) => [...u.filter((x) => x.name !== f.name), { name: f.name, pct: 0 }])
      try {
        const row = await uploadWithProgress(`/api/student/projects/${pid}/files`, api.token, f, (pct) =>
          setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, pct } : x))))
        current = row.duplicate ? current : [...current, row]
        setUploads((u) => u.filter((x) => x.name !== f.name))
        if (row.duplicate) toast(`${f.name} is already uploaded`, 'info')
      } catch (e) {
        setUploads((u) => u.map((x) => (x.name === f.name ? { name: f.name, error: e.message } : x)))
      }
    }
    await loadFiles()
  }

  const removeFile = async (f) => {
    try { await api.del(`/api/student/projects/${pid}/files/${f.id}`); await loadFiles() } catch (e) { toast(e.message, 'error') }
  }

  const pickVideo = async (file) => {
    if (!file) return
    setVideo({ pct: 0, label: 'Opening video' })
    try {
      const { extractKeyframes } = await import('../../../lib/videoFrames.js')
      const { frames: fr } = await extractKeyframes(file, { onProgress: (pct, label) => setVideo({ pct, label }) })
      if (!fr.length) throw new Error('No frames could be read from this video.')
      const fd = new FormData()
      fr.forEach((f, i) => { fd.append('frames', f.blob, `frame${i}.jpg`); fd.append('timestamps', f.timestamp) })
      setVideo({ pct: 100, label: 'Uploading key frames' })
      await api.put(`/api/student/projects/${pid}/video-frames`, fd)
      toast(`${fr.length} key frames saved — your video itself stayed on your device`, 'success')
      await loadFiles()
    } catch (e) { toast(e.message, 'error') } finally { setVideo(null) }
  }

  const clearFrames = async () => { await api.del(`/api/student/projects/${pid}/video-frames`); await loadFiles() }

  const newCode = async () => {
    try { const d = await api.post(`/api/student/projects/${pid}/challenge-code`); setCode(d.challenge_code); onChanged && onChanged() } catch (e) { toast(e.message, 'error') }
  }

  const start = async () => {
    setStarting(true)
    try {
      const d = await api.post(`/api/student/projects/${pid}/analyse`)
      if (d.reused && d.status === 'done') toast('Nothing changed since the last analysis — showing that report', 'info')
      await loadJob()
    } catch (e) { toast(e.message, 'error') } finally { setStarting(false) }
  }

  const download = async () => {
    setPdfBusy(true)
    try {
      const res = await api.get(`/api/student/projects/${pid}/analysis/report.pdf`, { raw: true })
      if (!res.ok) throw new Error('The report could not be downloaded')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = `${project.title.replace(/[^\w-]+/g, '_').slice(0, 50)}_report.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { toast(e.message, 'error') } finally { setPdfBusy(false) }
  }

  const running = isRunning(job)
  const result = job?.result || job?.previous_result
  const accept = (dom?.extensions || []).join(',')

  return (
    <div className="pa-panel">
      <h3><ScanSearch size={18} /> Evidence & AI analysis {dom && <Badge tone="blue">{dom.label}</Badge>}</h3>
      {dom?.tip && <p className="pa-hint">{dom.tip}</p>}

      <div className="cl-col" style={{ gap: 8 }}>
        <strong style={{ fontSize: 13.5 }}>Project files <span className="cl-muted">({files.length}/{limits.files})</span></strong>
        {!!dom?.suggested_evidence?.length && <p className="pa-hint">Best evidence: {dom.suggested_evidence.join(' · ')}</p>}
        <div
          className={`pa-drop${over ? ' over' : ''}`} role="button" tabIndex={0}
          onClick={() => inputRef.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}>
          <FileUp size={18} style={{ verticalAlign: -4 }} /> Drop files here or <u>browse</u> — up to {limits.file_mb} MB each
          <input ref={inputRef} type="file" multiple hidden accept={accept} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </div>
        <ul className="pa-files">
          {files.map((f) => (
            <li key={f.id} className="pa-file">
              <span className="pa-file-name" title={f.filename}>{f.filename}</span><small>{f.kind} · {fmtBytes(f.size_bytes)}</small>
              <button type="button" className="cl-icon-btn" aria-label={`Remove ${f.filename}`} onClick={() => removeFile(f)}><Trash2 size={15} /></button>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.name} className="pa-file">
              <span className="pa-file-name">{u.name}</span>
              {u.error ? <small style={{ color: 'var(--cl-red)', whiteSpace: 'normal' }}>{u.error}</small>
                : <><div className="pr-bar"><i style={{ width: `${u.pct}%`, background: 'var(--cl-blue)' }} /></div><small>{u.pct}%</small></>}
              {u.error && <button type="button" className="cl-icon-btn" aria-label="Dismiss" onClick={() => setUploads((x) => x.filter((y) => y.name !== u.name))}><X size={15} /></button>}
            </li>
          ))}
        </ul>
      </div>

      <div className="cl-col" style={{ gap: 8 }}>
        <strong style={{ fontSize: 13.5 }}><Film size={15} style={{ verticalAlign: -2 }} /> Demo video</strong>
        {code && <div className="pa-code">Say or show this code in your demo video: <b>{code}</b><Button size="sm" variant="ghost" onClick={newCode}>New code</Button></div>}
        {project.video_url
          ? <p className="pa-hint">YouTube: <a href={project.video_url} target="_blank" rel="noreferrer">{project.video_url}</a> — AI watches and listens to it. Change it with Edit.</p>
          : <p className="pa-hint">Best: add an <b>Unlisted YouTube link</b> with Edit (the AI can also hear you). Or pick a video file — only 12 still frames are sent, the video stays on your device.</p>}
        {!project.video_url && (
          <div className="cl-row cl-wrap" style={{ gap: 8 }}>
            <label className="cl-btn outline sm" style={{ cursor: video ? 'wait' : 'pointer' }}>
              {video ? <Loader2 size={15} className="cl-spin" /> : <Upload size={15} />} {video ? `${video.label} ${video.pct}%` : frames.length ? 'Replace video' : 'Use a video file'}
              <input type="file" accept="video/*" hidden disabled={!!video} onChange={(e) => { pickVideo(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {!!frames.length && <><Badge tone="green">{frames.length} key frames saved</Badge><Button size="sm" variant="ghost" icon={Trash2} onClick={clearFrames}>Remove</Button></>}
          </div>
        )}
      </div>

      <div className="cl-row cl-wrap" style={{ gap: 8, alignItems: 'center' }}>
        <Button icon={job ? RefreshCw : ScanSearch} loading={starting || running} onClick={start}>
          {running ? 'Analysing…' : job ? 'Analyse again' : 'Analyse project'}
        </Button>
        {job?.stale && !running && <Alert tone="info">Your evidence changed since this report — analyse again to update it.</Alert>}
      </div>
      {job?.status === 'failed' && <Alert tone="error">{job.error || 'The analysis failed. Please try again.'}</Alert>}
      {job && (running || job.status === 'failed') && <Stepper job={job} />}
      {running && result && <p className="pa-hint">Showing your previous report until the new one is ready.</p>}
      {result && <ProjectReport result={result} videoUrl={project.video_url} onDownload={job?.status === 'done' ? download : undefined} downloading={pdfBusy} />}
      {job?.status === 'done' && <details><summary className="pa-hint" style={{ cursor: 'pointer' }}>How this analysis worked</summary><Stepper job={job} /></details>}
      <p className="pa-hint">"Verified" means your uploaded evidence agrees with a claim — CoreLink did not test the project itself. A CoreLink reviewer gives the final Verified badge.</p>
    </div>
  )
}
