import { describe, it, expect, vi } from 'vitest'
import { ProctorRules, SnapshotGate, DetectorPacer, THRESHOLDS } from '../proctor-rules.js'
import { Proctor } from '../proctor.js'

/** Feed a value at a fixed cadence from t0 for `ms`. */
function feed(fn, { from = 0, ms, every = 1000 }) {
  let t = from
  for (; t <= from + ms; t += every) fn(t)
  return t
}

function calibrated(rules, from = 0) {
  // 9 s of frontal poses → baseline (yaw 4°, pitch 2°)
  return feed((t) => rules.pose(t, { yaw: 4, pitch: 2, gazeX: 0.05, nose: { x: 0.5 + (t % 3) * 0.002, y: 0.5 }, ear: 0.28 + (t % 2) * 0.05 }), { from, ms: 9000 })
}

describe('ProctorRules — face presence', () => {
  it('a 3 s step out of frame does not flag; 5 s+ does (once per episode)', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    feed((t) => r.face(t, 1), { ms: 3000 })
    feed((t) => r.face(t, 0), { from: 4000, ms: 3000 }) // 3 s gap
    feed((t) => r.face(t, 1), { from: 8000, ms: 3000 })
    expect(events).toHaveLength(0)
    feed((t) => r.face(t, 0), { from: 12000, ms: 8000 }) // 8 s gap
    expect(events.map((e) => e.type)).toEqual(['face_left_frame'])
    expect(events[0].severity).toBe('medium')
  })

  it('long absence escalates to person_absent (high)', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    feed((t) => r.face(t, 0), { ms: 21000 })
    expect(events.map((e) => e.type)).toEqual(['face_left_frame', 'person_absent'])
  })

  it('a single-frame second face (false positive) does not flag; 2 s sustained does', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    r.face(0, 1); r.face(1000, 2); r.face(2000, 1); r.face(3000, 1); r.face(4000, 2); r.face(5000, 1); r.face(6000, 1)
    expect(events).toHaveLength(0)
    feed((t) => r.face(t, 2), { from: 7000, ms: 3000 })
    expect(events.map((e) => e.type)).toEqual(['multiple_faces'])
    expect(events[0].severity).toBe('high')
  })
})

describe('ProctorRules — gaze / head pose with baseline', () => {
  it('calibrates to the candidate\'s natural pose (a camera off to the side is not "looking away")', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    // Camera mounted to the side: candidate's normal yaw is ~25°.
    let t = feed((t) => r.pose(t, { yaw: 25, pitch: 0, gazeX: 0.1 }), { ms: 9000 })
    expect(r.baseline.yaw).toBe(25)
    feed((tt) => r.pose(tt, { yaw: 27, pitch: 1, gazeX: 0.12 }), { from: t, ms: 30000 })
    expect(events).toHaveLength(0)
  })

  it('normal glances (< 6 s) never flag; sustained turn does, repeated turns escalate to medium', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    let t = calibrated(r)
    for (let i = 0; i < 5; i++) { // five 3-second glances
      t = feed((tt) => r.pose(tt, { yaw: 50, pitch: 2, gazeX: 0 }), { from: t, ms: 3000 })
      t = feed((tt) => r.pose(tt, { yaw: 4, pitch: 2, gazeX: 0 }), { from: t, ms: 4000 })
    }
    expect(events).toHaveLength(0)
    const sev = []
    for (let i = 0; i < 3; i++) {
      t = feed((tt) => r.pose(tt, { yaw: -45, pitch: 0, gazeX: 0 }), { from: t, ms: 8000 })
      t = feed((tt) => r.pose(tt, { yaw: 4, pitch: 2, gazeX: 0 }), { from: t, ms: 5000 })
      sev.push(events[events.length - 1].severity)
    }
    expect(events.map((e) => e.type)).toEqual(['looking_away', 'looking_away', 'looking_away'])
    expect(sev).toEqual(['low', 'low', 'medium'])
  })

  it('looking down is ignored while the candidate is typing', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    let t = calibrated(r)
    r.setTyping(true)
    t = feed((tt) => r.pose(tt, { yaw: 4, pitch: 30, gazeX: 0 }), { from: t, ms: 20000 })
    expect(events).toHaveLength(0)
    r.setTyping(false)
    feed((tt) => r.pose(tt, { yaw: 4, pitch: 30, gazeX: 0 }), { from: t, ms: 10000 })
    expect(events.map((e) => e.type)).toEqual(['looking_down'])
  })

  it('flags a perfectly static face (photo) only after a long window, conservatively', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    let t = calibrated(r)
    // A live person: small natural movement → never flagged
    t = feed((tt) => r.pose(tt, { yaw: 4 + Math.sin(tt / 900) * 2, pitch: 2, gazeX: 0, nose: { x: 0.5 + Math.sin(tt / 700) * 0.01, y: 0.5 }, ear: 0.28 + (tt % 4000 === 0 ? -0.15 : 0) }), { from: t, ms: 60000 })
    expect(events.filter((e) => e.type === 'spoof_suspected')).toHaveLength(0)
    // A photo: identical landmarks for 45 s+
    feed((tt) => r.pose(tt, { yaw: 4, pitch: 2, gazeX: 0, nose: { x: 0.5, y: 0.5 }, ear: 0.3 }), { from: t, ms: 60000 })
    const spoof = events.filter((e) => e.type === 'spoof_suspected')
    expect(spoof).toHaveLength(1)
    expect(spoof[0].severity).toBe('medium')
  })
})

