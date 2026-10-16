import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Mic, MicOff, Keyboard, RotateCcw, PhoneOff, Check, Volume2, ShieldCheck, ShieldAlert, Camera, ChevronLeft, Send, Loader2, Sparkles, Captions, Maximize } from 'lucide-react'
import { useAuth, createAuthedFetch } from '../auth.jsx'
import AvatarCharacter from './AvatarCharacter.jsx'
import { AriaPerformer } from './performer.js'
import { FillerPicker } from './fillers.js'
import { SpeechQueue, SentenceSplitter, Listener, createLevelMeter, sttSupported, ttsSupported, pickVoice, unlockWebSpeech } from './speech.js'
import { Proctor, isMobileDevice } from './proctor.js'
import { haptic } from '../lib/platform.js'
import './InterviewRoom.css'

/** Parse an NDJSON streaming response, calling onEvent for each line. */
async function readNdjson(res, onEvent) {
  if (!res.body || !res.body.getReader) {
    const text = await res.text()
    text.split('\n').filter(Boolean).forEach((l) => onEvent(JSON.parse(l)))
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf.trim()))
}

const SESSION_REQUESTS = new Map()

// If the reply's first sentence hasn't arrived this long after the candidate
// finished, Aria "thinks aloud" so the silence doesn't feel dead.
const THINK_ALOUD_AFTER_MS = 1200

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1' } catch (e) { return fallback }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch (e) { /* private mode */ }
}

/** Parse the practice options from the query string (?kind=&topic=&company=&q=[...]). */
function practiceOptions(search) {
  const p = new URLSearchParams(search)
  const kind = ['technical', 'domain', 'hr', 'mock'].includes(p.get('kind')) ? p.get('kind') : 'technical'
  let questions = []
  try { const q = JSON.parse(p.get('q') || '[]'); if (Array.isArray(q)) questions = q.filter((x) => typeof x === 'string').slice(0, 12) } catch (e) { /* ignore */ }
  return { kind, topic: (p.get('topic') || '').slice(0, 120), company: (p.get('company') || '').slice(0, 80), questions }
}

/**
 * Live spoken AI interview.
 *  - default: the application interview (/candidate/interview/:appId) — scored for the recruiter, score never shown.
 *  - `practice`: a private practice session (/candidate/practice?kind=technical&topic=…) — no application,
 *    no stored proctoring evidence (live on-device alert counts only), and the student sees their own score + feedback at the end.
 */
