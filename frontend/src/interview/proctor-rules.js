/**
 * Pure, timestamp-driven proctoring rules (no DOM, no models) so the
 * debouncing / corroboration logic is unit-testable with fake detectors.
 *
 * Feed it observations as they arrive:
 *   rules.face(t, faceCount)
 *   rules.pose(t, { yaw, pitch, gazeX, gazeY, nose:{x,y}, ear })   (null = no landmarks this frame)
 *   rules.objects(t, [{label, score}])
 *   rules.light(t, brightness /* 0..1 *\/)
 *   rules.browser(t, type, details)  // tab_switched | window_blur | fullscreen_exit | paste_detected | copy_detected | context_menu | devtools_suspected | camera_off
 * and it calls onEvent({ type, severity, ts, details, corroborated }) when
 * a condition is confirmed. Normal glances never fire: every visual
 * condition must persist for a sustained window, objects need 2 hits out of
 * the last 3 detections, and gaze is judged relative to a per-candidate
 * baseline calibrated in the first seconds.
 */

export const THRESHOLDS = {
  calibrationMs: 8000,      // gaze/head baseline from the first 8 s with a face
  calibrationMin: 4,        // …and at least 4 pose samples
  noFaceMs: 5000,           // face out of frame ≥ 5 s → face_left_frame (medium)
  absentMs: 20000,          // ≥ 20 s → person_absent (high)
  multiFaceMs: 2000,        // ≥ 2 faces for ≥ 2 s (≥ 2 samples) → multiple_faces (high)
  lookAwayMs: 6000,         // head turned / eyes off-screen ≥ 6 s → looking_away
  lookDownMs: 8000,         // head down ≥ 8 s (not while typing) → looking_down
  yawDeg: 28,               // |Δyaw| from baseline
  pitchUpDeg: 22,           // looking up (Δpitch < -22)
  pitchDownDeg: 18,         // looking down (Δpitch > 18)
  gazeX: 0.6,               // |Δ iris offset| (−1..1)
  repeatWindowMs: 5 * 60000,
  repeatCount: 3,           // 3rd look-away within 5 min → medium (repeated_off_screen)
  clearSamples: 2,          // condition must be false for 2 samples to end an episode
  objectWindow: 3,          // last N object detections
  objectHits: 2,            // …of which ≥ 2 must contain the object
  phoneScore: 0.5,
  bookScore: 0.55,
  screenScore: 0.6,
  personScore: 0.6,
  coveredBrightness: 0.07,  // mean luma < 7 % for ≥ 4 s → camera_covered
  coveredMs: 4000,
  darkBrightness: 0.15,     // < 15 % for ≥ 10 s → low_light (low, no snapshot)
  darkMs: 10000,
  spoofWindowMs: 45000,     // static-photo heuristic over 45 s
  spoofMinSamples: 25,
  spoofNoseStd: 0.0012,
  spoofYawStd: 0.6,
  spoofEarRange: 0.03,
  spoofCooldownMs: 3 * 60000,
  blurMinMs: 3000,          // window blur (no tab switch) counts as medium only after 3 s
  corroborateMs: 30000,     // distinct concern within ±30 s → corroborated
}

const CONCERN_TYPES = new Set([
  'face_left_frame', 'person_absent', 'multiple_faces', 'extra_person', 'looking_away', 'looking_down',
  'phone_detected', 'book_detected', 'second_screen', 'tab_switched', 'window_blur', 'fullscreen_exit',
  'paste_detected', 'camera_covered', 'spoof_suspected', 'camera_off',
])

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
function std(arr) {
  if (arr.length < 2) return 0
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)
}

/** A sustained condition: starts when first true, confirmed after `ms`, ends after N false samples. */
class Episode {
  constructor(ms, minSamples = 1) {
    this.ms = ms
    this.minSamples = minSamples
    this.reset()
  }
  reset() { this.since = null; this.samples = 0; this.fired = false; this.falseRun = 0 }
  /** Returns true exactly once per episode, when the condition is confirmed. */
  update(t, on, clearSamples) {
    if (on) {
      this.falseRun = 0
      if (this.since == null) this.since = t
      this.samples += 1
      if (!this.fired && t - this.since >= this.ms && this.samples >= this.minSamples) {
        this.fired = true
        return true
      }
      return false
    }
    this.falseRun += 1
    if (this.since != null && this.falseRun >= clearSamples) this.reset()
    return false
  }
}

