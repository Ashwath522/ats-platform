/**
 * Procedural body language for Aria.
 *
 *  - `planGestures(timeline, text, state)`: from the words being spoken, plan
 *    beat gestures on stressed / long words, an open-palm "asking" gesture and
 *    an eyebrow raise on questions, and counting on fingers when listing
 *    ("first… second…"). Times are in timeline ms, so gestures stay in sync
 *    with the (boundary re-synced) lip-sync playhead.
 *  - `armSegments`: foreshortening arm rig (elbow + hand points → SVG angles/lengths).
 *  - `Backchannel`: while the candidate talks, decides when Aria nods, makes a
 *    silent "mm" mouth and smiles — driven by mic level and STT interim words.
 */

const EMPHASIS = new Set([
  'really', 'actually', 'exactly', 'specific', 'specifically', 'important', 'most', 'biggest', 'hardest', 'why', 'how',
  'never', 'always', 'every', 'key', 'main', 'own', 'personally', 'concrete', 'example', 'trade-off', 'tradeoff', 'impact',
])
const ORDINALS = {
  first: 1, firstly: 1, second: 2, secondly: 2, third: 3, thirdly: 3, fourth: 4, fifth: 5,
}
const LIST_CONTINUE = new Set(['next', 'then', 'finally', 'lastly', 'also'])
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 }

/** A word is "stressed" if it is long, an emphasis word, a number, or ALL CAPS. */
export function isStressed(word) {
  const w = String(word || '')
  const lw = w.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!lw) return false
  if (EMPHASIS.has(lw)) return true
  if (/^\d/.test(lw)) return true
  if (w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return true
  return lw.length >= 9
}

/**
 * Plan gestures for one utterance.
 * timeline: { words: [{text, start, end, t, tEnd}], total }
 * state: mutable per-turn state { listCount } (carries the counting across sentences)
 * returns [{type:'beat'|'palm'|'count'|'brow'|'nod', t, d, n?, hand?}]
 */
export function planGestures(timeline, text, state = {}, { minGap = 850 } = {}) {
  const words = (timeline && timeline.words) || []
  const total = (timeline && timeline.total) || 0
  const out = []
  if (!words.length) return out
  const isQuestion = /\?\s*$/.test(String(text || '').trim())
  if (state.listCount == null) state.listCount = 0

  // 1) Counting on fingers when listing.
  const listy = words.filter((w, i) => {
    const lw = w.text.toLowerCase()
    if (ORDINALS[lw]) {
      const after = text.slice(w.end, w.end + 2)
      // "First, …" / "first of all" / sentence-initial ordinal
      return /^[,:]/.test(after) || i === 0 || /^\s*of\b/.test(text.slice(w.end, w.end + 4))
    }
    if (LIST_CONTINUE.has(lw) && state.listCount > 0) return /^[,:]/.test(text.slice(w.end, w.end + 2)) || i === 0
    return false
  })
  const numerals = words.filter((w) => NUMBER_WORDS[w.text.toLowerCase()])
  const countEvents = []
  for (const w of listy) {
    const lw = w.text.toLowerCase()
    const n = ORDINALS[lw] || Math.min(5, state.listCount + 1)
    state.listCount = Math.max(state.listCount, n)
    countEvents.push({ type: 'count', t: Math.max(0, w.t - 120), d: 1100, n })
  }
  // "one…, two…, three…" style enumerations need at least two numerals in the sentence
  if (!countEvents.length && numerals.length >= 2) {
    for (const w of numerals) {
      const n = NUMBER_WORDS[w.text.toLowerCase()]
      countEvents.push({ type: 'count', t: Math.max(0, w.t - 120), d: 900, n })
    }
  }
  out.push(...countEvents)

  // 2) Question → open palm(s) + eyebrow raise over the final clause.
  let palm = null
  if (isQuestion) {
    // find where the question clause starts (after the last . , or ; before the "?")
    const body = String(text).trim()
    const cut = Math.max(body.lastIndexOf('. ', body.length - 2), body.lastIndexOf(', ', body.length - 2))
    let startWord = words.find((w) => w.start > cut) || words[0]
    const qStart = Math.max(startWord.t, total * 0.25)
    palm = { type: 'palm', t: Math.max(0, qStart - 150), d: Math.max(700, total - qStart + 450) }
    out.push(palm)
    out.push({ type: 'brow', t: Math.max(0, total * 0.6), d: Math.max(600, total * 0.4 + 400) })
  }

  // 3) Beats on stressed words, spaced out, not during count/palm gestures.
  const busy = (t) => out.some((g) => (g.type === 'count' || g.type === 'palm') && t >= g.t - 200 && t <= g.t + g.d)
  let lastBeat = -Infinity
  let hand = state.lastHand === 'L' ? 'R' : 'L'
  for (const w of words) {
    if (!isStressed(w.text)) continue
    if (w.t - lastBeat < minGap) continue
    if (busy(w.t)) continue
    out.push({ type: 'beat', t: Math.max(0, w.t - 60), d: 420, hand })
    out.push({ type: 'nod', t: w.t, d: 360, amt: 0.6 })
    lastBeat = w.t
    state.lastHand = hand
    hand = hand === 'L' ? 'R' : 'L'
  }
  return out.sort((a, b) => a.t - b.t)
}

