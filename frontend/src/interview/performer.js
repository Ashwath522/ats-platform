/**
 * AriaPerformer — turns "what is happening" (speaking this sentence, waiting
 * for the LLM, the candidate is talking…) into a pose for every animation
 * frame: mouth shape, jaw, head, eyes, brows, torso and two IK arms.
 *
 * The SVG component calls `frame(now)` from requestAnimationFrame and writes
 * the numbers straight into SVG attributes (no React re-render per frame).
 * Everything is smoothed with exponential springs, so nothing pops.
 */
import { LipSync, SHAPES } from './visemes.js'
import { planGestures, armSegments, Backchannel } from './gestures.js'

// ── Rig (SVG viewBox 0 0 240 270) ─────────────────────────────────────────────
export const RIG = {
  W: 240,
  H: 270,
  head: { x: 20, y: -2 }, // head is drawn in its original 200×200 coordinates, offset by this
  neck: { x: 120, y: 152 },
  // R = Aria's right arm (screen left), L = her left arm (screen right)
  shoulder: { R: { x: 80, y: 182 }, L: { x: 160, y: 182 } },
  L1: 62, // max upper-arm length (shorter = pointing toward the camera)
  L2: 80, // max forearm length
}

// Each pose: elbow point, hand point, hand rotation relative to the forearm.
const POSES = {
  rest: { R: { ex: 69, ey: 238, x: 101, y: 252, o: -12 }, L: { ex: 171, ey: 238, x: 139, y: 252, o: 12 } },
  ready: { R: { ex: 67, ey: 236, x: 93, y: 229, o: -6 }, L: { ex: 173, ey: 236, x: 147, y: 230, o: 6 } },
  palm: { R: { ex: 60, ey: 238, x: 58, y: 216, o: -58 }, L: { ex: 180, ey: 238, x: 182, y: 218, o: 58 } },
  count: { L: { ex: 177, ey: 237, x: 166, y: 191, o: -4 } },
  chin: { R: { ex: 102, ey: 232, x: 116, y: 163, o: 8 } },
}

const FINGERS = {
  relaxed: [0.55, 0.5, 0.45, 0.45, 0.6],
  open: [1, 1, 1, 0.95, 1],
  fist: [0.32, 0.3, 0.3, 0.3, 0.55],
  chin: [0.75, 0.32, 0.3, 0.3, 0.5],
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const lerp = (a, b, k) => a + (b - a) * k
const ss = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }
const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1, tau)))

function envelope(t, g, rise = 220, fall = 300) {
  if (t < g.t || t > g.t + g.d) return 0
  return Math.min(ss((t - g.t) / rise), ss((g.t + g.d - t) / fall))
}

export function countFingers(n) {
  // index, middle, ring, pinky, thumb
  const out = [0.3, 0.3, 0.3, 0.3, 0.45]
  for (let i = 0; i < Math.min(5, n); i++) out[i] = 1
  return out
}

export class AriaPerformer {
  constructor({ reducedMotion = false, expressive = true, rng = Math.random, getLevel = null } = {}) {
    this.rng = rng
    this.reducedMotion = reducedMotion
    this.expressive = expressive
    this.getLevel = getLevel
    this.lip = new LipSync()
    this.mode = 'idle'
    this.speaking = false
    this.meta = {}
    this.gestures = []
    this.turnState = {}
    this.listenEvents = []
    this.bc = new Backchannel({ rng })
    this.heardWords = 0
    this.last = null
    this.endedAt = null
    this.endPlayhead = 0
    this.baseSmile = 0
    this._nextBlink = 0
    this._blinkStart = -1
    this._doubleBlink = false
    this._nextSaccade = 0
    this._gaze = { x: 0, y: 0 }
    this.hold = null // optional fixed mouth shape (e.g. 'smile' on the welcome card)
    const rest = POSES.rest
    this.s = {
      mouth: { ...SHAPES.rest, smile: 0.1 },
      head: { x: 0, y: 0, roll: 0, nod: 0, yaw: 0 },
      body: { lean: 0, breath: 0, sway: 0 },
      brows: { l: 0, r: 0, furrow: 0 },
      eyes: { x: 0, y: 0, blink: 0 },
      hands: {
        R: { ...rest.R, f: [...FINGERS.relaxed] },
        L: { ...rest.L, f: [...FINGERS.relaxed] },
      },
    }
  }

