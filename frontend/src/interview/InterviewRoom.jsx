import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Mic, MicOff, Keyboard, RotateCcw, PhoneOff, Check, Volume2, ShieldCheck, Camera, ChevronLeft, Send, Loader2 } from 'lucide-react'
import { useAuth, createAuthedFetch } from '../auth.jsx'
import AvatarCharacter, { useLipSync } from './AvatarCharacter.jsx'
import { SpeechQueue, SentenceSplitter, Listener, createLevelMeter, sttSupported, ttsSupported, pickVoice } from './speech.js'
import { Proctor } from './proctor.js'
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

export default function InterviewRoom() {
  const { appId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const debug = new URLSearchParams(location.search).has('debug')
  const { candidateToken, logoutCandidate } = useAuth()
  const api = createAuthedFetch(candidateToken, logoutCandidate)

  const [phase, setPhase] = useState('consent') // consent | check | live | finishing | done | error
  const [session, setSession] = useState(null)
  const [sessionError, setSessionError] = useState(null)
  const [consent, setConsent] = useState(false)
  const [mediaError, setMediaError] = useState(null)
  const [level, setLevel] = useState(0)
  const [avatarState, setAvatarState] = useState('idle') // idle | speaking | listening | thinking
  const [caption, setCaption] = useState('')
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

  const lip = useLipSync()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const meterRef = useRef(null)
  const listenerRef = useRef(null)
  const queueRef = useRef(null)
  const proctorRef = useRef(null)
  const sessionPromise = useRef(null)
  const latencies = useRef([])
  const pendingClientMeta = useRef({})
  const doneRef = useRef(false)
  const busyRef = useRef(false)
  const wakeLock = useRef(null)
  const startedAt = useRef(0)
  const sessionRef = useRef(null)

  // ── 1. Create the session immediately (questions planned while the
  //       candidate reads the consent screen → no wait when they start).
  useEffect(() => {
    if (!candidateToken) return
    // De-duplicate: React StrictMode / quick remounts must not open two sessions.
    const key = `${appId}:${candidateToken.slice(-12)}`
    if (!SESSION_REQUESTS.has(key)) {
      SESSION_REQUESTS.set(key, api(`/api/interview/applications/${appId}/session`, { method: 'POST' }))
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
  }, [appId, candidateToken])

  // ── Mic level animation loop
  useEffect(() => {
    // ~15 fps is plenty for the meter/halo and keeps phones cool.
    let last = 0
    const t = setInterval(() => {
      if (!meterRef.current) return
      const v = Math.round(meterRef.current.level() * 100) / 100
      if (Math.abs(v - last) >= 0.01) { last = v; setLevel(v) }
    }, 66)
    return () => clearInterval(t)
  }, [])

  // ── Timer
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // ── Cleanup on unmount (re-arm on mount: StrictMode mounts twice in dev)
  useEffect(() => {
    doneRef.current = false
    return () => {
    doneRef.current = true
    listenerRef.current && listenerRef.current.stop()
    queueRef.current && queueRef.current.cancel()
    proctorRef.current && proctorRef.current.stop()
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
        setMediaError('Camera not available — continuing with audio only. The recruiter will see that proctoring was limited.')
        setPhase('check')
      } catch (e2) {
        setMediaError('We need microphone access to run the interview. Allow it in your browser/app settings, or continue by typing your answers.')
        setVoiceOk(false)
        setPhase('check')
      }
    }
  }

  function testSpeaker() {
    // A user gesture also unlocks speech on iOS / mobile browsers.
    meterRef.current && meterRef.current.resume()
    const q = new SpeechQueue({ onWord: lip.onWord, onIdle: () => { lip.reset(); setAvatarState('idle') } })
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
        onWord: (w) => lip.onWord(w),
        onSpeakStart: (text) => setAvatarState('speaking'),
        onFirstAudio: (ms) => { pendingClientMeta.current.tts_first_audio_ms = ms },
        onIdle: () => {},
      })
    }
    return queueRef.current
  }, [lip])

  function speakAll(text) {
    return new Promise((resolve) => {
      const q = getQueue()
      q.begin()
      q.cb.onIdle = () => { lip.reset(); setAvatarState('idle'); resolve() }
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
    setHeard('')
    setNudge(false)
    setAvatarState('listening')
    if (!voiceOk) {
      setTyping(true)
      return
    }
    const l = new Listener({
      lang: 'en-US',
      getLevel: () => (meterRef.current ? meterRef.current.level() : 0),
      onInterim: (t) => setHeard(t),
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
  async function submitAnswer(answer, endedAt = performance.now()) {
    if (busyRef.current || doneRef.current) return
    busyRef.current = true
    haptic('light')
    listenerRef.current && listenerRef.current.stop()
    setTyping(false)
    setTyped('')
    setHeard(answer)
    setLog((l) => [...l, { role: 'candidate', text: answer }])
    setAvatarState('thinking')
    setCaption('')

    const t0 = performance.now()
    const sample = { endpoint_to_request_ms: Math.round(t0 - endedAt) }
    const q = getQueue()
    q.begin()
    let firstDelta = null
    let full = ''
    let endEvt = null
    const split = new SentenceSplitter((s) => q.enqueue(s))
    const spoken = new Promise((resolve) => { q.cb.onIdle = () => { lip.reset(); resolve() } })
    const prevFirstAudio = pendingClientMeta.current.tts_first_audio_ms
    q.cb.onFirstAudio = (ms) => {
      sample.answer_to_voice_ms = Math.round(performance.now() - endedAt)
      sample.tts_start_ms = ms
      setLat({ ...sample })
    }

    try {
      const res = await api(`/api/interview/sessions/${sessionRef.current.session_id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, client: { ...pendingClientMeta.current, prev_tts_first_audio_ms: prevFirstAudio } }),
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
        }
      })
      split.flush()
      q.end()
      sample.endpoint_reason = pendingClientMeta.current.endpoint_reason
      sample.server_ms = endEvt && endEvt.server_ms
      sample.provider = endEvt && endEvt.provider
      latencies.current.push(sample)
      if (debug) window.__ivLat = latencies.current
      pendingClientMeta.current = {}
      setLog((l) => [...l, { role: 'interviewer', text: full.trim() }])
      if (endEvt && typeof endEvt.q_index === 'number') setQIndex(endEvt.q_index)
      if (!ttsSupported()) setAvatarState('idle')
      await spoken
      busyRef.current = false
      if (endEvt && endEvt.done) return finish(endEvt.action === 'complete' ? 'completed' : endEvt.action)
      listen()
    } catch (e) {
      busyRef.current = false
      q.cancel()
      setAvatarState('idle')
      setCaption("Sorry, I lost the connection for a moment. Could you say that once more?")
      setMediaError(`Network issue: ${e.message}. Your answer was not lost — try again.`)
      setTimeout(listen, 600)
    }
  }

  async function begin() {
    meterRef.current && meterRef.current.resume()
    try {
      const s = session || (await sessionPromise.current)
      if (!s) return
      setPhase('live')
      startedAt.current = Date.now()
      try { wakeLock.current = await navigator.wakeLock?.request('screen') } catch (e) { /* optional */ }
      if (videoRef.current && streamRef.current) {
        proctorRef.current = new Proctor(videoRef.current)
        proctorRef.current.start()
      }
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
    const proctoring = proctorRef.current ? proctorRef.current.summary() : { risk_score: 0, risk_level: 'low', proctoring_status: 'off' }
    proctorRef.current && proctorRef.current.stop()
    try {
      await api(`/api/interview/sessions/${sessionRef.current.session_id}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_reason: reason, proctoring, latency: latencies.current }),
      })
    } catch (e) { /* the server keeps the transcript; recruiter can still review */ }
    streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop())
    setPhase('done')
  }

  function endEarly() {
    if (!window.confirm('End the interview now? Your answers so far will be submitted.')) return
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
      lip.reset()
      if (!busyRef.current) listen()
    }
  }

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
        <button className="iv-back" onClick={() => (phase === 'live' ? endEarly() : navigate('/candidate/repo'))} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="iv-title">
          <strong>AI Interview</strong>
          {phase === 'live' && <span>Question {Math.min(qIndex + 1, total)} of {total} · {mm}:{ss}</span>}
        </div>
        <div className="iv-top-right">
          {phase === 'live' && <span className="iv-rec"><i /> REC</span>}
        </div>
        {phase === 'live' && <div className="iv-progress"><div style={{ width: `${progress}%` }} /></div>}
      </header>

      {(phase === 'consent') && (
        <section className="iv-card">
          <div className="iv-hero">
            <AvatarCharacter state="idle" mouth="smile" size={132} />
            <div>
              <h1>Meet Aria, your interviewer</h1>
              <p>A short spoken interview — about {session?.total_questions || 5} questions, ~10 minutes. Speak naturally; she listens, follows up and moves on, just like a person.</p>
            </div>
          </div>
          <ul className="iv-points">
            <li><Mic size={18} /> <span><b>Voice conversation.</b> Your answers are transcribed on the fly. You can switch to typing any time.</span></li>
            <li><Camera size={18} /> <span><b>Camera on.</b> On-device checks only look for face presence, extra people and tab switching.</span></li>
            <li><ShieldCheck size={18} /> <span><b>Human review.</b> A recruiter reviews every AI evaluation. Raw transcripts are purged after 30 days; you can request deletion any time.</span></li>
          </ul>
          <label className="iv-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I understand what is recorded and analysed, and I agree to continue.</span>
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
            {session ? 'Start interview' : <><Loader2 className="iv-spin" size={18} /> Preparing questions…</>}
          </button>
        </section>
      )}

      {phase === 'live' && (
        <section className="iv-stage">
          <div className="iv-avatar-wrap">
            <AvatarCharacter state={avatarState} mouth={lip.mouth} level={level} onTap={skipSpeech} size={Math.min(240, Math.round(window.innerWidth * 0.58))} />
            <div className="iv-name">Aria <small>AI Interviewer</small></div>
            <div className={`iv-status iv-status-${avatarState}`}>{statusText}</div>
          </div>

          <div className="iv-caption" aria-live="polite">
            {caption ? <p>{caption}</p> : avatarState === 'thinking' ? <p className="iv-dots"><i /><i /><i /></p> : null}
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
                onChange={(e) => setTyped(e.target.value)}
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

      {phase === 'done' && (
        <section className="iv-card iv-center">
          <div className="iv-done-badge"><Check size={34} /></div>
          <h2>Thank you — you're all set!</h2>
          <p>Your interview has been submitted. A recruiter will review it and you'll hear back by email. You can track progress in Applications.</p>
          <button className="iv-primary" onClick={() => navigate('/candidate/repo')}>Back to applications</button>
        </section>
      )}

      {phase === 'error' && (
        <section className="iv-card iv-center">
          <h2>We couldn't start the interview</h2>
          <p>{sessionError || 'Please check your connection and try again.'}</p>
          <button className="iv-primary" onClick={() => navigate('/candidate/repo')}>Back</button>
        </section>
      )}
    </div>
  )
}