// ── Arm segments (SVG coordinates: y down; rotate(θ) turns (0,L) into (−L·sinθ, L·cosθ)) ──
//
// A flat 2D arm with fixed bone lengths can't show a forearm pointing at the
// camera, so Aria's rig is "foreshortening": each pose gives an elbow and a
// hand point, and the bones stretch/shrink (within limits) to connect them.

const RAD = Math.PI / 180

/** Angle (deg) that rotates a downward bone (0,1) to point from a to b. */
export function boneAngle(a, b) {
  return Math.atan2(-(b.x - a.x), b.y - a.y) / RAD
}

/** Move `p` toward `from` so that it is at most `max` away. */
export function clampReach(from, p, max) {
  const dx = p.x - from.x
  const dy = p.y - from.y
  const d = Math.hypot(dx, dy)
  if (d <= max || d === 0) return { x: p.x, y: p.y }
  return { x: from.x + (dx / d) * max, y: from.y + (dy / d) * max }
}

/**
 * Segments for an arm through shoulder → elbow → hand.
 * returns { a1, len1, a2 (relative to the upper arm), len2, elbow, hand }
 */
export function armSegments(shoulder, elbowT, handT, { L1 = 62, L2 = 80, min1 = 30, min2 = 14 } = {}) {
  const elbow = clampReach(shoulder, elbowT, L1)
  const hand = clampReach(elbow, handT, L2)
  const len1 = Math.max(min1, Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y))
  const len2 = Math.max(min2, Math.hypot(hand.x - elbow.x, hand.y - elbow.y))
  const a1 = boneAngle(shoulder, elbow)
  const a2 = boneAngle(elbow, hand) - a1
  return { a1, len1, a2, len2, elbow, hand }
}

/** Forward kinematics (for tests/debug): hand position from angles + lengths. */
export function armFK(shoulder, a1, a2, len1, len2) {
  const r1 = a1 * RAD
  const r2 = (a1 + a2) * RAD
  const elbow = { x: shoulder.x - len1 * Math.sin(r1), y: shoulder.y + len1 * Math.cos(r1) }
  const hand = { x: elbow.x - len2 * Math.sin(r2), y: elbow.y + len2 * Math.cos(r2) }
  return { elbow, hand }
}

// ── Listening backchannel ─────────────────────────────────────────────────────

/**
 * Decides nods / "mm" / smiles while the candidate is talking. Visual only.
 *   const bc = new Backchannel({ rng })
 *   bc.update(now, { level, words }) → array of events [{type:'nod'|'mm'|'smile', d}]
 */
export class Backchannel {
  constructor({ rng = Math.random, threshold = 0.03 } = {}) {
    this.rng = rng
    this.threshold = threshold
    this.reset(0)
  }

  reset(now) {
    this.talkStart = null
    this.lastVoice = -Infinity
    this.lastNod = now
    this.lastSmile = now
    this.lastWords = 0
    this.floor = null
  }

  update(now, { level = 0, words = 0 } = {}) {
    const ev = []
    // adaptive noise floor (same idea as the end-of-turn detector)
    if (this.floor == null) this.floor = level
    this.floor = level < this.floor ? this.floor * 0.7 + level * 0.3 : this.floor * 0.995 + level * 0.005
    const thr = Math.max(this.threshold, this.floor * 2.2 + 0.01)
    const voiced = level > thr
    if (voiced) {
      if (this.talkStart == null) this.talkStart = now
      this.lastVoice = now
    }
    const sinceNod = now - this.lastNod
    // A pause after a stretch of talking → nod (people nod at phrase ends).
    const pausedAfterTalk = !voiced && this.talkStart != null && now - this.lastVoice > 320 && this.lastVoice - this.talkStart > 1100
    // Or several new words recognised since the last nod.
    const newWords = words - this.lastWords
    const wordsTrigger = newWords >= 7
    if ((pausedAfterTalk || wordsTrigger) && sinceNod > 2200) {
      ev.push({ type: 'nod', d: 520 + this.rng() * 220, amt: 0.7 + this.rng() * 0.5 })
      if (this.rng() < 0.35) ev.push({ type: 'mm', d: 420 })
      this.lastNod = now
      this.lastWords = words
      if (pausedAfterTalk) this.talkStart = null
    }
    if (now - this.lastSmile > 9000 && this.rng() < 0.012) {
      ev.push({ type: 'smile', d: 1600 + this.rng() * 900 })
      this.lastSmile = now
    }
    if (!voiced && this.talkStart != null && now - this.lastVoice > 1500) this.talkStart = null
    return ev
  }
}
