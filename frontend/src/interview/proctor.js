/**
 * Lightweight, privacy-conscious proctoring for the live interview.
 * Runs entirely on-device: face presence / multiple faces (MediaPipe BlazeFace,
 * loaded lazily) sampled once per second, plus tab-switch detection. Only
 * aggregated signals + event counts leave the device, and they feed the
 * existing corroboration-based risk engine (lib/cv/risk-engine.ts).
 */
import { FaceDetector } from '../lib/cv/face-detector'
import { calculateRiskScore } from '../lib/cv/risk-engine'

export class Proctor {
  constructor(videoEl) {
    this.video = videoEl
    this.events = []
    this.signals = {}
    this.detector = null
    this.timer = null
    this.noFaceSince = null
    this.multiSince = null
    this.status = 'starting' // starting | active | limited
    this.counts = { tabSwitched: 0, faceLeftFrame: 0, multipleFaces: 0 }
    this._onVis = () => {
      if (document.hidden) this._event('tab_switched', 'medium', 'tabSwitched')
    }
  }

  async start() {
    document.addEventListener('visibilitychange', this._onVis)
    try {
      this.detector = new FaceDetector()
      await this.detector.initialize()
      this.status = this.detector.usingFallback ? 'limited' : 'active'
    } catch (e) {
      this.status = 'limited'
    }
    this.timer = setInterval(() => this._sample(), 1000)
  }

  async _sample() {
    if (!this.detector || !this.video || this.video.readyState < 2) return
    const { faceCount } = await this.detector.detect(this.video)
    const now = Date.now()
    if (faceCount === 0) {
      this.noFaceSince = this.noFaceSince || now
      if (now - this.noFaceSince > 4000 && !this.signals.faceLeftFrame) this._event('face_left_frame', 'medium', 'faceLeftFrame')
    } else {
      this.noFaceSince = null
      this.signals.faceLeftFrame = false
    }
    if (faceCount > 1) {
      this.multiSince = this.multiSince || now
      if (now - this.multiSince > 2000 && !this.signals.multipleFaces) this._event('multiple_faces', 'high', 'multipleFaces')
    } else {
      this.multiSince = null
      this.signals.multipleFaces = false
    }
    this.signals.continuousFaceVisible = faceCount === 1
  }

  _event(type, severity, signal) {
    this.events.push({ type, severity, metadata: {}, timestamp: new Date().toISOString() })
    if (signal) {
      this.signals[signal] = true
      this.counts[signal] = (this.counts[signal] || 0) + 1
    }
    if (type === 'tab_switched') setTimeout(() => { this.signals.tabSwitched = false }, 15000)
  }

  summary() {
    // Score using peak signals seen during the session, not just "right now".
    const peak = {
      multipleFaces: this.counts.multipleFaces > 0,
      faceLeftFrame: this.counts.faceLeftFrame > 1,
      tabSwitched: this.counts.tabSwitched > 1,
      continuousFaceVisible: this.counts.faceLeftFrame === 0,
    }
    const risk = calculateRiskScore({ events: this.events, currentSignals: peak })
    return {
      risk_score: risk.score,
      risk_level: risk.level,
      breakdown: risk.breakdown,
      counts: this.counts,
      proctoring_status: this.status,
      event_count: this.events.length,
    }
  }

  stop() {
    clearInterval(this.timer)
    document.removeEventListener('visibilitychange', this._onVis)
    try { this.detector && this.detector.release() } catch (e) { /* ignore */ }
  }
}