export class ProctorRules {
  constructor({ onEvent = () => {}, thresholds = {} } = {}) {
    this.T = { ...THRESHOLDS, ...thresholds }
    this.onEvent = onEvent
    this.events = []
    this.counts = {}
    this.typing = false
    this.hidden = false
    const T = this.T
    this.ep = {
      noFace: new Episode(T.noFaceMs),
      absent: new Episode(T.absentMs),
      multi: new Episode(T.multiFaceMs, 2),
      away: new Episode(T.lookAwayMs),
      down: new Episode(T.lookDownMs),
      covered: new Episode(T.coveredMs),
      dark: new Episode(T.darkMs),
    }
    this.calib = { start: null, yaw: [], pitch: [], gaze: [], done: false, yaw0: 0, pitch0: 0, gaze0: 0 }
    this.objHist = []
    this.objFired = {}
    this.spoofHist = []
    this.lastSpoof = -Infinity
    this.blurAt = null
  }

  get baseline() {
    const c = this.calib
    return c.done ? { yaw: c.yaw0, pitch: c.pitch0, gazeX: c.gaze0 } : null
  }

  setTyping(on) { this.typing = !!on; if (on) this.ep.down.reset() }

  setHidden(on) {
    this.hidden = !!on
    // Visual episodes don't continue across a tab switch (frames are stale).
    if (on) Object.values(this.ep).forEach((e) => e.reset())
  }

  _emit(t, type, severity, details = {}) {
    const ev = { type, severity, ts: t, details, corroborated: false }
    if (CONCERN_TYPES.has(type)) {
      for (const other of this.events) {
        if (other.type !== type && CONCERN_TYPES.has(other.type) && Math.abs(other.ts - t) <= this.T.corroborateMs) {
          ev.corroborated = true
          other.corroborated = true
        }
      }
    }
    this.events.push(ev)
    this.counts[type] = (this.counts[type] || 0) + 1
    this.onEvent(ev)
    return ev
  }

  recent(type, t, windowMs) {
    return this.events.filter((e) => e.type === type && t - e.ts <= windowMs)
  }

  face(t, faceCount) {
    if (this.hidden || faceCount == null) return
    const T = this.T
    if (this.ep.noFace.update(t, faceCount === 0, T.clearSamples)) this._emit(t, 'face_left_frame', 'medium', { seconds: Math.round(T.noFaceMs / 1000) })
    if (this.ep.absent.update(t, faceCount === 0, T.clearSamples)) this._emit(t, 'person_absent', 'high', { seconds: Math.round(T.absentMs / 1000) })
    if (this.ep.multi.update(t, faceCount >= 2, T.clearSamples)) this._emit(t, 'multiple_faces', 'high', { faces: faceCount })
    if (faceCount === 0) { this.ep.away.reset(); this.ep.down.reset() }
  }

  pose(t, p) {
    if (this.hidden) return
    const T = this.T
    const c = this.calib
    if (!p || p.yaw == null) {
      this.ep.away.update(t, false, T.clearSamples)
      this.ep.down.update(t, false, T.clearSamples)
      return
    }
    // Spoof (static photo) history — face landmarks that never move at all.
    if (p.nose) {
      this.spoofHist.push({ t, x: p.nose.x, y: p.nose.y, yaw: p.yaw, ear: p.ear ?? null })
      this.spoofHist = this.spoofHist.filter((h) => t - h.t <= T.spoofWindowMs)
      this._checkSpoof(t)
    }
    if (!c.done) {
      if (c.start == null) c.start = t
      // Only calibrate on plausible frontal poses (someone glancing away at start
      // shouldn't become "normal").
      if (Math.abs(p.yaw) < 35 && Math.abs(p.pitch) < 35) {
        c.yaw.push(p.yaw); c.pitch.push(p.pitch); c.gaze.push(p.gazeX || 0)
      }
      if (t - c.start >= T.calibrationMs && c.yaw.length >= T.calibrationMin) {
        c.done = true
        c.yaw0 = median(c.yaw); c.pitch0 = median(c.pitch); c.gaze0 = median(c.gaze)
      }
      return
    }
    const dyaw = p.yaw - c.yaw0
    const dpitch = p.pitch - c.pitch0
    const dgaze = (p.gazeX || 0) - c.gaze0
    const turned = Math.abs(dyaw) > T.yawDeg || dpitch < -T.pitchUpDeg || Math.abs(dgaze) > T.gazeX
    const down = !this.typing && dpitch > T.pitchDownDeg && !turned
    // Slow drift of the baseline while the candidate looks at the screen (posture changes).
    if (!turned && !down && Math.abs(dyaw) < T.yawDeg / 2 && Math.abs(dpitch) < T.pitchDownDeg / 2) {
      c.yaw0 += 0.02 * dyaw; c.pitch0 += 0.02 * dpitch; c.gaze0 += 0.02 * dgaze
    }
    if (this.ep.away.update(t, turned, T.clearSamples)) {
      const repeated = this.recent('looking_away', t, T.repeatWindowMs).length + 1 >= T.repeatCount
      const phoneNearby = this.recent('phone_detected', t, T.corroborateMs).length > 0
      this._emit(t, 'looking_away', repeated || phoneNearby ? 'medium' : 'low', {
        yaw: Math.round(dyaw), pitch: Math.round(dpitch), repeated,
      })
    }
    if (this.ep.down.update(t, down, T.clearSamples)) {
      const repeated = this.recent('looking_down', t, T.repeatWindowMs).length + 1 >= T.repeatCount
      this._emit(t, 'looking_down', repeated ? 'medium' : 'low', { pitch: Math.round(dpitch), repeated })
    }
  }

