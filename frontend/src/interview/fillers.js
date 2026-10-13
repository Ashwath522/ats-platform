/**
 * Human fillers for Aria — short spoken acknowledgements said the moment the
 * candidate finishes ("Hmm, okay."), and "thinking aloud" lines used when the
 * LLM's first sentence is slow to arrive.
 *
 * Rules
 *  - Never evaluative ("great answer") — fillers must not leak a judgement.
 *  - Chosen from simple context: answer length, uncertainty words, technical
 *    keywords. Never the same phrase twice in a row, and recent phrases are
 *    avoided so it doesn't sound canned.
 *  - Fillers are only spoken/captioned. The backend is told which one was
 *    said (so the reply doesn't repeat it) but it never enters the scored
 *    transcript.
 */

export const ACKS = {
  short: ['Okay.', 'Mm-hmm.', 'Alright.', 'Okay, sure.', 'Right.'],
  uncertain: ['That\'s okay.', 'No worries.', 'Mm, okay.', 'Fair enough.', 'Okay, that\'s fine.'],
  technical: ['Interesting…', 'Oh, I see.', 'Hmm, okay.', 'Right, I follow.', 'Ah, okay.'],
  long: ['Right, that makes sense.', 'Mm-hmm, got it.', 'Okay, I see.', 'Hmm, okay.', 'Okay, got it.'],
  neutral: ['Hmm, okay.', 'Mm-hmm, got it.', 'Oh, I see.', 'Right.', 'Okay.', 'I see.'],
}

export const THINKING = {
  general: [
    'Let me think about that for a second…',
    'Hmm, let me think…',
    'Okay, give me a moment…',
    'Let me see…',
  ],
  building: [
    'Okay, so building on what you said…',
    'So, picking up on that…',
    'Right, so following on from that…',
  ],
}

const UNCERTAIN_RE = /\b(i\s*don'?t\s*know|not\s+(really\s+)?sure|no\s+idea|i\s+forgot|i\s+can'?t\s+remember|i'?m\s+not\s+familiar|never\s+(used|worked|heard))\b|^\s*(um+|uh+|hmm+)[\s,.]*$/i
const HEDGE_RE = /\b(maybe|probably|i\s+guess|i\s+think|kind\s+of|sort\s+of|perhaps|um+|uh+)\b/gi
const REPEAT_RE = /\b(repeat|say that again|pardon|didn'?t (hear|catch|get) (that|you|the question)|come again|rephrase)\b/i
const EXIT_RE = /\b(end|stop|quit)\s+(the\s+)?(interview|session|practice)\b|\bnot\s+interested\b|\b(let'?s|can\s+we)\s+(end|stop)\b/i

// Generic engineering vocabulary + anything that looks like a measurement.
const TECH_WORDS = [
  'algorithm', 'api', 'architecture', 'cache', 'caching', 'database', 'sql', 'latency', 'throughput', 'thread', 'memory',
  'circuit', 'voltage', 'current', 'resistor', 'capacitor', 'transistor', 'mosfet', 'verilog', 'vhdl', 'fpga', 'pcb',
  'microcontroller', 'firmware', 'uart', 'spi', 'i2c', 'sensor', 'signal', 'frequency', 'filter', 'plc', 'scada',
  'stress', 'strain', 'load', 'torque', 'beam', 'fatigue', 'fea', 'ansys', 'cad', 'solidworks', 'catia', 'tolerance',
  'concrete', 'foundation', 'staad', 'reinforcement', 'heat', 'thermal', 'fluid', 'cfd', 'pressure', 'reactor',
  'distillation', 'aspen', 'matlab', 'simulink', 'python', 'java', 'react', 'docker', 'kubernetes', 'redis', 'model',
  'regression', 'neural', 'optimization', 'optimisation', 'simulation', 'protocol', 'inverter', 'motor', 'battery',
  'welding', 'machining', 'cnc', 'metallurgy', 'alloy', 'corrosion', 'testbench', 'timing', 'kernel', 'compiler',
  'iot', 'mqtt', 'esp32', 'arduino', 'raspberry', 'modelsim', 'oscilloscope', 'scope', 'synchroniser', 'synchronizer', 'counter',
]
const TECH_RE = new RegExp(`\\b(${TECH_WORDS.join('|')})s?\\b`, 'gi')
const NUM_RE = /\b\d+(\.\d+)?\s*(%|percent|ms|kb|mb|gb|hz|khz|mhz|v|kv|ma|a|kw|mw|mm|cm|m|kg|n|mpa|x)?\b/gi

export function wordCount(text) {
  return (String(text || '').trim().match(/\S+/g) || []).length
}

/** Classify the candidate's answer for filler selection. */
export function answerContext(answer) {
  const text = String(answer || '')
  const words = wordCount(text)
  const tech = (text.match(TECH_RE) || []).length + (text.match(NUM_RE) || []).length
  const hedges = (text.match(HEDGE_RE) || []).length
  if (!words) return { category: 'none', words, tech, hedges }
  if (REPEAT_RE.test(text) && words <= 12) return { category: 'repeat', words, tech, hedges }
  if (EXIT_RE.test(text)) return { category: 'exit', words, tech, hedges }
  if (UNCERTAIN_RE.test(text) || (words < 25 && hedges >= 2)) return { category: 'uncertain', words, tech, hedges }
  if (words < 8) return { category: 'short', words, tech, hedges }
  if (tech >= 2) return { category: 'technical', words, tech, hedges }
  if (words >= 60) return { category: 'long', words, tech, hedges }
  return { category: 'neutral', words, tech, hedges }
}

function pick(list, { last, recent = [], rng = Math.random }) {
  const norm = (s) => String(s || '').toLowerCase()
  let pool = list.filter((x) => norm(x) !== norm(last) && !recent.map(norm).includes(norm(x)))
  if (!pool.length) pool = list.filter((x) => norm(x) !== norm(last))
  if (!pool.length) pool = list
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}

/**
 * Choose an acknowledgement for the answer the candidate just gave.
 * opts: { last, recent: string[], rng }
 * returns { text, category } or null when no filler fits (repeat request, exit, empty).
 */
export function chooseAck(answer, opts = {}) {
  const ctx = answerContext(answer)
  if (ctx.category === 'none' || ctx.category === 'repeat' || ctx.category === 'exit') return null
  const text = pick(ACKS[ctx.category], opts)
  return { text, category: ctx.category }
}

/** Choose a "thinking aloud" line (used when the reply is slow). */
export function chooseThinking(answer, opts = {}) {
  const ctx = answerContext(answer)
  const list = ctx.words >= 20 && ctx.category !== 'uncertain' ? [...THINKING.building, ...THINKING.general] : THINKING.general
  return { text: pick(list, opts), category: 'thinking' }
}

/**
 * Small stateful helper used by the interview room: remembers what was said
 * so the same filler never plays twice in a row and recent ones are avoided.
 */
export class FillerPicker {
  constructor({ rng = Math.random, memory = 3 } = {}) {
    this.rng = rng
    this.memory = memory
    this.history = []
  }

  _remember(text) {
    this.history.push(text)
    if (this.history.length > this.memory) this.history.shift()
  }

  get last() {
    return this.history[this.history.length - 1]
  }

  ack(answer) {
    const r = chooseAck(answer, { last: this.last, recent: this.history, rng: this.rng })
    if (r) this._remember(r.text)
    return r
  }

  thinking(answer) {
    const r = chooseThinking(answer, { last: this.last, recent: this.history, rng: this.rng })
    this._remember(r.text)
    return r
  }
}
