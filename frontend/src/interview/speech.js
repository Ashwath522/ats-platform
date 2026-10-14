/**
 * Speech I/O for the AI interviewer — works in browsers (Web Speech API) and
 * inside the Capacitor app (native TTS + native speech recognition, because
 * Android WebView does not implement webkitSpeechRecognition).
 *
 * Latency features
 *  - Sentence queue: the interviewer starts talking as soon as the FIRST
 *    sentence has streamed in; later sentences are queued seamlessly.
 *  - Adaptive end-of-turn detection: uses the recogniser's "final" flag, the
 *    mic energy (voice activity) and answer length to decide when the
 *    candidate has finished — short pauses mid-thought don't cut them off,
 *    but a finished answer is detected in < 1 s.
 */
import { isNative, platform } from '../lib/platform.js'

// ─────────────────────────────────────────────────────────────────────────────
// Text-to-speech
// ─────────────────────────────────────────────────────────────────────────────

const PREFERRED_VOICES = [
  'Microsoft Aria Online (Natural)',
  'Microsoft Jenny Online (Natural)',
  'Microsoft Ava Online (Natural)',
  'Google UK English Female',
  'Google US English',
  'Samantha',
  'Karen',
  'Moira',
  'Tessa',
  'Microsoft Zira',
]

let cachedVoice = null

function loadVoices() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return resolve([])
    const v = window.speechSynthesis.getVoices()
    if (v && v.length) return resolve(v)
    const t = setTimeout(() => resolve(window.speechSynthesis.getVoices() || []), 1200)
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(t)
      resolve(window.speechSynthesis.getVoices() || [])
    }
  })
}