  // ── inputs ────────────────────────────────────────────────────────────────
  setMode(mode) {
    if (mode === this.mode) return
    if (mode === 'listening') {
      this.bc.reset(performance.now())
      this.heardWords = 0
    }
    if (mode !== 'speaking' && this.mode === 'speaking') this.turnState = {}
    this.mode = mode
  }

  setExpressive(v) { this.expressive = !!v }
  setReducedMotion(v) { this.reducedMotion = !!v }
  newTurn() { this.turnState = {} }

  utterStart(text, meta = {}, now = performance.now(), { rate = 1, native = false } = {}) {
    this.speaking = true
    this.meta = meta || {}
    this.endedAt = null
    this.lip.start(text, now, { rate, native })
    const g = this.expressive ? planGestures(this.lip.tl, text, this.turnState) : []
    if (this.meta.filler && !this.meta.thinking) {
      // an acknowledgement: small nod + warmth, no big hand gestures
      this.gestures = [{ type: 'nod', t: 0, d: 520, amt: 0.9 }]
      this.smileBoost = { t0: now, d: 1400, amt: 0.35 }
    } else if (this.meta.thinking) {
      this.gestures = []
    } else {
      this.gestures = g
    }
    // occasionally glance away briefly at the start of a sentence, like people do
    if (!this.meta.filler && this.rng() < 0.3) this._glance = { t0: now, d: 380 + this.rng() * 300, x: (this.rng() < 0.5 ? -1 : 1) * 2.2, y: -1.4 }
  }

  boundary(charIndex, now = performance.now()) {
    this.lip.boundary(charIndex, now)
  }

  utterEnd(now = performance.now()) {
    this.endPlayhead = this.lip.tl ? this.lip.playhead(now) : 0
    this.lip.end(now)
    this.speaking = false
    this.endedAt = now
  }

  stopSpeaking(now = performance.now()) {
    this.lip.stop()
    this.speaking = false
    this.endedAt = now
    this.gestures = []
  }

