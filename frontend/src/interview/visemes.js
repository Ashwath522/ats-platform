/**
 * Text → viseme lip sync for Aria.
 *
 *  - `wordVisemes(word)`: rough English grapheme → viseme mapping (digraphs,
 *    silent final "e", doubled letters collapsed). Good enough for a stylised
 *    2D mouth — we only need the *shape* of speech, not phonetics.
 *  - `buildTimeline(text, {rate})`: per-viseme start/duration (ms) for a whole
 *    utterance, with word records (char ranges) and rest pauses on punctuation.
 *  - `LipSync`: plays a timeline against the clock. Web Speech `boundary`
 *    events re-anchor the playhead to the spoken word and adapt the speed;
 *    without boundaries (native Capacitor TTS, some network voices) it runs on
 *    the estimate and calibrates its speed from the real start/end callbacks.
 *  - `sampleMouth(...)` returns blended mouth parameters with co-articulation.
 *
 * Pure JS (no DOM) so it is unit-testable and cheap to run every frame.
 */

export const VISEMES = ['rest', 'MBP', 'FV', 'TH', 'L', 'WQ', 'U', 'O', 'AI', 'E', 'etc']

/** Mouth parameters per viseme. open: jaw/lip opening 0..1, wide: width factor,
 *  round: lip rounding, teeth: upper-teeth visibility, tongue, press: lips
 *  pressed together, lowerIn: lower lip tucked under the teeth (f/v). */
export const SHAPES = {
  rest: { open: 0, wide: 1, round: 0, teeth: 0, tongue: 0, press: 0, lowerIn: 0 },
  MBP: { open: 0, wide: 0.96, round: 0, teeth: 0, tongue: 0, press: 1, lowerIn: 0 },
  FV: { open: 0.13, wide: 1.02, round: 0, teeth: 1, tongue: 0, press: 0, lowerIn: 1 },
  TH: { open: 0.22, wide: 1, round: 0, teeth: 0.8, tongue: 1, press: 0, lowerIn: 0 },
  L: { open: 0.36, wide: 1, round: 0, teeth: 0.5, tongue: 0.85, press: 0, lowerIn: 0 },
  WQ: { open: 0.16, wide: 0.62, round: 1, teeth: 0, tongue: 0, press: 0, lowerIn: 0 },
  U: { open: 0.26, wide: 0.7, round: 0.85, teeth: 0, tongue: 0, press: 0, lowerIn: 0 },
  O: { open: 0.56, wide: 0.8, round: 0.7, teeth: 0, tongue: 0.2, press: 0, lowerIn: 0 },
  AI: { open: 0.86, wide: 1.06, round: 0, teeth: 0.35, tongue: 0.3, press: 0, lowerIn: 0 },
  E: { open: 0.42, wide: 1.2, round: 0, teeth: 0.75, tongue: 0.2, press: 0, lowerIn: 0 },
  etc: { open: 0.24, wide: 1.05, round: 0, teeth: 0.6, tongue: 0.3, press: 0, lowerIn: 0 },
}
export const SHAPE_KEYS = Object.keys(SHAPES.rest)

const VOWELS = new Set(['AI', 'E', 'O', 'U'])
// Relative duration units (1 unit ≈ 62 ms at rate 1.0)
const WEIGHT = { AI: 1.4, E: 1.3, O: 1.4, U: 1.3, WQ: 1.0, MBP: 0.95, FV: 0.9, TH: 0.9, L: 0.85, etc: 0.8, rest: 1 }
export const UNIT_MS = 62