export default function InterviewRoom({ practice = false }) {
  const { appId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const debug = new URLSearchParams(location.search).has('debug')
  const practiceOpts = useMemo(() => (practice ? practiceOptions(location.search) : null), [practice, location.search])
  const exitTo = practice ? '/candidate/ai-interview' : '/candidate/applications'
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [phase, setPhase] = useState('consent') // consent | check | live | finishing | done | error
  const [session, setSession] = useState(null)
  const [sessionError, setSessionError] = useState(null)
  const [consent, setConsent] = useState(false)
  const [mediaError, setMediaError] = useState(null)
  const [level, setLevel] = useState(0)
  const [avatarState, setAvatarState] = useState('idle') // idle | speaking | listening | thinking
  const [caption, setCaption] = useState('') // what Aria says (the real reply)
  const [capFillers, setCapFillers] = useState([]) // fillers / thinking-aloud spoken this turn (lighter style)
  const [expressive, setExpressive] = useState(() => readPref('aria_expressive', true))
  const [showCaptions, setShowCaptions] = useState(() => readPref('aria_captions', true))
  const [needTap, setNeedTap] = useState(false)
  const [heard, setHeard] = useState('')
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [qIndex, setQIndex] = useState(0)
  const [total, setTotal] = useState(5)
  const [log, setLog] = useState([])
  const [lat, setLat] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [voiceOk, setVoiceOk] = useState(sttSupported())
  const [nudge, setNudge] = useState(false)
  const [speakerTested, setSpeakerTested] = useState(false)
  const [result, setResult] = useState(null) // practice evaluation
  const [proctorLive, setProctorLive] = useState(null) // { status, alerts, counts }
  const [proctorNote, setProctorNote] = useState(null) // transient notice for the candidate
  const [fsLeft, setFsLeft] = useState(false)

  const meterRef0 = useRef(null)
  const performer = useMemo(() => new AriaPerformer({ getLevel: () => (meterRef0.current ? meterRef0.current.level() : 0) }), [])
  if (debug && typeof window !== 'undefined') window.__aria = performer
  const fillers = useRef(new FillerPicker())
  const awaitingReply = useRef(false)
  const expressiveRef = useRef(expressive)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const meterRef = meterRef0
  const listenerRef = useRef(null)
  const queueRef = useRef(null)
  const proctorRef = useRef(null)
  const sessionPromise = useRef(null)
  const latencies = useRef([])
  const pendingClientMeta = useRef({})
  const lastSampleRef = useRef(null) // previous turn's latency sample → reported to the server telemetry
  const doneRef = useRef(false)
  const busyRef = useRef(false)
  const wakeLock = useRef(null)
  const startedAt = useRef(0)
  const sessionRef = useRef(null)
  const noteTimer = useRef(null)

  // ── 1. Create the session immediately (questions planned while the
  //       candidate reads the consent screen → no wait when they start).
  useEffect(() => {
    if (!candidateToken) return
    // De-duplicate: React StrictMode / quick remounts must not open two sessions.
    const key = practice
      ? `practice:${location.search}:${candidateToken.slice(-12)}`
      : `${appId}:${candidateToken.slice(-12)}`
    if (!SESSION_REQUESTS.has(key)) {
      SESSION_REQUESTS.set(key, practice
        ? api('/api/interview/practice/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(practiceOpts),
        })
        : api(`/api/interview/applications/${appId}/session`, { method: 'POST' }))
      setTimeout(() => SESSION_REQUESTS.delete(key), 10000)
    }
    sessionPromise.current = SESSION_REQUESTS.get(key).then((r) => r.clone())
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.detail || 'Could not start the interview')
        setSession(data)
        sessionRef.current = data
        setTotal(data.total_questions || 5)
        setQIndex(data.question_index || 0)
        return data
      })
      .catch((e) => {
        setSessionError(e.message)
        throw e
      })
    sessionPromise.current.catch(() => {})
    pickVoice() // warm the voice list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, candidateToken, practice, location.search])

  // ── Mic level animation loop
  useEffect(() => {
    // Only the device-check meter needs React updates (the avatar reads the
    // level itself per frame). ~15 fps is plenty and keeps phones cool.
    if (phase !== 'check') return undefined
    let last = 0
    const t = setInterval(() => {
      if (!meterRef.current) return
      const v = Math.round(meterRef.current.level() * 100) / 100
      if (Math.abs(v - last) >= 0.01) { last = v; setLevel(v) }
    }, 66)
    return () => clearInterval(t)
  }, [phase])

  // ── Timer
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // ── Preferences
  useEffect(() => {
    expressiveRef.current = expressive
    performer.setExpressive(expressive)
    writePref('aria_expressive', expressive)
  }, [expressive, performer])
  useEffect(() => { writePref('aria_captions', showCaptions) }, [showCaptions])
  // Looking down at the keyboard while typing is not "looking away".
  useEffect(() => { proctorRef.current && proctorRef.current.setTyping(typing) }, [typing])

  // ── Cleanup on unmount (re-arm on mount: StrictMode mounts twice in dev)
  useEffect(() => {
    doneRef.current = false
    return () => {
    doneRef.current = true
    listenerRef.current && listenerRef.current.stop()
    queueRef.current && queueRef.current.cancel()
    proctorRef.current && proctorRef.current.stop()
    clearTimeout(noteTimer.current)
    meterRef.current && meterRef.current.close()
    streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop())
    wakeLock.current && wakeLock.current.release && wakeLock.current.release().catch(() => {})
    }
  }, [])

  // Keep the self-view attached whenever the <video> element remounts.
  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  })

  async function setupMedia() {
    setMediaError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      })
      streamRef.current = stream
      meterRef.current = createLevelMeter(stream)
      setPhase('check')
    } catch (e) {
      // Allow audio-only if the camera is unavailable.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        streamRef.current = stream
        meterRef.current = createLevelMeter(stream)
        setMediaError(practice ? 'Camera not available — continuing with audio only.' : 'Camera not available — continuing with audio only. The recruiter will see that proctoring was limited.')
        setPhase('check')
      } catch (e2) {
        setMediaError(`We need microphone access to run the ${practice ? 'practice session' : 'interview'}. Allow it in your browser/app settings, or continue by typing your answers.`)
        setVoiceOk(false)
        setPhase('check')
      }
    }
  }

  function testSpeaker() {
    // A user gesture also unlocks speech on iOS / mobile browsers.
    meterRef.current && meterRef.current.resume()
    unlockWebSpeech() // inside the tap → unlocks speech on iOS
    const q = new SpeechQueue({
      onUtterStart: (text, meta, opts) => performer.utterStart(text, meta, performance.now(), opts),
      onBoundary: (ci) => performer.boundary(ci, performance.now()),
      onUtterEnd: () => performer.utterEnd(performance.now()),
      onIdle: () => setAvatarState('idle'),
    })
    q.begin()
    setAvatarState('speaking')
    q.enqueue("Hi! Can you hear me clearly? Great, let's begin when you're ready.")
    q.end()
    setSpeakerTested(true)
  }

  // ── Speaking ───────────────────────────────────────────────────────────────
  const getQueue = useCallback(() => {
    if (!queueRef.current) {
      queueRef.current = new SpeechQueue({
        onUtterStart: (text, meta, opts) => {
          performer.utterStart(text, meta, performance.now(), opts)
          setAvatarState(meta && meta.thinking ? 'thinking' : 'speaking')
          if (meta && meta.filler) {
            // fillers appear in the captions as they are spoken (lighter style)
            setCapFillers((f) => (f.some((x) => x.id === meta.id) ? f : [...f, { id: meta.id, text, thinking: !!meta.thinking }]))
          }
        },
        onBoundary: (ci) => performer.boundary(ci, performance.now()),
        onUtterEnd: () => performer.utterEnd(performance.now()),
        onDrain: () => { if (awaitingReply.current) setAvatarState('thinking') },
        onBlocked: () => setNeedTap(true),
        onFirstAudio: (ms) => { pendingClientMeta.current.tts_first_audio_ms = ms },
        onIdle: () => {},
      })
    }
    return queueRef.current
  }, [performer])

  function speakAll(text) {
    return new Promise((resolve) => {
      const q = getQueue()
      q.begin()
      q.cb.onIdle = () => { setAvatarState('idle'); resolve() }
      setCaption(text)
      const sp = new SentenceSplitter((s) => q.enqueue(s))
      sp.push(text + ' ')
      sp.flush()
      q.end()
      if (!ttsSupported()) resolve()
    })
  }

  // ── Listening ─────────────────────────────────────────────────────────────
  function listen() {
    if (doneRef.current) return
    // Never open the mic while Aria is still talking (no self-hearing).
    if (queueRef.current && queueRef.current.busy()) {
      setTimeout(listen, 150)
      return
    }
    performer.heard('')
    setHeard('')
    setNudge(false)
    setAvatarState('listening')
    if (!voiceOk) {
      setTyping(true)
      return
    }
    let warmSent = false
    const l = new Listener({
      lang: 'en-US',
      getLevel: () => (meterRef.current ? meterRef.current.level() : 0),
      onInterim: (t) => {
        setHeard(t)
        performer.heard(t)
        // First words of the answer: refresh the server's LLM keep-alive so the
        // reply after a long answer doesn't pay a cold connection (fire-and-forget).
        if (!warmSent && sessionRef.current) {
          warmSent = true
          api(`/api/interview/sessions/${sessionRef.current.session_id}/warm`, { method: 'POST' }).catch(() => {})
        }
      },
      onLongSilence: () => setNudge(true),
      onError: (code) => {
        setVoiceOk(false)
        setTyping(true)
        setMediaError(code === 'not-allowed' ? 'Microphone permission was blocked — please type your answers.' : 'Voice input stopped working — please type your answers.')
      },
      onFinal: (text, meta) => {
        if (!text.trim()) return listen()
        pendingClientMeta.current.endpoint_reason = meta.reason
        submitAnswer(text, meta.endedAt)
      },
    })
    listenerRef.current = l
    l.start()
  }

  // ── One conversational turn ───────────────────────────────────────────────
  //  1. candidate finishes → Aria immediately says a short varied filler
  //     ("Hmm, okay.") — the mic is already closed, so she can't hear herself;
  //  2. the reply streams from the server (which is told the filler, so the
  //     reply doesn't repeat it); if its first sentence is slow (>1.2 s) she
  //     thinks aloud with the hand-to-chin pose;
  //  3. reply sentences are spoken as they complete; then we listen again.
  //  Fillers are captioned in a lighter style and never sent as answer text.
  async function submitAnswer(answer, endedAt = performance.now()) {
    if (busyRef.current || doneRef.current) return
    busyRef.current = true
    haptic('light')
    listenerRef.current && listenerRef.current.stop()
    setTyping(false)
    setTyped('')
    setHeard(answer)
    setLog((l) => [...l, { role: 'candidate', text: answer }])
    setCaption('')
    setCapFillers([])
    performer.newTurn()

    const t0 = performance.now()
    const sample = { endpoint_to_request_ms: Math.round(t0 - endedAt) }
    const q = getQueue()
    q.begin()
    awaitingReply.current = true
    const canSpeak = ttsSupported() && !needTap
    const useFillers = expressiveRef.current && canSpeak
    const ack = useFillers ? fillers.current.ack(answer) : null
    if (ack) {
      q.enqueue(ack.text, { filler: true, id: `ack-${t0}` })
      sample.filler = ack.category
    } else {
      setAvatarState('thinking')
    }
    let firstDelta = null
    let firstSentence = false
    let full = ''
    let endEvt = null
    const thinkTimer = useFillers
      ? setTimeout(() => {
        if (firstSentence || doneRef.current || !awaitingReply.current) return
        const th = fillers.current.thinking(answer)
        q.enqueue(th.text, { filler: true, thinking: true, id: `think-${t0}` })
        sample.thinking_aloud = true
      }, THINK_ALOUD_AFTER_MS)
      : null
    const split = new SentenceSplitter((sent) => {
      if (!firstSentence) {
        firstSentence = true
        awaitingReply.current = false
        clearTimeout(thinkTimer)
      }
      q.enqueue(sent, { reply: true })
    })
    const spoken = new Promise((resolve) => { q.cb.onIdle = () => resolve() })
    const prevFirstAudio = pendingClientMeta.current.tts_first_audio_ms
    q.cb.onFirstAudio = (ms) => {
      // first audio of the turn: the filler (if any), else the reply.
      // The reply's own latency is tracked in onUtterStart below.
      if (sample.tts_start_ms != null) return
      if (ack) sample.filler_ms = Math.round(performance.now() - endedAt)
      sample.tts_start_ms = ms
      setLat({ ...sample })
    }
    const prevStart = q.cb.onUtterStart
    q.cb.onUtterStart = (text, meta, opts) => {
      prevStart(text, meta, opts)
      if (meta && meta.reply && sample.answer_to_voice_ms == null) {
        sample.answer_to_voice_ms = Math.round(performance.now() - endedAt)
        setLat({ ...sample })
      }
    }

    try {
      const res = await api(`/api/interview/sessions/${sessionRef.current.session_id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer,
          filler_spoken: ack ? ack.text : null,
          client: {
            ...pendingClientMeta.current,
            prev_tts_first_audio_ms: prevFirstAudio,
            prev_answer_to_voice_ms: lastSampleRef.current ? lastSampleRef.current.answer_to_voice_ms : undefined,
            prev_first_token_ms: lastSampleRef.current ? lastSampleRef.current.first_token_ms : undefined,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Connection problem')
      }
      sample.first_byte_ms = Math.round(performance.now() - t0)
      await readNdjson(res, (evt) => {
        if (evt.t === 'meta') {
          if (typeof evt.total === 'number') setTotal(evt.total)
        } else if (evt.t === 'd') {
          if (firstDelta == null) {
            firstDelta = performance.now()
            sample.first_token_ms = Math.round(firstDelta - t0)
          }
          full += evt.v
          setCaption(full)
          split.push(evt.v)
        } else if (evt.t === 'end') {
          endEvt = evt
          split.flush() // speak the last sentence now, not when the stream closes
        }
      })
      split.flush()
      clearTimeout(thinkTimer)
      awaitingReply.current = false
      q.end()
      sample.endpoint_reason = pendingClientMeta.current.endpoint_reason
      sample.server_ms = endEvt && endEvt.server_ms
      sample.provider = endEvt && endEvt.provider
      latencies.current.push(sample)
      lastSampleRef.current = sample
      if (debug) window.__ivLat = latencies.current
      pendingClientMeta.current = {}
      setLog((l) => [...l, { role: 'interviewer', text: full.trim() }])
      if (endEvt && typeof endEvt.q_index === 'number') setQIndex(endEvt.q_index)
      if (!ttsSupported()) setAvatarState('idle')
      await spoken
      q.cb.onUtterStart = prevStart
      busyRef.current = false
      if (endEvt && endEvt.done) return finish(endEvt.action === 'complete' ? 'completed' : endEvt.action)
      listen()
    } catch (e) {
      clearTimeout(thinkTimer)
      awaitingReply.current = false
      q.cb.onUtterStart = prevStart
      busyRef.current = false
      q.cancel()
      setAvatarState('idle')
      setCapFillers([])
      setCaption("Sorry, I lost the connection for a moment. Could you say that once more?")
      setMediaError(`Network issue: ${e.message}. Your answer was not lost — try again.`)
      setTimeout(listen, 600)
    }
  }

  function startProctor(s) {
    if (proctorRef.current) return
    const p = new Proctor({
      getVideo: () => videoRef.current, // the <video> remounts between check → live
      getStream: () => streamRef.current,
      sessionId: s.session_id,
      api,
      practice,
      onUpdate: (st) => {
        setProctorLive(st)
      },
      onNotice: (n) => {
        setProctorNote(n)
        if (n.type === 'fullscreen_exit') setFsLeft(true)
        clearTimeout(noteTimer.current)
        noteTimer.current = setTimeout(() => setProctorNote(null), 6000)
      },
    })
    proctorRef.current = p
    p.setTyping(typing)
    p.start()
  }

  function returnToFullscreen() {
    setFsLeft(false)
    proctorRef.current && proctorRef.current.enterFullscreen()
  }

  async function begin() {
    meterRef.current && meterRef.current.resume()
    unlockWebSpeech() // synchronously inside the tap (iOS autoplay rule)
    // Real interviews go full screen on desktop (inside the tap); leaving it is logged.
    let fs = null
    if (!practice && !isMobileDevice() && document.fullscreenEnabled && !document.fullscreenElement) {
      fs = document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => null)
    }
    try {
      const s = session || (await sessionPromise.current)
      if (!s) return
      setPhase('live')
      startedAt.current = Date.now()
      try { wakeLock.current = await navigator.wakeLock?.request('screen') } catch (e) { /* optional */ }
      await fs
      // Practice: live on-device counts only (nothing uploaded). Real: evidence snapshots + event log.
      startProctor(s)
      const opening = s.greeting || 'Welcome back.'
      setLog([{ role: 'interviewer', text: opening }])
      await speakAll(opening)
      listen()
    } catch (e) {
      setPhase('error')
    }
  }

  async function finish(reason = 'completed') {
    if (doneRef.current) return
    doneRef.current = true
    listenerRef.current && listenerRef.current.stop()
    setPhase('finishing')
    if (proctorRef.current && !practice) {
      try { await proctorRef.current.finalize() } catch (e) { /* never block submission */ }
    }
    const proctoring = proctorRef.current && !practice ? proctorRef.current.summary() : { risk_score: 0, risk_level: 'low', proctoring_status: practice ? 'practice_local' : 'off' }
    proctorRef.current && proctorRef.current.stop()
    try {
      const res = await api(`/api/interview/sessions/${sessionRef.current.session_id}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_reason: reason, proctoring, latency: latencies.current }),
      })
      if (practice) {
        const data = await res.json().catch(() => ({}))
        setResult(res.ok ? (data.evaluation || {}) : { error: data.detail || 'Could not score this session.' })
      }
    } catch (e) {
      /* the server keeps the transcript; recruiter can still review */
      if (practice) setResult({ error: 'Could not reach the server to score this session.' })
    }
    streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop())
    setPhase('done')
  }

  function endEarly() {
    if (!window.confirm(practice ? 'End this practice session now? You will get feedback on the answers so far.' : 'End the interview now? Your answers so far will be submitted.')) return
    queueRef.current && queueRef.current.cancel()
    finish('ended_by_candidate')
  }

  function repeatQuestion() {
    if (busyRef.current) return
    listenerRef.current && listenerRef.current.stop()
    submitAnswer('Could you repeat the question please?')
  }

  function skipSpeech() {
    // Tap the avatar while she talks → stop talking and listen now.
    if (avatarState === 'speaking' && queueRef.current) {
      queueRef.current.cancel()
      performer.stopSpeaking()
      if (!busyRef.current) listen()
    }
  }

  // phones: leave room for the camera self-view in the top-right corner
  const avatarSize = typeof window !== 'undefined' ? (window.innerWidth > 700 ? 290 : Math.min(250, Math.round(window.innerWidth * 0.55))) : 250
  const progress = Math.min(100, Math.round(((qIndex + (phase === 'done' ? 1 : 0)) / Math.max(total, 1)) * 100))
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const statusText = useMemo(() => ({
    speaking: 'Aria is speaking — tap her to skip',
    listening: voiceOk ? (heard ? 'Listening… pause when you\'re done' : 'Your turn — answer out loud') : 'Type your answer below',
    thinking: 'Aria is thinking…',
    idle: '',
  }[avatarState]), [avatarState, heard, voiceOk])

  // ── Render ────────────────────────────────────────────────────────────────
  if (!candidateToken) {
    navigate('/candidate/login')
    return null
  }

  return (
    <div className={`iv-root iv-phase-${phase}`}>
      <header className="iv-top">
        <button className="iv-back" onClick={() => (phase === 'live' ? endEarly() : navigate(exitTo))} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="iv-title">
          <strong>{practice ? 'AI Practice Interview' : 'AI Interview'}</strong>
          {phase === 'live' && <span>Question {Math.min(qIndex + 1, total)} of {total} · {mm}:{ss}</span>}
        </div>
        <div className="iv-top-right">
          {phase === 'live' && proctorLive && (
            <span className={`iv-proctor iv-proctor-${proctorLive.status}`} title={practice ? 'Practice integrity check — on this device only, nothing is saved' : `Proctoring ${proctorLive.status} (on-device)`}>
              {proctorLive.alerts > 0 ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              {practice
                ? <>{proctorLive.alerts}<span className="iv-proctor-txt"> alert{proctorLive.alerts === 1 ? '' : 's'}</span></>
                : <span className="iv-proctor-txt">{proctorLive.status === 'limited' ? 'Limited' : 'Proctored'}</span>}
            </span>
          )}
          {phase === 'live' && (practice ? <span className="iv-rec iv-practice">PRACTICE</span> : <span className="iv-rec"><i /> REC</span>)}
        </div>
        {phase === 'live' && <div className="iv-progress"><div style={{ width: `${progress}%` }} /></div>}
      </header>

      {(phase === 'consent') && (
        <section className="iv-card">
          <div className="iv-hero">
            <AvatarCharacter state="idle" mouth="smile" size={132} />
            <div>
              <h1>{practice ? 'Practice with Aria' : 'Meet Aria, your interviewer'}</h1>
              {practice && practiceOpts && <p className="iv-hint" style={{ margin: '0 0 4px' }}><b>{{ technical: 'Technical', domain: 'Domain', hr: 'HR', mock: 'Mock interview' }[practiceOpts.kind]}</b>{practiceOpts.topic ? ` · ${practiceOpts.topic}` : ''}{practiceOpts.company ? ` · ${practiceOpts.company} style` : ''}</p>}
              <p>A short spoken {practice ? 'practice session' : 'interview'} — about {session?.total_questions || 5} questions, ~10 minutes. Speak naturally; she listens, follows up and moves on, just like a person.</p>
            </div>
          </div>
          {practice ? (
          <ul className="iv-points">
            <li><Mic size={18} /> <span><b>Voice conversation.</b> Your answers are transcribed on the fly. You can switch to typing any time.</span></li>
            <li><ShieldCheck size={18} /> <span><b>Private practice.</b> This session is only for you — it is never shared with recruiters or linked to an application.</span></li>
            <li><Camera size={18} /> <span><b>Practice integrity check.</b> On-device checks show you live alerts (looking away, tab switches…) so real interviews feel familiar. No snapshots or events are saved.</span></li>
            <li><Check size={18} /> <span><b>Instant feedback.</b> You get a score, strengths and areas to improve at the end. Your history is in AI Interview → Performance.</span></li>
          </ul>
          ) : (
          <ul className="iv-points">
            <li><Mic size={18} /> <span><b>Voice conversation.</b> Your answers are transcribed on the fly. You can switch to typing any time.</span></li>
            <li><Camera size={18} /> <span><b>Camera on, checked on your device.</b> Your video is analysed in this browser and never uploaded. It checks for your face being in view, other people, looking away for a long time, phones/books/second screens and a dark or covered camera, plus leaving the tab or full screen and pasting into answers. Ordinary glances are fine.</span></li>
            <li><ShieldAlert size={18} /> <span><b>Evidence snapshots.</b> One still photo is taken at the start (to confirm it's you) and only when a possible rule break is detected — at most 30, each with the time and reason. Only the hiring company and CoreLink admins can see them, and they are deleted after 90 days.</span></li>
            <li><ShieldCheck size={18} /> <span><b>Human review.</b> A recruiter reviews every AI evaluation — an alert is never an automatic rejection. Raw transcripts are purged after 30 days; you can request deletion of transcripts and snapshots any time.</span></li>
          </ul>
          )}
          <label className="iv-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{practice ? 'I understand my answers are transcribed and scored for my own feedback.' : 'I understand what is recorded and analysed, and I agree to continue.'}</span>
          </label>
          {sessionError && <div className="iv-alert">{sessionError}</div>}
          <button className="iv-primary" disabled={!consent || !!sessionError} onClick={setupMedia}>
            Continue to device check
          </button>
        </section>
      )}

      {phase === 'check' && (
        <section className="iv-card">
          <h2>Quick device check</h2>
          <div className="iv-check-grid">
            <div className="iv-selfview-lg">
              {streamRef.current && streamRef.current.getVideoTracks().length ? (
                <video ref={videoRef} autoPlay playsInline muted />
              ) : (
                <div className="iv-novideo"><Camera size={28} /><span>No camera</span></div>
              )}
            </div>
            <div className="iv-check-list">
              <div className="iv-check-row">
                <Mic size={18} />
                <div className="iv-meter"><div style={{ width: `${Math.min(100, level * 600)}%` }} /></div>
              </div>
              <p className="iv-hint">Say something — the bar should move.</p>
              <button className="iv-secondary" onClick={testSpeaker}>
                <Volume2 size={18} /> {speakerTested ? 'Play again' : 'Test speaker'}
              </button>
              <p className="iv-hint">Use headphones if you can; it stops Aria hearing herself.</p>
              {!voiceOk && <p className="iv-warn">Voice recognition isn't available here (try Chrome, Edge or the app). You can still interview by typing.</p>}
            </div>
          </div>
          {mediaError && <div className="iv-alert">{mediaError}</div>}
          <button className="iv-primary" onClick={begin} disabled={!session && !sessionError}>
            {session ? (practice ? 'Start practice' : 'Start interview') : <><Loader2 className="iv-spin" size={18} /> Preparing questions…</>}
          </button>
        </section>
      )}

      {phase === 'live' && (
        <section className="iv-stage">
          <div className="iv-avatar-wrap">
            <AvatarCharacter state={avatarState} performer={performer} onTap={skipSpeech} size={avatarSize} />
            <div className="iv-name">Aria <small>AI Interviewer</small></div>
            <div className={`iv-status iv-status-${avatarState}`}>{statusText}</div>
            <div className="iv-prefs" role="group" aria-label="Interviewer settings">
              <button type="button" className={`iv-pref ${expressive ? 'on' : ''}`} aria-pressed={expressive} onClick={() => setExpressive((v) => !v)} title="Gestures, nods and spoken acknowledgements">
                <Sparkles size={14} /> Expressive {expressive ? 'on' : 'off'}
              </button>
              <button type="button" className={`iv-pref ${showCaptions ? 'on' : ''}`} aria-pressed={showCaptions} onClick={() => setShowCaptions((v) => !v)}>
                <Captions size={14} /> Captions {showCaptions ? 'on' : 'off'}
              </button>
            </div>
          </div>

          {needTap && (
            <button type="button" className="iv-tap" onClick={() => { setNeedTap(false); meterRef.current && meterRef.current.resume(); queueRef.current && queueRef.current.unblock() }}>
              <Volume2 size={20} /> Tap to hear Aria
            </button>
          )}

          <div className={`iv-caption ${showCaptions ? '' : 'iv-sr-only'}`} aria-live="polite">
            {(capFillers.length > 0 || caption) ? (
              <p>
                {capFillers.map((f) => <span key={f.id} className={`iv-cap-filler ${f.thinking ? 'iv-cap-thinking' : ''}`}>{f.text} </span>)}
                {caption && <span className="iv-cap-reply">{caption}</span>}
              </p>
            ) : avatarState === 'thinking' ? <p className="iv-dots"><i /><i /><i /></p> : null}
          </div>

          {(avatarState === 'listening' || heard) && voiceOk && !typing && (
            <div className="iv-heard">
              <span className="iv-heard-label">You</span>
              <p>{heard || <em>Listening…</em>}</p>
            </div>
          )}
          {nudge && avatarState === 'listening' && !heard && (
            <div className="iv-nudge">Take your time. If you'd like, tap <b>Repeat</b> to hear the question again.</div>
          )}

          {streamRef.current && streamRef.current.getVideoTracks().length > 0 && (
            <div className="iv-pip"><video ref={videoRef} autoPlay playsInline muted /></div>
          )}

          {typing && (
            <form className="iv-type" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) submitAnswer(typed.trim()) }}>
              <textarea
                value={typed}
                onChange={(e) => { setTyped(e.target.value); performer.heard(e.target.value) }}
                placeholder="Type your answer…"
                rows={3}
                autoFocus
              />
              <button type="submit" className="iv-send" disabled={!typed.trim() || avatarState === 'thinking'} aria-label="Send"><Send size={20} /></button>
            </form>
          )}

          {debug && lat && (
            <div className="iv-debug">
              {lat.endpoint_reason} · answer→voice {lat.answer_to_voice_ms}ms · 1st token {lat.first_token_ms}ms · server {lat.server_ms}ms · tts {lat.tts_start_ms}ms · {lat.provider}
            </div>
          )}
          {mediaError && <div className="iv-alert iv-alert-float">{mediaError}</div>}
          {proctorNote && !mediaError && (
            <div className={`iv-proctor-note iv-proctor-note-${proctorNote.severity}`} role="status">
              <ShieldAlert size={16} /> <span className="iv-proctor-note-txt">{proctorNote.text}{practice ? ' (practice — not saved)' : ''}</span>
              {fsLeft && !practice && <button type="button" onClick={returnToFullscreen}><Maximize size={14} /> Return to full screen</button>}
            </div>
          )}

          <nav className="iv-controls">
            <button onClick={repeatQuestion} disabled={avatarState !== 'listening'} aria-label="Repeat question">
              <RotateCcw size={20} /><span>Repeat</span>
            </button>
            {voiceOk && (
              <button
                className={`iv-mic ${avatarState === 'listening' ? 'on' : ''}`}
                onClick={() => listenerRef.current && listenerRef.current.forceSubmit()}
                disabled={avatarState !== 'listening' || !heard}
                aria-label="I'm done answering"
              >
                {avatarState === 'listening' ? (heard ? <Check size={28} /> : <Mic size={28} />) : <MicOff size={26} />}
                <span>{heard ? 'Done' : 'Mic on'}</span>
              </button>
            )}
            <button onClick={() => { setTyping((t) => !t); listenerRef.current && typing === false && listenerRef.current.stop() }} aria-label="Type instead" className={typing ? 'active' : ''}>
              <Keyboard size={20} /><span>Type</span>
            </button>
            <button className="iv-end" onClick={endEarly} aria-label="End interview">
              <PhoneOff size={20} /><span>End</span>
            </button>
          </nav>
        </section>
      )}

      {phase === 'finishing' && (
        <section className="iv-card iv-center">
          <Loader2 className="iv-spin" size={36} />
          <h2>Submitting your interview…</h2>
          <p>This takes a few seconds.</p>
        </section>
      )}

      {phase === 'done' && practice && (
        <PracticeResult result={result} onAgain={() => window.location.reload()} onBack={() => navigate(exitTo)} />
      )}

      {phase === 'done' && !practice && (
        <section className="iv-card iv-center">
          <div className="iv-done-badge"><Check size={34} /></div>
          <h2>Thank you — you're all set!</h2>
          <p>Your interview has been submitted. A recruiter will review it and you'll hear back by email. You can track progress in Applications.</p>
          <button className="iv-primary" onClick={() => navigate(exitTo)}>Back to applications</button>
        </section>
      )}

      {phase === 'error' && (
        <section className="iv-card iv-center">
          <h2>We couldn't start the {practice ? 'practice session' : 'interview'}</h2>
          <p>{sessionError || 'Please check your connection and try again.'}</p>
          <button className="iv-primary" onClick={() => navigate(exitTo)}>Back</button>
        </section>
      )}
    </div>
  )
}

