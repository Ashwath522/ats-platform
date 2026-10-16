/**
 * On-device proctoring for the live AI interview.
 *
 * Everything runs in the browser — video never leaves the device. Models are
 * MediaPipe Tasks (lazy loaded from the CDN, GPU → CPU fallback):
 *   - BlazeFace short-range     → face presence / multiple faces   (~1 Hz)
 *   - FaceLandmarker            → head pose + iris gaze, static-photo check (~0.7 Hz)
 *   - EfficientDet-Lite0 (COCO) → phone / book / second screen / extra person (every ~3 s)
 *   - lighting (32×24 luma)     → camera covered / too dark (every 2 s)
 * plus browser signals (tab switch, window blur, fullscreen exit, copy/paste,
 * right-click, dev-tools-like resize, camera track ended).
 *
 * Observations go through ProctorRules (sustained windows, 2-of-3 object hits,
 * per-candidate gaze baseline, corroboration) so ordinary glances never flag.
 * Detectors run one at a time on a 250 ms tick and back off (or switch off)
 * when a detection is slow, so phones stay smooth. A detector that can't load
 * is simply skipped and the status becomes "limited".
 *
 * Real interviews only: when a medium/high event fires, one JPEG frame (≤640 px,
 * ~0.6 quality, ≤~60 KB, timestamp + event burned in) is uploaded as evidence,
 * with a 20 s cooldown per event type and 30 per session, plus one baseline
 * identity frame at the start. Practice mode never uploads anything — it only
 * shows the student live counts.
 */
import { FaceDetector } from '../lib/cv/face-detector'
import { GazeHeadPoseEstimator } from '../lib/cv/gaze-headpose'
import { ObjectDetector } from '../lib/cv/object-detector'
import { analyzeLighting } from '../lib/cv/lighting-utils'
import { calculateRiskScore } from '../lib/cv/risk-engine'
import { DetectorPacer, EVENT_LABELS, ProctorRules, SnapshotGate } from './proctor-rules.js'

export { EVENT_LABELS }

const TICK_MS = 250
const FLUSH_MS = 10000
const SNAPSHOT_CAP = 30

/** Phone / tablet (touch-first) — no forced full screen there. */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
}

/** 'low' (skip heavy models) | 'mobile' (slower cadence) | 'desktop'. */
export function deviceTier() {
  if (typeof navigator === 'undefined') return 'desktop'
  const cores = navigator.hardwareConcurrency || 4
  const mem = navigator.deviceMemory || 4
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  if (cores <= 2 || mem <= 2) return 'low'
  return coarse || mobileUa ? 'mobile' : 'desktop'
}

const NOTICES = {
  face_left_frame: 'We can\'t see your face — please stay in front of the camera.',
  person_absent: 'You seem to have left — please come back in view of the camera.',
  multiple_faces: 'More than one face is visible. Please make sure you are alone.',
  extra_person: 'Another person seems to be in view. Please make sure you are alone.',
  looking_away: 'Please keep your attention on the interview screen.',
  looking_down: 'Please keep your attention on the interview screen.',
  phone_detected: 'A phone seems to be visible. Please put it away.',
  book_detected: 'Books or notes seem to be visible. Please put them away.',
  second_screen: 'Another screen seems to be visible. Please use only this one.',
  tab_switched: 'You left the interview tab. Please stay on this page until you finish.',
  window_blur: 'Focus left the interview window. Please stay on this page.',
  fullscreen_exit: 'You exited full screen.',
  paste_detected: 'Pasting into answers is noted. Please answer in your own words.',
  camera_covered: 'Your camera looks covered or very dark.',
  camera_off: 'Your camera turned off.',
  spoof_suspected: 'We couldn\'t confirm a live camera feed. Please look at the camera naturally.',
}