  _checkSpoof(t) {
    const T = this.T
    const h = this.spoofHist
    if (h.length < T.spoofMinSamples || t - h[0].t < T.spoofWindowMs * 0.9) return
    if (t - this.lastSpoof < T.spoofCooldownMs) return
    const noseStd = Math.max(std(h.map((x) => x.x)), std(h.map((x) => x.y)))
    const yawStd = std(h.map((x) => x.yaw))
    const ears = h.map((x) => x.ear).filter((x) => x != null)
    const earRange = ears.length ? Math.max(...ears) - Math.min(...ears) : 1
    if (noseStd < T.spoofNoseStd && yawStd < T.spoofYawStd && earRange < T.spoofEarRange) {
      this.lastSpoof = t
      this._emit(t, 'spoof_suspected', 'medium', { nose_std: Number(noseStd.toFixed(5)), window_s: Math.round(T.spoofWindowMs / 1000) })
    }
  }

  objects(t, list) {
    if (this.hidden || !Array.isArray(list)) return
    const T = this.T
    const has = (labels, min) => list.some((o) => labels.includes(o.label) && (o.score ?? 0) >= min)
    const persons = list.filter((o) => o.label === 'person' && (o.score ?? 0) >= T.personScore).length
    this.objHist.push({
      t,
      phone: has(['cell phone', 'mobile phone'], T.phoneScore),
      book: has(['book'], T.bookScore),
      screen: has(['laptop', 'tv', 'monitor'], T.screenScore),
      person: persons >= 2,
    })
    if (this.objHist.length > T.objectWindow) this.objHist.shift()
    const map = { phone: ['phone_detected', 'high'], book: ['book_detected', 'medium'], screen: ['second_screen', 'medium'], person: ['extra_person', 'high'] }
    for (const [k, [type, sev]] of Object.entries(map)) {
      const hits = this.objHist.filter((o) => o[k]).length
      if (hits >= T.objectHits) {
        if (!this.objFired[k]) {
          this.objFired[k] = true
          this._emit(t, type, sev, { hits, of: this.objHist.length })
        }
      } else if (hits === 0) {
        this.objFired[k] = false // object gone for a full window → a new episode can fire
      }
    }
  }

  light(t, brightness) {
    if (this.hidden || brightness == null) return
    const T = this.T
    if (this.ep.covered.update(t, brightness < T.coveredBrightness, T.clearSamples)) this._emit(t, 'camera_covered', 'medium', { brightness: Number(brightness.toFixed(3)) })
    if (this.ep.dark.update(t, brightness < T.darkBrightness, T.clearSamples)) this._emit(t, 'low_light', 'low', { brightness: Number(brightness.toFixed(3)) })
  }

  browser(t, type, details = {}) {
    const T = this.T
    switch (type) {
      case 'hidden':
        this.blurAt = null
        this.lastHidden = t
        this.setHidden(true)
        return this._emit(t, 'tab_switched', 'medium', details)
      case 'visible':
        this.setHidden(false)
        return null
      case 'blur':
        this.blurAt = t
        return null
      case 'focus': {
        const was = this.blurAt
        this.blurAt = null
        if (was == null || this.hidden) return null
        if (this.lastHidden != null && this.lastHidden >= was - 1000) return null // already counted as a tab switch
        const ms = t - was
        if (ms < 800) return null
        // Focus moved to another window/app without hiding the tab (second monitor, overlay app).
        return this._emit(t, 'window_blur', ms >= T.blurMinMs ? 'medium' : 'low', { away_ms: ms, ...details })
      }
      case 'fullscreen_exit':
        return this._emit(t, 'fullscreen_exit', 'medium', details)
      case 'paste':
        return this._emit(t, 'paste_detected', (details.chars || 0) >= 20 ? 'medium' : 'low', details)
      case 'copy':
        return this._emit(t, 'copy_detected', 'low', details)
      case 'contextmenu':
        return this._emit(t, 'context_menu', 'low', details)
      case 'devtools':
        return this._emit(t, 'devtools_suspected', 'low', details)
      case 'camera_off':
        return this._emit(t, 'camera_off', 'medium', details)
      default:
        return null
    }
  }