const DIM_LABELS = { technical_depth: 'Technical depth', correctness: 'Correctness', problem_solving: 'Problem solving', communication: 'Communication', ownership_impact: 'Project ownership', role_fit: 'Role fit' }

/** Score + coaching shown at the end of a practice session (never shown for real interviews). */
function PracticeResult({ result, onAgain, onBack }) {
  if (!result) {
    return (
      <section className="iv-card iv-center">
        <Loader2 className="iv-spin" size={36} />
        <h2>Scoring your answers…</h2>
      </section>
    )
  }
  if (result.error) {
    return (
      <section className="iv-card iv-center">
        <h2>Practice saved</h2>
        <p>{result.error} You can find the session later in AI Interview → Performance.</p>
        <button className="iv-primary" onClick={onBack}>Back to AI Interview</button>
      </section>
    )
  }
  const score = Math.round(result.overall_score || 0)
  const dims = Object.entries(result.dimension_scores || {}).filter(([, v]) => typeof v === 'number')
  return (
    <section className="iv-card iv-result">
      <div className="iv-score" style={{ '--p': score }} aria-label={`Score ${score} out of 100`}>
        <b>{score}</b><small>/100</small>
      </div>
      <h2>{score >= 75 ? 'Great session!' : score >= 50 ? 'Good effort — keep going' : 'Keep practicing'}</h2>
      {result.summary && <p>{result.summary}</p>}
      {dims.length > 0 && (
        <div className="iv-dims">
          {dims.map(([k, v]) => (
            <div key={k} className="iv-dim"><span>{DIM_LABELS[k] || k}</span><div className="iv-meter"><div style={{ width: `${Math.round(v * 10)}%` }} /></div><b>{Math.round(v * 10)}%</b></div>
          ))}
        </div>
      )}
      <div className="iv-fb">
        {result.strengths?.length > 0 && <div><h3>Strengths</h3><ul>{result.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {result.concerns?.length > 0 && <div><h3>To improve</h3><ul>{result.concerns.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      </div>
      <div className="iv-actions">
        <button className="iv-secondary" onClick={onAgain}><RotateCcw size={18} /> Practice again</button>
        <button className="iv-primary" onClick={onBack}>Back to AI Interview</button>
      </div>
    </section>
  )
}