  /** Candidate speech progress (STT interim text or typed text). */
  heard(text) {
    this.heardWords = (String(text || '').trim().match(/\S+/g) || []).length
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  _gestureTime(now) {
    if (this.speaking && this.lip.tl) return this.lip.playhead(now)
    if (this.endedAt != null) return this.endPlayhead + (now - this.endedAt)
    return -1
  }

  frame(now = performance.now()) {
    const dt = this.last == null ? 16 : clamp(now - this.last, 1, 80)
    this.last = now
    const s = this.s
    const rm = this.reducedMotion
    const amp = rm ? 0.35 : 1
    const ex = this.expressive
    const thinkingBody = (this.mode === 'thinking' && !this.speaking) || (this.speaking && this.meta.thinking)
    const listening = this.mode === 'listening' && !this.speaking
    const sec = now / 1000

    // ── gestures from the speech timeline
    const gt = this._gestureTime(now)
    let palm = 0
    let count = 0
    let countN = 0
    let brow = 0
    let nod = 0
    const beat = { R: 0, L: 0 }
    if (gt >= 0 && ex) {
      for (const g of this.gestures) {
        if (gt < g.t - 50 || gt > g.t + g.d + 50) continue
        if (g.type === 'palm') palm = Math.max(palm, envelope(gt, g, 260, 320))
        else if (g.type === 'count') {
          const e = envelope(gt, g, 200, 260)
          if (e > count) { count = e; countN = g.n }
        } else if (g.type === 'brow') brow = Math.max(brow, envelope(gt, g, 180, 300))
        else if (g.type === 'nod') nod += Math.sin(Math.PI * clamp((gt - g.t) / g.d, 0, 1)) * (g.amt || 0.6)
        else if (g.type === 'beat') {
          const k = clamp((gt - g.t) / g.d, 0, 1)
          beat[g.hand || 'R'] = Math.max(beat[g.hand || 'R'], Math.sin(Math.PI * k))
        }
      }
    }
    if (rm) { beat.R = 0; beat.L = 0 }

    // ── listening backchannel (visual only)
    if (listening && ex) {
      const level = this.getLevel ? this.getLevel() : 0
      for (const e of this.bc.update(now, { level, words: this.heardWords })) this.listenEvents.push({ ...e, t0: now })
    }
    this.listenEvents = this.listenEvents.filter((e) => now - e.t0 < e.d)
    let mm = 0
    let lsmile = 0
    for (const e of this.listenEvents) {
      const k = (now - e.t0) / e.d
      if (e.type === 'nod') nod += Math.sin(Math.PI * k) * (e.amt || 1)
      if (e.type === 'mm') mm = Math.max(mm, Math.sin(Math.PI * k))
      if (e.type === 'smile') lsmile = Math.max(lsmile, Math.sin(Math.PI * k))
    }

    // ── mouth
    let mouthT
    if (this.hold && !this.speaking) mouthT = { ...SHAPES.rest, ...(this.hold === 'smile' ? { open: 0.1, wide: 1.12, teeth: 0.6 } : {}) }
    else if (this.speaking || (this.lip.tl && this.endedAt && now - this.endedAt < 200)) mouthT = this.lip.sample(now)
    else if (thinkingBody) mouthT = { ...SHAPES.MBP, press: 0.55, wide: 0.9 }
    else mouthT = { ...SHAPES.rest }
    if (mm > 0) mouthT = { ...mouthT, press: Math.max(mouthT.press, mm), open: mouthT.open * (1 - mm), wide: lerp(mouthT.wide, 1.08, mm) }
    let smileT = this.hold === 'smile' ? 0.9 : listening ? 0.2 + 0.5 * lsmile + 0.15 * mm : thinkingBody ? 0.05 : this.speaking ? 0.18 : 0.15
    if (this.smileBoost && now - this.smileBoost.t0 < this.smileBoost.d) smileT += this.smileBoost.amt * Math.sin(Math.PI * (now - this.smileBoost.t0) / this.smileBoost.d)
    for (const k of Object.keys(mouthT)) s.mouth[k] = approach(s.mouth[k] ?? 0, mouthT[k], dt, k === 'open' ? 38 : 52)
    s.mouth.smile = approach(s.mouth.smile, clamp(smileT, 0, 1), dt, 220)

    // ── head / body
    const swayA = (Math.sin(sec * 0.9) * 0.6 + Math.sin(sec * 0.37 + 1.3) * 0.5) * amp
    const talkMove = this.speaking && !rm ? Math.sin(sec * 2.3) * 0.7 + Math.sin(sec * 3.7 + 0.6) * 0.35 : 0
    const rollT = (thinkingBody ? 5 : listening ? 2.2 : 0) * (ex ? 1 : 0.5) + swayA + talkMove * 0.8
    const yawT = (thinkingBody ? -0.7 : 0) + Math.sin(sec * 0.5 + 0.4) * 0.25 * amp + talkMove * 0.25
    s.head.roll = approach(s.head.roll, rollT, dt, 260)
    s.head.yaw = approach(s.head.yaw, yawT, dt, 300)
    s.head.nod = approach(s.head.nod, clamp(nod, -1.5, 1.6) * amp, dt, 70)
    s.head.y = approach(s.head.y, Math.sin(sec * 1.6) * 0.4 * amp, dt, 200)
    s.body.breath = Math.sin(sec * (2 * Math.PI / 4.2)) * amp
    s.body.lean = approach(s.body.lean, listening && ex ? 1 : this.speaking ? 0.35 : 0, dt, 600)
    s.body.sway = approach(s.body.sway, Math.sin(sec * 0.45) * 0.5 * amp, dt, 400)

    // ── brows
    const raise = Math.max(brow, this.speaking && this.meta.filler ? 0.25 : 0) + (listening ? 0.15 : 0)
    s.brows.l = approach(s.brows.l, raise + (thinkingBody ? 0.55 : 0), dt, 120)
    s.brows.r = approach(s.brows.r, raise + (thinkingBody ? -0.1 : 0), dt, 120)
    s.brows.furrow = approach(s.brows.furrow, thinkingBody ? 0.6 : 0, dt, 200)

    // ── eyes: blinks + saccades
    if (now >= this._nextBlink) {
      this._blinkStart = now
      this._doubleBlink = this.rng() < 0.15
      this._nextBlink = now + 2400 + this.rng() * 3200
    }
    const bt = now - this._blinkStart
    let blink = 0
    if (bt >= 0 && bt < 150) blink = Math.sin(Math.PI * bt / 150)
    else if (this._doubleBlink && bt >= 230 && bt < 380) blink = Math.sin(Math.PI * (bt - 230) / 150)
    s.eyes.blink = blink
    if (now >= this._nextSaccade) {
      const spread = thinkingBody ? 0.8 : this.speaking ? 0.7 : 1.4
      this._gaze = { x: (this.rng() * 2 - 1) * spread, y: (this.rng() * 2 - 1) * spread * 0.6 }
      this._nextSaccade = now + (thinkingBody ? 900 : 600) + this.rng() * 1800
    }
    let gx = this._gaze.x
    let gy = this._gaze.y
    if (thinkingBody) { gx += -2.3; gy += -2.4 }
    if (this._glance && now - this._glance.t0 < this._glance.d) { gx += this._glance.x; gy += this._glance.y }
    s.eyes.x = approach(s.eyes.x, clamp(gx, -3, 3), dt, 28)
    s.eyes.y = approach(s.eyes.y, clamp(gy, -3, 2.5), dt, 28)

    // ── arms
    const base = this.speaking && !thinkingBody && ex ? POSES.ready : POSES.rest
    let R = { ...base.R }
    let L = { ...base.L }
    let fR = this.speaking && ex ? FINGERS.relaxed.map((x) => x + 0.12) : FINGERS.relaxed
    let fL = fR
    if (thinkingBody && ex) {
      R = { ...POSES.chin.R }
      fR = FINGERS.chin
      // the other hand supports the raised elbow
      const e = s.hands.R
      L = { ex: 168, ey: 240, x: e.ex + 7, y: e.ey + 7, o: 70 }
      fL = FINGERS.relaxed
    }
    if (palm > 0) {
      const pa = rm ? 0.4 : 1
      R = mixPose(R, POSES.palm.R, palm * pa)
      L = mixPose(L, POSES.palm.L, palm * 0.75 * pa)
      fR = mixArr(fR, FINGERS.open, palm)
      fL = mixArr(fL, FINGERS.open, palm * 0.8)
    }
    if (count > 0) {
      L = mixPose(L, POSES.count.L, count * (rm ? 0.5 : 1))
      fL = mixArr(fL, countFingers(countN), count)
    }
    for (const side of ['R', 'L']) {
      const b = beat[side]
      if (b > 0) {
        const tgt = side === 'R' ? R : L
        tgt.y += 8 * b
        tgt.x += (side === 'R' ? -2 : 2) * b
        tgt.ey += 2 * b
        tgt.o += (side === 'R' ? 12 : -12) * b
        if (side === 'R') fR = mixArr(fR, FINGERS.open, 0.5 * b)
        else fL = mixArr(fL, FINGERS.open, 0.5 * b)
      }
    }
    // breathing lifts the arms slightly too
    R.y -= s.body.breath * 0.6
    L.y -= s.body.breath * 0.6
    const handTau = thinkingBody ? 260 : beat.R || beat.L ? 70 : 170
    for (const [side, tgt, f] of [['R', R, fR], ['L', L, fL]]) {
      const h = s.hands[side]
      for (const k of ['x', 'y', 'ex', 'ey']) h[k] = approach(h[k], tgt[k], dt, handTau)
      h.o = approach(h.o, tgt.o, dt, handTau + 30)
      for (let i = 0; i < 5; i++) h.f[i] = approach(h.f[i], f[i], dt, 90)
    }
    return this.pose()
  }

  pose() {
    const s = this.s
    const arms = {}
    for (const side of ['R', 'L']) {
      const h = s.hands[side]
      const seg = armSegments(RIG.shoulder[side], { x: h.ex, y: h.ey }, h, { L1: RIG.L1, L2: RIG.L2 })
      // a foreshortened forearm (pointing at the camera) shows a slightly bigger hand
      arms[side] = { ...seg, ha: h.o, hs: 1 + 0.18 * (1 - Math.min(1, seg.len2 / 60)), f: h.f }
    }
    return { mouth: s.mouth, head: s.head, body: s.body, brows: s.brows, eyes: s.eyes, arms }
  }
}

function mixPose(a, b, k) {
  const out = {}
  for (const key of ['x', 'y', 'ex', 'ey', 'o']) out[key] = lerp(a[key], b[key], k)
  return out
}
function mixArr(a, b, k) {
  return a.map((x, i) => lerp(x, b[i], k))
}