export async function pickVoice() {
  if (cachedVoice) return cachedVoice
  const voices = await loadVoices()
  for (const name of PREFERRED_VOICES) {
    const v = voices.find((x) => x.name === name)
    if (v) return (cachedVoice = v)
  }
  cachedVoice =
    voices.find((v) => /en[-_](US|GB|IN|AU)/i.test(v.lang) && /female|natural|online/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null
  return cachedVoice
}

export function ttsSupported() {
  return isNative || (typeof window !== 'undefined' && 'speechSynthesis' in window)
}

/**
 * iOS Safari / WKWebView only allow speech after a user gesture. Call this
 * synchronously inside a tap/click handler: speaking a silent utterance
 * "unlocks" speechSynthesis for the rest of the page's life.
 */
export function unlockWebSpeech() {
  if (isNative || typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  } catch (e) { /* ignore */ }
}

/**
 * Sequential sentence speaker.
 * callbacks:
 *   onSpeakStart(text, meta)                 – an utterance started (legacy)
 *   onUtterStart(text, meta, {native, rate}) – audio starts (drives lip sync)
 *   onBoundary(charIndex, text)              – Web Speech word boundary (re-sync)
 *   onUtterEnd(text, meta)                   – utterance finished
 *   onDrain()                                – queue empty but producer still open
 *   onIdle()                                 – queue empty and producer closed
 *   onFirstAudio(ms since first enqueue)
 *   onBlocked()                              – first speech never started (iOS autoplay) → ask for a tap, then unblock()
 * Items can carry metadata: enqueue(text, { filler: true }).
 */
export class SpeechQueue {
  constructor({ rate = 1.04, pitch = 1.0, lang = 'en-US', ...callbacks } = {}) {
    this.rate = rate
    this.pitch = pitch
    this.lang = lang
    this.cb = callbacks
    this.queue = []
    this.speaking = false
    this.closed = true // true when the producer has finished sending text
    this.cancelled = false
    this.blocked = false
    this._everStarted = false
    this._firstEnqueueAt = null
    this._keepAlive = null
  }

  /** Start a new utterance group (one interviewer turn). */
  begin() {
    this.cancel()
    this.cancelled = false
    this.closed = false
    this._firstEnqueueAt = null
  }

  enqueue(sentence, meta = {}) {
    const text = (sentence || '').trim()
    if (!text || this.cancelled) return
    if (this._firstEnqueueAt == null) this._firstEnqueueAt = performance.now()
    this.queue.push({ text, meta })
    if (!this.speaking && !this.blocked) this._next()
  }

  /** Producer is done; when the queue drains, onIdle fires. */
  end() {
    this.closed = true
    if (!this.speaking && this.queue.length === 0 && !this.blocked) this._idle()
  }

  /** True while something is being spoken or waiting to be spoken. */
  busy() {
    return this.speaking || this.queue.length > 0 || this.blocked
  }

  cancel() {
    this.cancelled = true
    this.queue = []
    this.speaking = false
    this.blocked = false
    clearInterval(this._keepAlive)
    if (this._current) {
      const cur = this._current
      this._current = null
      if (this.cb.onUtterEnd) this.cb.onUtterEnd(cur.text, cur.meta)
    }
    if (isNative) {
      import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {})
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }

  /** After the user tapped "Tap to hear Aria": unlock audio and continue. Call from the tap handler. */
  unblock() {
    unlockWebSpeech()
    if (!this.blocked) return
    this.blocked = false
    if (!this.speaking) this._next()
  }

  _idle() {
    clearInterval(this._keepAlive)
    if (this.cb.onIdle) this.cb.onIdle()
  }

  async _next() {
    if (this.cancelled || this.blocked) return
    const item = this.queue.shift()
    if (!item) {
      this.speaking = false
      if (this.closed) this._idle()
      else if (this.cb.onDrain) this.cb.onDrain()
      return
    }
    this.speaking = true
    const { text, meta } = item
    const markStart = (native) => {
      this._everStarted = true
      this._current = item
      if (this._firstEnqueueAt != null && this.cb.onFirstAudio) {
        this.cb.onFirstAudio(Math.round(performance.now() - this._firstEnqueueAt))
        this._firstEnqueueAt = null
      }
      if (this.cb.onSpeakStart) this.cb.onSpeakStart(text, meta)
      if (this.cb.onUtterStart) this.cb.onUtterStart(text, meta, { native, rate: this.rate })
    }
    const markEnd = () => {
      if (this._current !== item) return
      this._current = null
      if (this.cb.onUtterEnd) this.cb.onUtterEnd(text, meta)
    }
    let res
    try {
      if (isNative) res = await this._speakNative(text, markStart)
      else res = await this._speakWeb(text, markStart)
    } catch (e) {
      // Speech failed (no voices, blocked autoplay…) – keep the flow going.
      if (this.cb.onError) this.cb.onError(e)
    }
    markEnd()
    if (res === 'blocked' && !this.cancelled) {
      this.queue.unshift(item)
      this.speaking = false
      this.blocked = true
      if (this.cb.onBlocked) this.cb.onBlocked()
      return
    }
    if (!this.cancelled) this._next()
  }

  _speakNative(text, markStart) {
    // Native TTS has no word-boundary events: lip sync runs on an estimate
    // from text length + rate, anchored to this start and the end callback.
    return import('@capacitor-community/text-to-speech').then(async ({ TextToSpeech }) => {
      markStart(true)
      await TextToSpeech.speak({
        text,
        lang: this.lang,
        rate: platform === 'ios' ? 0.52 : this.rate, // iOS scale differs (0.5 ≈ normal)
        pitch: this.pitch,
        volume: 1.0,
        category: 'playback',
      })
    })
  }

  async _speakWeb(text, markStart) {
    const synth = window.speechSynthesis
    const voice = await pickVoice()
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      if (voice) u.voice = voice
      u.lang = (voice && voice.lang) || this.lang
      u.rate = this.rate
      u.pitch = this.pitch
      let started = false
      let done = false
      const finish = (why) => {
        if (done) return
        done = true
        clearTimeout(safety)
        clearTimeout(startGuard)
        resolve(why)
      }
      u.onstart = () => {
        started = true
        markStart(false)
      }
      u.onboundary = (ev) => {
        if (ev.name && ev.name !== 'word') return
        if (!started) { started = true; markStart(false) }
        if (this.cb.onBoundary) this.cb.onBoundary(ev.charIndex, text)
      }
      u.onend = () => finish('end')
      u.onerror = (ev) => finish(ev && ev.error === 'not-allowed' && !this._everStarted ? 'blocked' : 'error')
      // Safety net: Chrome occasionally never fires onend.
      const safety = setTimeout(() => finish('timeout'), 2500 + text.length * 95)
      // Autoplay guard: if the very first utterance never starts (iOS without a
      // user gesture), report "blocked" so the UI can ask for a tap.
      const startGuard = !this._everStarted
        ? setTimeout(() => { if (!started && !synth.speaking) { synth.cancel(); finish('blocked') } }, 3500)
        : null
      synth.speak(u)
      // Chrome pauses long speech in background tabs; nudge it.
      clearInterval(this._keepAlive)
      this._keepAlive = setInterval(() => { if (synth.paused) synth.resume() }, 4000)
    })
  }
}