describe('ProctorRules — objects need 2 of the last 3 detections', () => {
  it('one phone frame is ignored, two of three fire once', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    r.objects(0, [{ label: 'cell phone', score: 0.8 }])
    r.objects(3000, [])
    r.objects(6000, [])
    r.objects(9000, [{ label: 'cell phone', score: 0.4 }]) // below score threshold
    expect(events).toHaveLength(0)
    r.objects(12000, [{ label: 'cell phone', score: 0.7 }])
    r.objects(15000, [{ label: 'cell phone', score: 0.7 }, { label: 'person', score: 0.9 }])
    r.objects(18000, [{ label: 'cell phone', score: 0.7 }])
    expect(events.map((e) => [e.type, e.severity])).toEqual([['phone_detected', 'high']])
    // phone gone for a whole window → a new episode can fire later
    r.objects(21000, []); r.objects(24000, []); r.objects(27000, [])
    r.objects(30000, [{ label: 'book', score: 0.9 }]); r.objects(33000, [{ label: 'book', score: 0.9 }])
    r.objects(36000, [{ label: 'cell phone', score: 0.9 }]); r.objects(39000, [{ label: 'cell phone', score: 0.9 }])
    expect(events.map((e) => e.type)).toEqual(['phone_detected', 'book_detected', 'phone_detected'])
  })

  it('two people via the object detector → extra_person; laptop/tv → second_screen', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    const two = [{ label: 'person', score: 0.9 }, { label: 'person', score: 0.8 }, { label: 'tv', score: 0.7 }]
    r.objects(0, two); r.objects(3000, two)
    expect(events.map((e) => e.type).sort()).toEqual(['extra_person', 'second_screen'])
  })
})

describe('ProctorRules — lighting + browser signals + corroboration', () => {
  it('covered camera after 4 s, brief darkness ignored', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    feed((t) => r.light(t, 0.02), { ms: 2000, every: 2000 })
    feed((t) => r.light(t, 0.5), { from: 4000, ms: 4000, every: 2000 })
    expect(events).toHaveLength(0)
    feed((t) => r.light(t, 0.02), { from: 10000, ms: 6000, every: 2000 })
    expect(events.map((e) => e.type)).toEqual(['camera_covered'])
  })

  it('tab switch counts, window blur is deduped against it, short blurs are low', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    r.browser(1000, 'blur'); r.browser(1010, 'hidden'); r.browser(6000, 'visible'); r.browser(6010, 'focus')
    expect(events.map((e) => e.type)).toEqual(['tab_switched'])
    r.browser(10000, 'blur'); r.browser(11000, 'focus') // 1 s on another window
    r.browser(20000, 'blur'); r.browser(25000, 'focus') // 5 s
    r.browser(30000, 'blur'); r.browser(30300, 'focus') // 0.3 s — ignored
    expect(events.slice(1).map((e) => [e.type, e.severity])).toEqual([['window_blur', 'low'], ['window_blur', 'medium']])
  })

  it('paste severity depends on length; corroboration links distinct concerns within 30 s', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    r.browser(0, 'paste', { chars: 5 })
    r.browser(1000, 'paste', { chars: 300 })
    expect(events.map((e) => e.severity)).toEqual(['low', 'medium'])
    r.browser(100000, 'hidden')
    expect(events[2].corroborated).toBe(false)
    r.browser(101000, 'visible')
    r.browser(110000, 'fullscreen_exit')
    expect(events[2].corroborated).toBe(true)
    expect(events[3].corroborated).toBe(true)
  })

  it('visual episodes reset while the tab is hidden', () => {
    const events = []
    const r = new ProctorRules({ onEvent: (e) => events.push(e) })
    r.face(0, 0); r.face(1000, 0); r.face(2000, 0)
    r.browser(3000, 'hidden')
    r.face(4000, 0); r.face(9000, 0) // ignored while hidden
    r.browser(9500, 'visible')
    r.face(10000, 0); r.face(11000, 0)
    expect(events.map((e) => e.type)).toEqual(['tab_switched'])
  })

  it('signals are fair: one tab switch / one look-away do not raise risk signals', () => {
    const r = new ProctorRules()
    r.browser(0, 'hidden'); r.browser(1000, 'visible')
    let s = r.signals()
    expect(s.tabSwitched).toBe(false)
    r.browser(60000, 'hidden')
    s = r.signals()
    expect(s.tabSwitched).toBe(true)
    expect(s.continuousFaceVisible).toBe(true)
  })
})