/** Draw the frame (≤ maxW wide) with a burned-in label and encode as JPEG ≤ maxBytes. */
export async function captureSnapshot(video, label, { maxW = 640, quality = 0.6, maxBytes = 60000, now = new Date() } = {}) {
  if (!video || !video.videoWidth || !video.videoHeight || typeof document === 'undefined') return null
  const base = Math.min(1, maxW / video.videoWidth)
  const attempts = [[base, quality], [base * 0.75, 0.5], [base * 0.5, 0.42]]
  let last = null
  for (const [scale, q] of attempts) {
    const w = Math.max(16, Math.round(video.videoWidth * scale))
    const h = Math.max(16, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    const bar = Math.max(16, Math.round(h * 0.06))
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, h - bar, w, bar)
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(bar * 0.62)}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    ctx.fillText(`${stamp} · ${label}`.slice(0, 90), 6, h - bar / 2)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))
    if (!blob) return null
    last = { blob, width: w, height: h }
    if (blob.size <= maxBytes) return last
  }
  return last && last.blob.size <= 150 * 1024 ? last : null
}

function eyeAspect(lm) {
  const d = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0)
  const l = d(lm[159], lm[145]) / (d(lm[33], lm[133]) || 1)
  const r = d(lm[386], lm[374]) / (d(lm[263], lm[362]) || 1)
  return (l + r) / 2
}

export class Proctor {
  /**
   * new Proctor({ getVideo, sessionId, api, practice, onUpdate, onNotice })
   * (legacy: new Proctor(videoEl))
   */
  constructor(opts = {}) {
    if (opts && opts.tagName) opts = { getVideo: () => opts } // legacy signature
    else if (typeof HTMLVideoElement !== 'undefined' && opts instanceof HTMLVideoElement) { const v = opts; opts = { getVideo: () => v } }
    this.getVideo = opts.getVideo || (() => null)
    this.getStream = opts.getStream || (() => { const v = this.getVideo(); return v && v.srcObject })
    this.sessionId = opts.sessionId
    this.api = opts.api
    this.practice = !!opts.practice
    this.uploads = !this.practice && !!opts.api && opts.sessionId != null
    this.onUpdate = opts.onUpdate || (() => {})
    this.onNotice = opts.onNotice || (() => {})
    this.tier = opts.tier || deviceTier()
    this.now = opts.now || (() => Date.now())

    this.status = 'starting' // starting | active | limited
    this.detectors = { face: 'loading', headpose: 'off', objects: 'off', lighting: 'ok' }
    this.models = {}
    this.pacers = {
      face: new DetectorPacer({ baseMs: this.tier === 'desktop' ? 1000 : 1500, budgetMs: 60 }),
      headpose: new DetectorPacer({ baseMs: this.tier === 'desktop' ? 1400 : 2200, budgetMs: 80 }),
      objects: new DetectorPacer({ baseMs: this.tier === 'desktop' ? 3000 : 5000, budgetMs: 160, killMs: 900 }),
      lighting: new DetectorPacer({ baseMs: 2000, budgetMs: 20 }),
    }
    this.rules = new ProctorRules({ onEvent: (ev) => this._onEvent(ev) })
    this.gate = new SnapshotGate({ cooldownMs: 20000, cap: SNAPSHOT_CAP })
    this.queue = []          // events waiting to be sent
    this.inflight = new Set() // snapshot upload promises
    this.baselineTaken = false
    this.uploadBlocked = false
    this.snapshotsStored = 0
    this.events = this.rules.events // kept for back-compat (summary / tests)
    this.counts = this.rules.counts
    this._busy = false
    this._timer = null
    this._flushTimer = null
    this._startedAt = 0
    this._wasFullscreen = false
    this._devtoolsOpen = false
    this._stopped = false
    this._bind()
  }