const DIGRAPHS = [
  ['tch', ['etc']], ['igh', ['AI']], ['augh', ['O']], ['ough', ['O']],
  ['th', ['TH']], ['sh', ['etc']], ['ch', ['etc']], ['ph', ['FV']], ['wh', ['WQ']], ['qu', ['etc', 'WQ']],
  ['ck', ['etc']], ['ng', ['etc']], ['gh', []], ['ee', ['E']], ['ea', ['E']], ['ie', ['E']], ['ey', ['E']],
  ['oo', ['U']], ['ou', ['AI', 'WQ']], ['ow', ['O', 'WQ']], ['oi', ['O', 'E']], ['oy', ['O', 'E']],
  ['ai', ['E']], ['ay', ['E']], ['ei', ['E']], ['au', ['O']], ['aw', ['O']], ['ew', ['U']], ['ue', ['U']],
]
const SINGLE = {
  a: 'AI', e: 'E', i: 'E', o: 'O', u: 'U', y: 'E',
  b: 'MBP', m: 'MBP', p: 'MBP', f: 'FV', v: 'FV', l: 'L', w: 'WQ', r: 'etc',
}
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Map one word to a viseme sequence. */
export function wordVisemes(word) {
  let w = String(word || '').toLowerCase().replace(/[’']/g, '')
  if (/\d/.test(w)) w = w.replace(/\d/g, (d) => ` ${DIGIT_WORDS[+d]} `).replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '')
  w = w.replace(/[^a-z]/g, '')
  if (!w) return []
  if (w === 'i') return ['AI']
  if (w === 'a') return ['AI']
  // silent final e ("make", "store") — but keep it for short words ("be", "he", "the")
  if (w.length > 3 && w.endsWith('e') && !/[aeiouy]e$/.test(w) && !w.endsWith('le')) w = w.slice(0, -1)
  const out = []
  let i = 0
  while (i < w.length) {
    let matched = false
    for (const [g, vs] of DIGRAPHS) {
      if (w.startsWith(g, i)) {
        out.push(...vs)
        i += g.length
        matched = true
        break
      }
    }
    if (matched) continue
    const ch = w[i]
    if (ch === 'h') { i++; continue } // aspirated h: no visible shape of its own
    if (ch === w[i + 1] && !'aeiou'.includes(ch)) { i++; continue } // doubled consonant ("ll", "ss")
    out.push(SINGLE[ch] || 'etc')
    i++
  }
  // collapse immediate repeats (two vowels of the same shape read as one)
  return out.filter((v, k) => k === 0 || v !== out[k - 1])
}

const PAUSE_AFTER = { ',': 190, ';': 240, ':': 240, '—': 230, '–': 200, '-': 0, '.': 360, '!': 360, '?': 380, '…': 460 }

/**
 * Build a timeline for an utterance.
 * returns { segs: [{v, t, d}], words: [{start, end, text, t, tEnd, si, sj}], total }
 *  - times in ms at the given speech rate
 *  - `start`/`end` are char indexes into `text` (matches SpeechSynthesis boundary charIndex)
 */
export function buildTimeline(text, { rate = 1, unitMs = UNIT_MS } = {}) {
  const unit = unitMs / Math.max(0.3, rate)
  const segs = []
  const words = []
  let t = 0
  const re = /[A-Za-z0-9’']+|[.,;:!?…—–]/g
  let m
  while ((m = re.exec(text))) {
    const tok = m[0]
    if (/^[.,;:!?…—–]$/.test(tok)) {
      const pause = PAUSE_AFTER[tok] || 0
      if (pause) {
        const last = segs[segs.length - 1]
        if (last && last.v === 'rest') last.d += pause / Math.max(0.3, rate)
        else segs.push({ v: 'rest', t, d: pause / Math.max(0.3, rate) })
        t += pause / Math.max(0.3, rate)
      }
      continue
    }
    const vs = wordVisemes(tok)
    const w = { start: m.index, end: m.index + tok.length, text: tok, t, tEnd: t, si: segs.length, sj: segs.length }
    for (const v of vs) {
      const d = (WEIGHT[v] || 1) * unit
      segs.push({ v, t, d })
      t += d
    }
    // tiny word gap — the mouth relaxes slightly between words
    w.tEnd = t
    w.sj = segs.length
    t += 0.35 * unit
    words.push(w)
  }
  return { segs, words, total: t }
}

/** Find the segment index active at time t (binary search). */
export function segAt(segs, t) {
  let lo = 0
  let hi = segs.length - 1
  if (hi < 0 || t < segs[0].t) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

const smooth = (x) => x * x * (3 - 2 * x)

export function mixShapes(a, b, k) {
  const out = {}
  for (const key of SHAPE_KEYS) out[key] = a[key] + (b[key] - a[key]) * k
  return out
}

/** Target mouth shape at timeline time t (with co-articulation toward the next viseme). */
export function sampleTimeline(tl, t) {
  const { segs } = tl
  const i = segAt(segs, t)
  if (i < 0) return { ...SHAPES.rest }
  const s = segs[i]
  if (t > s.t + s.d) {
    // in a word gap or past the end
    if (i === segs.length - 1) return { ...SHAPES.rest }
    const next = segs[i + 1]
    const gap = next.t - (s.t + s.d)
    const k = gap > 0 ? Math.min(1, (t - (s.t + s.d)) / gap) : 1
    return mixShapes(mixShapes(SHAPES[s.v], SHAPES.rest, 0.35), SHAPES[next.v], smooth(k) * 0.6)
  }
  const local = (t - s.t) / Math.max(1, s.d)
  const next = segs[i + 1]
  let shape = SHAPES[s.v]
  if (next && local > 0.6 && next.t - (s.t + s.d) < 40) {
    shape = mixShapes(shape, SHAPES[next.v], smooth((local - 0.6) / 0.4) * 0.5)
  }
  // vowels open a touch more in their middle (jaw peak)
  if (VOWELS.has(s.v)) {
    const peak = Math.sin(Math.PI * Math.min(1, local))
    shape = { ...shape, open: shape.open * (0.82 + 0.18 * peak) }
  }
  return { ...shape }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

/**
 * Real-time lip-sync player.
 *   ls.start(text, now, {rate, native})   // TTS onstart (or native speak() call)
 *   ls.boundary(charIndex, now)           // Web Speech word boundary
 *   ls.end(now)                           // TTS onend → mouth closes
 *   ls.sample(now) → shape params
 */
export class LipSync {
  constructor({ unitMs = UNIT_MS, nativeLeadMs = 120 } = {}) {
    this.unitMs = unitMs
    this.nativeLeadMs = nativeLeadMs
    this.tl = null
    this.active = false
    // learned speed factor for estimate-only playback (per engine): >1 = voice faster than estimate
    this.calib = { web: 1, native: 1 }
  }

  start(text, now, { rate = 1, native = false } = {}) {
    this.text = text
    this.tl = buildTimeline(text, { rate, unitMs: this.unitMs })
    this.native = native
    this.mode = native ? 'native' : 'web'
    this.speed = this.calib[this.mode]
    this.anchorNow = now + (native ? this.nativeLeadMs : 0)
    this.anchorT = 0
    this.startNow = now
    this.boundaryMode = false
    this.lastB = null
    this.wordIdx = -1
    this.active = true
    this.endedAt = null
  }

  /** Re-sync on a word boundary: snap the playhead to that word, adapt speed. */
  boundary(charIndex, now) {
    if (!this.tl || !this.active) return
    const { words } = this.tl
    let idx = -1
    for (let k = 0; k < words.length; k++) {
      if (words[k].start <= charIndex) idx = k
      else break
    }
    // a boundary inside the gap before a word refers to that word
    if (idx >= 0 && charIndex >= words[idx].end && words[idx + 1]) idx += 1
    if (idx < 0) idx = 0
    const w = words[idx]
    if (!w) return
    if (this.lastB && w.t > this.lastB.t && now > this.lastB.now) {
      const obs = (w.t - this.lastB.t) / (now - this.lastB.now)
      this.speed = clamp(this.speed * 0.5 + obs * 0.5, 0.45, 2.2)
    }
    this.boundaryMode = true
    this.wordIdx = idx
    this.anchorT = w.t
    this.anchorNow = now
    this.lastB = { t: w.t, now }
  }

  playhead(now) {
    if (!this.tl) return 0
    let t = this.anchorT + Math.max(-1000, now - this.anchorNow) * this.speed
    if (this.boundaryMode) {
      // Don't run into the next word before the engine says it started:
      // finish the current word, then hold a relaxed mouth.
      const next = this.tl.words[this.wordIdx + 1]
      if (next) t = Math.min(t, next.t - 1)
    }
    return t
  }

  end(now) {
    if (!this.active) return
    this.active = false
    this.endedAt = now
    // Calibrate estimate-only playback from the real utterance length.
    if (!this.boundaryMode && this.tl && this.tl.total > 400) {
      const actual = now - this.startNow - (this.native ? this.nativeLeadMs : 0)
      if (actual > 200) {
        const obs = this.tl.total / actual
        this.calib[this.mode] = clamp(this.calib[this.mode] * 0.6 + obs * 0.4, 0.55, 1.8)
      }
    }
  }

  stop() {
    this.active = false
    this.tl = null
  }

  /** Current mouth target (before smoothing). */
  sample(now) {
    if (!this.tl || !this.active) return { ...SHAPES.rest }
    const t = this.playhead(now)
    if (t < 0) return { ...SHAPES.rest }
    if (t > this.tl.total) {
      // The estimate ran out but the voice is still going (native under-estimate):
      // keep a soft, low "talking" motion instead of freezing.
      if (!this.boundaryMode && now - this.startNow < this.tl.total / this.speed + 4000) {
        const ph = (now - this.anchorNow) / 95
        return { ...SHAPES.etc, open: 0.12 + 0.12 * Math.abs(Math.sin(ph)), wide: 1 }
      }
      return { ...SHAPES.rest }
    }
    return sampleTimeline(this.tl, t)
  }

  /** Index of the word being spoken (for gestures/captions). */
  currentWord(now) {
    if (!this.tl || !this.active) return -1
    const t = this.playhead(now)
    const ws = this.tl.words
    let idx = -1
    for (let k = 0; k < ws.length; k++) {
      if (ws[k].t <= t) idx = k
      else break
    }
    return idx
  }
}