describe('SnapshotGate + DetectorPacer', () => {
  it('snapshots: medium/high only, 20 s cooldown per type, session cap', () => {
    const g = new SnapshotGate({ cooldownMs: 20000, cap: 3 })
    expect(g.allow({ type: 'looking_away', severity: 'low', ts: 0 })).toBe(false)
    expect(g.allow({ type: 'tab_switched', severity: 'medium', ts: 0 })).toBe(true)
    expect(g.allow({ type: 'tab_switched', severity: 'medium', ts: 10000 })).toBe(false)
    expect(g.allow({ type: 'phone_detected', severity: 'high', ts: 10000 })).toBe(true)
    expect(g.allow({ type: 'tab_switched', severity: 'medium', ts: 21000 })).toBe(true)
    expect(g.allow({ type: 'multiple_faces', severity: 'high', ts: 50000 })).toBe(false) // cap
  })

  it('backs off when detections exceed the budget, recovers, and disables on repeated very slow runs', () => {
    const p = new DetectorPacer({ baseMs: 1000, budgetMs: 50, killMs: 400, killAfter: 3 })
    p.record(0, 120)
    expect(p.intervalMs).toBe(2000)
    p.record(2000, 150)
    expect(p.intervalMs).toBe(4000)
    for (let i = 0; i < 10; i++) p.record(10000 + i * 1000, 5)
    expect(p.intervalMs).toBe(1000)
    p.record(30000, 500); p.record(31000, 500)
    expect(p.disabled).toBe(false)
    p.record(32000, 700)
    expect(p.disabled).toBe(true)
    expect(p.due(99999)).toBe(false)
  })
})

describe('Proctor orchestration (mocked detectors)', () => {
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, srcObject: null }

  function make(opts) {
    let now = 0
    const api = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 1 }) }))
    const notices = []
    const p = new Proctor({ getVideo: () => video, sessionId: 7, api, tier: 'desktop', now: () => now, onNotice: (n) => notices.push(n), ...opts })
    p.detectors.face = 'ok'
    return { p, api, notices, setNow: (t) => { now = t } }
  }

  it('practice mode keeps live counts only — never uploads snapshots or events', async () => {
    const { p, api, notices, setNow } = make({ practice: true })
    p.models.face = { detect: async () => ({ faceCount: 2 }) }
    const snap = vi.spyOn(p, '_snapshot')
    for (let t = 0; t <= 4000; t += 1000) { setNow(t); await p._run('face', video, t) }
    p.rules.browser(5000, 'hidden')
    await p.finalize()
    expect(p.liveState().alerts).toBe(2)
    expect(p.liveState().counts.multiple_faces).toBe(1)
    expect(notices.length).toBe(2)
    expect(snap).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('real interview: medium/high events request a snapshot (with cooldown) and are batched to the server', async () => {
    const { p, api, setNow } = make({ practice: false })
    const snap = vi.spyOn(p, '_snapshot').mockImplementation((ev, label, v, item) => { if (item) item.waiting = false })
    p.rules.browser(1000, 'hidden'); p.rules.browser(2000, 'visible')
    p.rules.browser(5000, 'hidden'); p.rules.browser(6000, 'visible') // within 20 s cooldown → no 2nd snapshot
    p.rules.browser(7000, 'contextmenu') // low → logged only
    expect(snap).toHaveBeenCalledTimes(1)
    setNow(8000)
    await p.finalize()
    expect(api).toHaveBeenCalledTimes(1)
    const [url, req] = api.mock.calls[0]
    expect(url).toBe('/api/interview/7/proctor/events')
    const body = JSON.parse(req.body)
    expect(body.events.map((e) => e.type)).toEqual(['tab_switched', 'tab_switched', 'context_menu'])
    expect(body.events[0]).not.toHaveProperty('waiting')
    const s = p.summary()
    expect(s.counts.tab_switched).toBe(2)
    expect(['medium', 'low', 'high']).toContain(s.risk_level)
    expect(s.flags.find((f) => f.type === 'tab_switched').count).toBe(2)
  })

  it('a clean session stays low risk; slow detector is switched off and status becomes limited', async () => {
    const { p, setNow } = make({ practice: true })
    p.detectors.headpose = 'ok'; p.detectors.objects = 'ok'
    p.models.face = { detect: async () => ({ faceCount: 1 }) }
    p.models.objects = { detect: async () => [], release: () => {} }
    for (let t = 0; t <= 60000; t += 1000) { setNow(t); await p._run('face', video, t) }
    expect(p.summary().risk_level).toBe('low')
    // Simulate a phone that takes > killMs per object detection
    let fake = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (fake += 1000))
    for (let i = 0; i < 3; i++) await p._run('objects', video, 70000 + i * 5000)
    spy.mockRestore()
    expect(p.detectors.objects).toBe('slow')
    expect(p.models.objects).toBe(null)
    expect(p.status).toBe('limited')
  })

  it('thresholds are exported for documentation', () => {
    expect(THRESHOLDS.noFaceMs).toBe(5000)
    expect(THRESHOLDS.lookAwayMs).toBe(6000)
  })
})