  _bind() {
    this._onVis = () => this.rules.browser(this.now(), document.hidden ? 'hidden' : 'visible')
    this._onBlur = () => this.rules.browser(this.now(), 'blur')
    this._onFocus = () => this.rules.browser(this.now(), 'focus')
    this._onFs = () => {
      if (document.fullscreenElement) { this._wasFullscreen = true; return }
      if (this._wasFullscreen) {
        this._wasFullscreen = false
        this.rules.browser(this.now(), 'fullscreen_exit')
        this._emitUpdate()
      }
    }
    this._onPaste = (e) => {
      if (!this._isAnswerBox(e.target)) return
      const text = (e.clipboardData && e.clipboardData.getData('text')) || ''
      this.rules.browser(this.now(), 'paste', { chars: text.length })
    }
    this._onCopy = (e) => { if (this._isAnswerBox(e.target) || e.type === 'cut') this.rules.browser(this.now(), 'copy', { cut: e.type === 'cut' }) }
    this._onCtx = () => this.rules.browser(this.now(), 'contextmenu')
    this._onResize = () => {
      if (isMobileDevice() || typeof window === 'undefined') return
      const open = window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 220
      if (open && !this._devtoolsOpen) this.rules.browser(this.now(), 'devtools', { dw: window.outerWidth - window.innerWidth, dh: window.outerHeight - window.innerHeight })
      this._devtoolsOpen = open
    }
    this._onTrackEnd = () => this.rules.browser(this.now(), 'camera_off')
    this._onUnload = () => this._flush(true)
  }

  _isAnswerBox(el) {
    return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
  }

