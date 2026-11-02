/** Pure helpers for project evidence & analysis (unit-tested in __tests__/projectAnalysis.test.js). */
import { apiUrl } from './api.js'

export const STAGES = ['validate_files', 'extract_files', 'analyse_domain', 'analyse_video', 'verify_claims', 'build_report']
export const STAGE_LABELS = {
  validate_files: 'Checking files', extract_files: 'Reading files', analyse_domain: 'Engineering analysis',
  analyse_video: 'Demo video', verify_claims: 'Checking claims', build_report: 'Building report',
}
export const CLAIM_STATUS = {
  verified: { label: 'Verified', tone: 'green' },
  partially_verified: { label: 'Partly verified', tone: 'amber' },
  unverified: { label: 'Unverified', tone: 'gray' },
  contradicted: { label: 'Contradicted', tone: 'red' },
  not_checked: { label: 'Not checked', tone: 'gray' },
}
export const DEFAULT_LIMITS = { files: 10, file_mb: 15, total_mb: 60 }

const YT = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/i

export function normalizeYouTubeUrl(value) {
  const m = String(value || '').trim().match(YT)
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
}

/** YouTube link that opens at a "mm:ss" timestamp. */
export function youtubeAt(url, ts) {
  const base = normalizeYouTubeUrl(url)
  if (!base) return null
  const [m, s] = String(ts || '0:0').split(':').map((x) => parseInt(x, 10) || 0)
  return `${base}&t=${m * 60 + s}s`
}

export function fileExt(name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.kicad_sch')) return '.kicad_sch'
  if (n.endsWith('.kicad_pcb')) return '.kicad_pcb'
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i) : ''
}

/** Returns an error message or null. `existing` = files already on the project ({size_bytes}). */
export function validateProjectFile(file, extensions = [], existing = [], limits = DEFAULT_LIMITS) {
  const ext = fileExt(file?.name)
  if (!ext || (extensions.length && !extensions.includes(ext))) return `${file?.name}: ${ext || 'this'} files aren't accepted for this domain`
  if (!file.size) return `${file.name} is empty`
  if (file.size > limits.file_mb * 1024 * 1024) return `${file.name} is larger than ${limits.file_mb} MB`
  if (existing.length >= limits.files) return `A project can have at most ${limits.files} files`
  const used = existing.reduce((n, f) => n + (f.size_bytes ?? f.size ?? 0), 0)
  if (used + file.size > limits.total_mb * 1024 * 1024) return `Project files can't exceed ${limits.total_mb} MB in total`
  return null
}

export function fmtBytes(n = 0) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtTs(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Merge server stages with the fixed order so the stepper always has 6 rows. */
export function stageRows(stages = []) {
  const by = Object.fromEntries((stages || []).map((s) => [s.name, s]))
  return STAGES.map((name) => ({ name, label: STAGE_LABELS[name], state: 'pending', message: '', ...(by[name] || {}) }))
}

export const isRunning = (job) => !!job && (job.status === 'queued' || job.status === 'running')

/**
 * Choose up to `max` frame indexes from per-sample histogram differences:
 * the first frame, the strongest scene changes, then evenly spaced fill-ins.
 */
export function selectFrames(diffs = [], max = 12, minGap = 2) {
  const n = diffs.length
  if (!n) return []
  const picked = new Set([0])
  const order = diffs.map((d, i) => [d, i]).filter(([, i]) => i > 0).sort((a, b) => b[0] - a[0])
  const mean = diffs.reduce((a, b) => a + b, 0) / n
  for (const [d, i] of order) {
    if (picked.size >= Math.ceil(max * 0.7) || d <= mean * 1.5) break
    if ([...picked].every((p) => Math.abs(p - i) >= minGap)) picked.add(i)
  }
  for (let k = 1; picked.size < Math.min(max, n) && k <= n; k++) {
    const i = Math.min(n - 1, Math.round((k * n) / (max + 1)))
    if ([...picked].every((p) => Math.abs(p - i) >= 1)) picked.add(i)
    if (k === n) break
  }
  for (let i = 0; picked.size < Math.min(max, n) && i < n; i++) picked.add(i)
  return [...picked].sort((a, b) => a - b).slice(0, max)
}

export function histDiff(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d
}

/** POST a file with upload progress (fetch has no upload progress). Resolves with the JSON body. */
export function uploadWithProgress(path, token, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl(path))
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      let data = null
      try { data = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error((data && (typeof data.detail === 'string' ? data.detail : data.detail?.[0]?.msg)) || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error while uploading'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

export function scoreTone(v) {
  if (v == null) return 'gray'
  return v >= 75 ? 'green' : v >= 50 ? 'blue' : v >= 30 ? 'amber' : 'red'
}