/** Incrementally split streamed text into speakable sentences. */
export class SentenceSplitter {
  constructor(onSentence) {
    this.buf = ''
    this.onSentence = onSentence
    this.count = 0
  }

  push(delta) {
    this.buf += delta
    // Sentence end: . ! ? followed by space, when long enough to sound natural.
    let m
    const re = /([.!?…]+)(\s+)/g
    let lastCut = 0
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[1].length
      const candidate = this.buf.slice(lastCut, end).trim()
      const min = this.count === 0 ? 8 : 20 // first sentence can be short → faster first audio
      if (candidate.length >= min && !/\b(e\.g|i\.e|etc|vs|Mr|Ms|Dr)\.$/i.test(candidate)) {
        this.onSentence(candidate)
        this.count++
        lastCut = end + m[2].length
      }
    }
    if (lastCut) this.buf = this.buf.slice(lastCut)
    // Very long clause without punctuation: cut at a comma to keep audio flowing.
    if (this.buf.length > 160) {
      const c = this.buf.lastIndexOf(', ')
      if (c > 60) {
        this.onSentence(this.buf.slice(0, c + 1).trim())
        this.count++
        this.buf = this.buf.slice(c + 2)
      }
    }
  }

  flush() {
    const rest = this.buf.trim()
    this.buf = ''
    if (rest) {
      this.onSentence(rest)
      this.count++
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Speech-to-text with adaptive end-of-turn detection
// ─────────────────────────────────────────────────────────────────────────────

export function sttSupported() {
  if (isNative) return true
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

/**
 * new Listener({ onInterim(text), onFinal(text, meta), onError(code), getLevel() })
 *   .start() → listens until end-of-turn is detected, then calls onFinal once.
 * getLevel(): optional fn returning current mic RMS (0..1) for voice activity.
 */
export class Listener {
  constructor(opts) {
    this.opts = opts
    this.active = false
    this.finalText = ''
    this.interim = ''
    this.lastSpeechAt = 0
    this.lastResultAt = 0
    this.lastWasFinal = false
    this.startedAt = 0
    this._timer = null
    this._rec = null
    this._nativeHandles = []
  }

  get text() {
    return `${this.finalText} ${this.interim}`.replace(/\s+/g, ' ').trim()
  }

  async start() {
    this.active = true
    this.finalText = ''
    this.interim = ''
    this.startedAt = performance.now()
    this.lastSpeechAt = 0
    this.lastResultAt = 0
    if (isNative) await this._startNative()
    else this._startWeb()
    clearInterval(this._timer)
    this._timer = setInterval(() => this._checkEndpoint(), 120)
  }

  stop() {
    this.active = false
    clearInterval(this._timer)
    try { this._rec && this._rec.abort() } catch (e) { /* ignore */ }
    this._rec = null
    if (isNative) {
      import('@capacitor-community/speech-recognition').then(({ SpeechRecognition }) => {
        SpeechRecognition.stop().catch(() => {})
        SpeechRecognition.removeAllListeners().catch(() => {})
      }).catch(() => {})
    }
  }

  /** Candidate tapped "Done" — submit immediately. */
  forceSubmit() {
    if (!this.active) return
    this._emitFinal('manual')
  }

  _emitFinal(reason) {
    const text = this.text
    this.stop()
    this.opts.onFinal && this.opts.onFinal(text, { reason, endedAt: performance.now() })
  }

  _onResult(text, isFinal) {
    const now = performance.now()
    this.lastResultAt = now
    this.lastSpeechAt = now
    this.lastWasFinal = isFinal
    this.opts.onInterim && this.opts.onInterim(this.text)
  }

  _checkEndpoint() {
    if (!this.active) return
    const now = performance.now()
    const level = this.opts.getLevel ? this.opts.getLevel() : 0
    // Adaptive noise floor: fans, traffic or a constant hum must not look like
    // "still talking". The floor follows quiet levels quickly and loud ones slowly.
    if (this._floor == null) this._floor = level
    this._floor = level < this._floor ? this._floor * 0.7 + level * 0.3 : this._floor * 0.995 + level * 0.005
    const threshold = Math.max(this.opts.vadThreshold ?? 0.035, this._floor * 2.2 + 0.01)
    if (level > threshold) this.lastSpeechAt = now

    const text = this.text
    const words = text ? text.split(/\s+/).length : 0
    if (!words) {
      // Nothing said yet: after a long silence, nudge (handled by UI) — don't submit.
      if (this.opts.onLongSilence && now - this.startedAt > 12000 && !this._nudged) {
        this._nudged = true
        this.opts.onLongSilence()
      }
      return
    }
    // Adaptive silence window.
    let windowMs = this.opts.silenceMs ?? 1100
    if (words < 6) windowMs += 900            // very short so far → probably still thinking
    else if (this.lastWasFinal) windowMs -= 250 // recogniser already closed the phrase
    if (/\b(and|but|so|because|um+|uh+|like|the|a|to|of|with)$/i.test(text)) windowMs += 700 // mid-sentence
    windowMs = Math.max(650, windowMs)

    const silentFor = now - Math.max(this.lastSpeechAt, this.lastResultAt)
    if (silentFor >= windowMs) return this._emitFinal('silence')
    // Energy without any new recognised words for a while = noise, not speech.
    if (now - this.lastResultAt >= windowMs + 600) return this._emitFinal('no_new_words')
    // Hard cap so one answer can't run forever (3 min).
    if (now - this.startedAt > 180000) this._emitFinal('max_length')
  }

  _startWeb() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = this.opts.lang || 'en-US'
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      let interim = ''
      let lastFinal = false
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        const t = r[0] ? r[0].transcript : ''
        if (r.isFinal) {
          this.finalText = `${this.finalText} ${t}`.trim()
          lastFinal = true
        } else {
          interim += t
          lastFinal = false
        }
      }
      this.interim = interim.trim()
      this._onResult(this.text, lastFinal)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        this.active = false
        clearInterval(this._timer)
        this.opts.onError && this.opts.onError(e.error)
      }
      // 'no-speech' / 'network' / 'aborted' → onend restarts below
    }
    rec.onend = () => {
      // Chrome ends recognition after a while; keep listening until we decide.
      if (this.active && this._rec === rec) {
        try { rec.start() } catch (e) { /* ignore */ }
      }
    }
    this._rec = rec
    try { rec.start() } catch (e) { /* already started */ }
  }

  async _startNative() {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    const perm = await SpeechRecognition.checkPermissions().catch(() => ({ speechRecognition: 'prompt' }))
    if (perm.speechRecognition !== 'granted') {
      const r = await SpeechRecognition.requestPermissions().catch(() => ({ speechRecognition: 'denied' }))
      if (r.speechRecognition !== 'granted') {
        this.opts.onError && this.opts.onError('not-allowed')
        return
      }
    }
    await SpeechRecognition.removeAllListeners().catch(() => {})
    let committed = ''
    let current = ''
    await SpeechRecognition.addListener('partialResults', (data) => {
      current = (data.matches && data.matches[0]) || ''
      this.finalText = committed
      this.interim = current
      this._onResult(this.text, false)
    })
    await SpeechRecognition.addListener('listeningState', (data) => {
      // Android's recogniser stops on its own after a pause; commit and restart
      // so a candidate who pauses mid-answer isn't cut off.
      if (data.status === 'stopped' && this.active) {
        committed = `${committed} ${current}`.trim()
        current = ''
        this.finalText = committed
        this.interim = ''
        this.lastWasFinal = true
        this.lastResultAt = performance.now()
        setTimeout(() => {
          if (this.active) SpeechRecognition.start({ language: this.opts.lang || 'en-US', partialResults: true, popup: false }).catch(() => {})
        }, 60)
      }
    })
    await SpeechRecognition.start({ language: this.opts.lang || 'en-US', partialResults: true, popup: false })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mic level meter (also used for voice-activity detection)
// ─────────────────────────────────────────────────────────────────────────────

export function createLevelMeter(stream) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    return {
      level() {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        return Math.sqrt(sum / data.length)
      },
      resume() { if (ctx.state === 'suspended') ctx.resume() },
      close() { try { ctx.close() } catch (e) { /* ignore */ } },
    }
  } catch (e) {
    return { level: () => 0, resume() {}, close() {} }
  }
}