  async start() {
    this._startedAt = this.now()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVis)
      document.addEventListener('fullscreenchange', this._onFs)
      document.addEventListener('paste', this._onPaste, true)
      document.addEventListener('copy', this._onCopy, true)
      document.addEventListener('cut', this._onCopy, true)
      document.addEventListener('contextmenu', this._onCtx, true)
      window.addEventListener('blur', this._onBlur)
      window.addEventListener('focus', this._onFocus)
      window.addEventListener('resize', this._onResize)
      window.addEventListener('pagehide', this._onUnload)
      if (document.fullscreenElement) this._wasFullscreen = true
    }
    const stream = this.getStream()
    const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null
    if (track) {
      this._track = track
      track.addEventListener('ended', this._onTrackEnd)
    } else {
      this.detectors = { face: 'off', headpose: 'off', objects: 'off', lighting: 'off' }
      this.status = 'limited'
    }
    this._timer = setInterval(() => this._tick(), TICK_MS)
    if (this.uploads) this._flushTimer = setInterval(() => this._flush(), FLUSH_MS)
    this._emitUpdate()
    if (track) this._loadModels()
  }

  async _loadModels() {
    // Face first (small, most important), then the heavier ones in the background.
    this.models.face = await this._load(new FaceDetector(), 'face')
    this._refreshStatus()
    if (this._stopped) return
    if (this.tier === 'low') { // ≤ 2 cores / ≤ 2 GB: presence + lighting + browser signals only
      this.detectors.headpose = 'skipped'
      this.detectors.objects = 'skipped'
      this._refreshStatus()
      return
    }
    this.models.headpose = await this._load(new GazeHeadPoseEstimator(), 'headpose')
    this._refreshStatus()
    if (this._stopped) return
    this.models.objects = await this._load(new ObjectDetector(), 'objects')
    this._refreshStatus()
  }

  async _load(model, key) {
    this.detectors[key] = 'loading'
    try {
      await model.initialize()
      if (model.usingFallback) throw new Error('model unavailable')
      if (this._stopped) { model.release(); return null }
      this.detectors[key] = 'ok'
      return model
    } catch (e) {
      this.detectors[key] = 'unavailable'
      try { model.release() } catch { /* ignore */ }
      return null
    }
  }

  _refreshStatus() {
    const d = this.detectors
    if (d.face === 'loading') this.status = 'starting'
    else this.status = d.face === 'ok' && d.lighting === 'ok' ? 'active' : 'limited'
    if (this.status === 'active' && (d.headpose !== 'ok' || d.objects !== 'ok') && this.tier !== 'low' && d.headpose !== 'loading' && d.objects !== 'loading') {
      this.status = 'limited'
    }
    this._emitUpdate()
  }

  setTyping(on) { this.rules.setTyping(on) }

  /** Call inside a user gesture (desktop only). Resolves true when full screen. */
  async enterFullscreen() {
    try {
      if (isMobileDevice() || !document.fullscreenEnabled || document.fullscreenElement) return !!document.fullscreenElement
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      this._wasFullscreen = true
      return true
    } catch { return false }
  }

  _tick() {
    if (this._busy || this._stopped) return
    if (typeof document !== 'undefined' && document.hidden) return
    const video = this.getVideo()
    if (!video || video.readyState < 2 || !video.videoWidth) return
    const t = this.now()
    if (!this.baselineTaken && this.uploads && this.detectors.face !== 'loading') {
      const waited = t - this._startedAt
      // Prefer a frame with exactly one face; otherwise take one after 10 s anyway.
      if ((this.detectors.face !== 'ok' && waited > 3000) || waited > 10000) this._baseline(video)
    }
    const order = ['face', 'lighting', 'headpose', 'objects']
    for (const key of order) {
      const pacer = this.pacers[key]
      if (!pacer.due(t)) continue
      if (key !== 'lighting' && !this.models[key]) continue
      this._busy = true
      Promise.resolve(this._run(key, video, t)).finally(() => { this._busy = false })
      return
    }
  }

  async _run(key, video, t) {
    const pacer = this.pacers[key]
    const t0 = performance.now()
    try {
      if (key === 'face') {
        const { faceCount } = await this.models.face.detect(video)
        this.rules.face(t, faceCount)
        if (faceCount === 1 && !this.baselineTaken && this.uploads && t - this._startedAt > 1500) this._baseline(video)
      } else if (key === 'headpose') {
        const r = await this.models.headpose.detect(video)
        if (r && r.headPose && r.landmarks) {
          const lm = r.landmarks
          this.rules.pose(t, { yaw: r.headPose.yaw, pitch: r.headPose.pitch, gazeX: r.gaze ? r.gaze.x : 0, gazeY: r.gaze ? r.gaze.y : 0, nose: lm[4] ? { x: lm[4].x, y: lm[4].y } : null, ear: eyeAspect(lm) })
        } else this.rules.pose(t, null)
      } else if (key === 'objects') {
        this.rules.objects(t, await this.models.objects.detect(video))
      } else if (key === 'lighting') {
        if (!this._lc) { this._lc = document.createElement('canvas'); this._lc.width = 32; this._lc.height = 24 }
        const ctx = this._lc.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(video, 0, 0, 32, 24)
        this.rules.light(t, analyzeLighting(this._lc).brightness)
      }
    } catch (e) {
      /* one bad frame never breaks the interview */
    }
    pacer.record(this.now(), performance.now() - t0)
    if (pacer.disabled && this.detectors[key] === 'ok') {
      this.detectors[key] = 'slow'
      try { this.models[key] && this.models[key].release() } catch { /* ignore */ }
      this.models[key] = null
      this._refreshStatus()
    }
  }

  _baseline(video) {
    this.baselineTaken = true
    this._snapshot({ type: 'baseline', severity: 'info', ts: this.now() }, 'Identity check (start)', video)
  }

  _onEvent(ev) {
    const item = { type: ev.type, severity: ev.severity, ts: new Date(ev.ts).toISOString(), details: { ...ev.details, corroborated: ev.corroborated || undefined }, snapshot_id: null, waiting: false }
    if (ev.severity !== 'low' && NOTICES[ev.type]) this.onNotice({ type: ev.type, severity: ev.severity, text: NOTICES[ev.type] })
    if (this.uploads) {
      this.queue.push(item)
      if (this.gate.allow(ev)) {
        item.waiting = true
        this._snapshot(ev, EVENT_LABELS[ev.type] || ev.type, this.getVideo(), item)
      }
    }
    this._emitUpdate()
  }

  _snapshot(ev, label, video, item = null) {
    if (!this.uploads || this.uploadBlocked) { if (item) item.waiting = false; return }
    const p = (async () => {
      try {
        const shot = await captureSnapshot(video, label)
        if (!shot) return
        const fd = new FormData()
        fd.append('image', shot.blob, `${ev.type}.jpg`)
        fd.append('event_type', ev.type)
        fd.append('severity', ev.severity)
        fd.append('label', label)
        fd.append('client_ts', new Date(ev.ts).toISOString())
        const res = await this.api(`/api/interview/${this.sessionId}/proctor/snapshot`, { method: 'POST', body: fd })
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          this.snapshotsStored += 1
          if (item && data.id) item.snapshot_id = data.id
        } else if (res.status === 409 || res.status === 400 || res.status === 429) {
          this.uploadBlocked = res.status !== 400 // inactive session / cap reached
        }
      } catch { /* offline: the event is still logged */ } finally {
        if (item) item.waiting = false
      }
    })()
    this.inflight.add(p)
    p.finally(() => this.inflight.delete(p))
    return p
  }

  async _flush(beacon = false) {
    if (!this.uploads || this._flushing) return
    const ready = this.queue.filter((e) => !e.waiting)
    if (!ready.length) return
    this._flushing = true
    try {
      for (let i = 0; i < ready.length; i += 50) {
        const batch = ready.slice(i, i + 50)
        const body = JSON.stringify({ events: batch.map(({ waiting, ...rest }) => rest) })
        const res = await this.api(`/api/interview/${this.sessionId}/proctor/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: beacon,
        })
        if (res.ok || res.status === 409 || res.status === 400) {
          this.queue = this.queue.filter((e) => !batch.includes(e))
        } else break
      }
    } catch { /* retry on next flush */ } finally {
      this._flushing = false
    }
  }

  /** Wait for in-flight snapshot uploads (≤ timeoutMs) and send remaining events. Call before /finish. */
  async finalize(timeoutMs = 4000) {
    if (this.inflight.size) {
      await Promise.race([Promise.allSettled([...this.inflight]), new Promise((r) => setTimeout(r, timeoutMs))])
    }
    this.queue.forEach((e) => { e.waiting = false })
    for (let i = 0; this._flushing && i < 100; i++) await new Promise((r) => setTimeout(r, 50)) // a periodic flush is in flight
    await this._flush()
  }

  liveState() {
    const alerts = this.rules.events.filter((e) => e.severity !== 'low').length
    return { status: this.status, detectors: { ...this.detectors }, alerts, counts: { ...this.rules.counts }, snapshots: this.snapshotsStored }
  }

  _emitUpdate() {
    try { this.onUpdate(this.liveState()) } catch { /* ignore */ }
  }

  summary() {
    const signals = this.rules.signals({ faceOk: this.detectors.face === 'ok', lightOk: this.detectors.lighting === 'ok' })
    const events = this.rules.events.map((e) => ({ type: e.type, severity: e.severity, metadata: e.details, timestamp: new Date(e.ts).toISOString() }))
    const risk = calculateRiskScore({ events, currentSignals: signals })
    const flags = Object.entries(this.rules.counts)
      .filter(([type]) => type !== 'low_light' || this.rules.counts.low_light > 2)
      .map(([type, n]) => ({ type, label: EVENT_LABELS[type] || type, count: n }))
    return {
      risk_score: risk.score,
      risk_level: risk.level,
      breakdown: risk.breakdown,
      counts: { ...this.rules.counts },
      flags,
      detectors: { ...this.detectors },
      device_tier: this.tier,
      baseline: this.rules.baseline,
      proctoring_status: this.status,
      event_count: this.rules.events.length,
      snapshots: this.snapshotsStored,
      corroborated_events: this.rules.events.filter((e) => e.corroborated).length,
    }
  }

  stop() {
    if (this._stopped) return
    this._stopped = true
    clearInterval(this._timer)
    clearInterval(this._flushTimer)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVis)
      document.removeEventListener('fullscreenchange', this._onFs)
      document.removeEventListener('paste', this._onPaste, true)
      document.removeEventListener('copy', this._onCopy, true)
      document.removeEventListener('cut', this._onCopy, true)
      document.removeEventListener('contextmenu', this._onCtx, true)
      window.removeEventListener('blur', this._onBlur)
      window.removeEventListener('focus', this._onFocus)
      window.removeEventListener('resize', this._onResize)
      window.removeEventListener('pagehide', this._onUnload)
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {})
    }
    if (this._track) this._track.removeEventListener('ended', this._onTrackEnd)
    for (const m of Object.values(this.models)) { try { m && m.release() } catch { /* ignore */ } }
    this.models = {}
  }
}