  /** Peak signals for the risk engine — fair: single glances / one tab switch don't count. */
  signals({ faceOk = true, lightOk = true } = {}) {
    const n = (k) => this.counts[k] || 0
    const tabLike = n('tab_switched') + n('fullscreen_exit') + this.events.filter((e) => e.type === 'window_blur' && e.severity === 'medium').length
    return {
      phoneDetected: n('phone_detected') > 0,
      multipleFaces: n('multiple_faces') + n('extra_person') > 0,
      spoofSuspected: n('spoof_suspected') > 0,
      faceLeftFrame: n('face_left_frame') > 1,
      personAbsent: n('person_absent') > 0,
      repeatedOffScreenGaze: n('looking_away') >= this.T.repeatCount,
      longDownwardGaze: n('looking_down') >= 2,
      tabSwitched: tabLike > 1,
      pasteDetected: this.events.some((e) => e.type === 'paste_detected' && e.severity === 'medium'),
      secondScreen: n('second_screen') > 0,
      bookDetected: n('book_detected') > 0,
      darkLighting: n('camera_covered') > 0,
      continuousFaceVisible: faceOk && n('face_left_frame') === 0 && n('person_absent') === 0,
      goodLighting: lightOk && n('camera_covered') === 0 && n('low_light') === 0,
    }
  }
}

/** Per-type cooldown + session cap for evidence snapshots. */
export class SnapshotGate {
  constructor({ cooldownMs = 20000, cap = 30 } = {}) {
    this.cooldownMs = cooldownMs
    this.cap = cap
    this.taken = 0
    this.last = {}
  }
  allow(ev, t = ev.ts) {
    if (!ev || (ev.severity !== 'medium' && ev.severity !== 'high')) return false
    if (this.taken >= this.cap) return false
    if (this.last[ev.type] != null && t - this.last[ev.type] < this.cooldownMs) return false
    this.last[ev.type] = t
    this.taken += 1
    return true
  }
}

/** Adaptive scheduler for one detector: backs off when a detection is slow, disables if very slow. */
export class DetectorPacer {
  constructor({ baseMs, budgetMs, maxFactor = 4, killMs = 600, killAfter = 3 }) {
    this.baseMs = baseMs
    this.budgetMs = budgetMs
    this.maxFactor = maxFactor
    this.killMs = killMs
    this.killAfter = killAfter
    this.factor = 1
    this.ema = null
    this.slowRuns = 0
    this.disabled = false
    this.nextAt = 0
  }
  get intervalMs() { return this.baseMs * this.factor }
  due(t) { return !this.disabled && t >= this.nextAt }
  record(t, tookMs) {
    this.ema = this.ema == null ? tookMs : this.ema * 0.7 + tookMs * 0.3
    if (tookMs > this.killMs) this.slowRuns += 1
    if (this.slowRuns >= this.killAfter) this.disabled = true
    if (this.ema > this.budgetMs && this.factor < this.maxFactor) this.factor = Math.min(this.maxFactor, this.factor * 2)
    else if (this.ema < this.budgetMs / 2 && this.factor > 1) this.factor = Math.max(1, this.factor / 2)
    this.nextAt = t + this.intervalMs
  }
}

export const EVENT_LABELS = {
  baseline: 'Identity (start)',
  face_left_frame: 'Face not visible',
  person_absent: 'Candidate absent',
  multiple_faces: 'Multiple faces',
  extra_person: 'Another person in view',
  looking_away: 'Looking away',
  looking_down: 'Looking down',
  phone_detected: 'Phone detected',
  book_detected: 'Book / notes detected',
  second_screen: 'Second screen detected',
  tab_switched: 'Tab switched',
  window_blur: 'Left interview window',
  fullscreen_exit: 'Exited full screen',
  paste_detected: 'Pasted into answer',
  copy_detected: 'Copied text',
  context_menu: 'Right-click',
  devtools_suspected: 'Window resized (dev tools?)',
  camera_covered: 'Camera covered / dark',
  low_light: 'Low light',
  spoof_suspected: 'Possible photo / spoof',
  camera_off: 'Camera turned off',
}
