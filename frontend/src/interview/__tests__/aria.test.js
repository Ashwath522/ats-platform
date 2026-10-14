import { describe, it, expect } from 'vitest'
import { wordVisemes, buildTimeline, sampleTimeline, segAt, LipSync, SHAPES, VISEMES } from '../visemes.js'
import { chooseAck, chooseThinking, answerContext, FillerPicker, ACKS } from '../fillers.js'
import { planGestures, isStressed, armSegments, armFK, boneAngle, Backchannel } from '../gestures.js'
import { AriaPerformer, countFingers } from '../performer.js'

// deterministic rng
function seeded(seed = 1) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

describe('viseme mapper', () => {
  it('maps letters and digraphs to visemes', () => {
    expect(wordVisemes('mama')).toEqual(['MBP', 'AI', 'MBP', 'AI'])
    expect(wordVisemes('the')).toEqual(['TH', 'E'])
    expect(wordVisemes('phone')).toEqual(['FV', 'O', 'etc'])
    expect(wordVisemes('food')[0]).toBe('FV')
    expect(wordVisemes('food')).toContain('U')
    expect(wordVisemes('well')).toEqual(['WQ', 'E', 'L'])
    expect(wordVisemes('I')).toEqual(['AI'])
  })
  it('drops silent e, aspirated h and collapses doubled consonants', () => {
    expect(wordVisemes('make')).toEqual(['MBP', 'AI', 'etc'])
    expect(wordVisemes('hello')).toEqual(['E', 'L', 'O'])
  })
  it('handles numbers, apostrophes, empty input', () => {
    expect(wordVisemes("I'm").length).toBeGreaterThan(0)
    expect(wordVisemes('40').length).toBeGreaterThan(2)
    expect(wordVisemes('')).toEqual([])
    expect(wordVisemes('—')).toEqual([])
  })
  it('only emits known visemes', () => {
    const all = 'The quick brown fox jumps over the lazy dog while thinking about rhythm 2026'.split(' ').flatMap(wordVisemes)
    for (const v of all) expect(VISEMES).toContain(v)
  })
})

describe('timeline', () => {
  const text = 'Hi Sneha, welcome. What did you build?'
  const tl = buildTimeline(text, { rate: 1 })
  it('has ordered, contiguous-ish segments and word records with char ranges', () => {
    expect(tl.words.map((w) => w.text)).toEqual(['Hi', 'Sneha', 'welcome', 'What', 'did', 'you', 'build'])
    expect(text.slice(tl.words[1].start, tl.words[1].end)).toBe('Sneha')
    for (let i = 1; i < tl.segs.length; i++) expect(tl.segs[i].t).toBeGreaterThanOrEqual(tl.segs[i - 1].t)
    expect(tl.total).toBeGreaterThan(1500)
    expect(tl.total).toBeLessThan(5000)
  })
  it('inserts rest pauses on punctuation (mouth closes)', () => {
    const comma = tl.words[1]
    const rest = tl.segs.find((s) => s.v === 'rest' && s.t >= comma.tEnd - 1)
    expect(rest).toBeTruthy()
    expect(rest.d).toBeGreaterThan(150)
    const mid = sampleTimeline(tl, rest.t + rest.d / 2)
    expect(mid.open).toBeLessThan(0.25)
  })
  it('faster speech rate gives a shorter timeline', () => {
    expect(buildTimeline(text, { rate: 1.5 }).total).toBeLessThan(tl.total)
  })
  it('segAt finds the active segment', () => {
    expect(segAt(tl.segs, -5)).toBe(-1)
    const k = 3
    expect(segAt(tl.segs, tl.segs[k].t + 1)).toBe(k)
  })
  it('closed-lip visemes are closed, vowels open', () => {
    expect(SHAPES.MBP.open).toBe(0)
    expect(SHAPES.AI.open).toBeGreaterThan(SHAPES.E.open)
    expect(SHAPES.WQ.round).toBeGreaterThan(0.8)
  })
})

describe('LipSync player', () => {
  it('estimates timing without boundaries and closes the mouth at the end', () => {
    const ls = new LipSync()
    ls.start('Okay, so what was the hardest part?', 1000, { rate: 1 })
    const opens = []
    for (let t = 1000; t < 1000 + ls.tl.total; t += 30) opens.push(ls.sample(t).open)
    expect(Math.max(...opens)).toBeGreaterThan(0.5)
    expect(new Set(opens.map((x) => x.toFixed(2))).size).toBeGreaterThan(5)
    ls.end(1000 + ls.tl.total)
    expect(ls.sample(1000 + ls.tl.total + 50).open).toBe(0)
  })
  it('re-anchors on word boundaries and adapts speed', () => {
    const text = 'one two three four five six seven'
    const ls = new LipSync()
    ls.start(text, 0, { rate: 1 })
    const w3 = ls.tl.words[3]
    // engine is twice as slow as estimated
    ls.boundary(ls.tl.words[1].start, ls.tl.words[1].t * 2)
    ls.boundary(w3.start, w3.t * 2)
    expect(ls.speed).toBeLessThan(0.85)
    expect(ls.currentWord(w3.t * 2 + 1)).toBe(3)
    expect(Math.abs(ls.playhead(w3.t * 2) - w3.t)).toBeLessThan(1)
  })
  it('does not run ahead into the next word before its boundary', () => {
    const ls = new LipSync()
    ls.start('alpha beta gamma', 0)
    ls.boundary(0, 0)
    const next = ls.tl.words[1]
    expect(ls.playhead(next.t * 10)).toBeLessThan(next.t)
  })
  it('calibrates estimate-only (native) playback from real durations', () => {
    const ls = new LipSync({ nativeLeadMs: 0 })
    const text = 'This is a fairly long sentence spoken by the native engine today.'
    ls.start(text, 0, { native: true })
    const est = ls.tl.total
    ls.end(est * 1.5) // real voice was slower
    expect(ls.calib.native).toBeLessThan(1)
    ls.start(text, 0, { native: true })
    expect(ls.speed).toBeLessThan(1)
  })
})

describe('filler chooser', () => {
  it('classifies context', () => {
    expect(answerContext("I don't know").category).toBe('uncertain')
    expect(answerContext('Yes I did').category).toBe('short')
    expect(answerContext('I wrote a UART driver in C and tested the SPI timing at 8 MHz with a logic analyser').category).toBe('technical')
    expect(answerContext('word '.repeat(70)).category).toBe('long')
    expect(answerContext('Could you repeat the question please?').category).toBe('repeat')
  })
  it('picks from the matching category', () => {
    expect(ACKS.uncertain).toContain(chooseAck("Honestly I'm not sure, I don't know").text)
    expect(ACKS.technical).toContain(chooseAck('I used Verilog and an FPGA to build the counter with a 50 MHz clock').text)
    expect(ACKS.short).toContain(chooseAck('Yes').text)
  })
  it('returns no filler for repeat requests, exit intent or empty answers', () => {
    expect(chooseAck('Could you repeat the question please?')).toBeNull()
    expect(chooseAck("Let's end the interview")).toBeNull()
    expect(chooseAck('   ')).toBeNull()
  })
  it('never repeats the same filler twice in a row and varies over time', () => {
    const p = new FillerPicker({ rng: seeded(7) })
    const said = []
    for (let i = 0; i < 40; i++) said.push(p.ack('I built a small project for my lab course last semester with my team').text)
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1])
    expect(new Set(said).size).toBeGreaterThanOrEqual(4)
  })
  it('avoids recently used fillers, even across thinking lines', () => {
    const p = new FillerPicker({ rng: () => 0 })
    const a = p.ack('Yes').text
    const b = p.ack('Yes').text
    const c = p.ack('Yes').text
    expect(new Set([a, b, c]).size).toBe(3)
    const t1 = p.thinking('a long answer '.repeat(10)).text
    const t2 = p.thinking('a long answer '.repeat(10)).text
    expect(t1).not.toBe(t2)
  })
  it('thinking aloud never sounds evaluative', () => {
    for (let i = 0; i < 20; i++) expect(chooseThinking('x', { rng: Math.random }).text).not.toMatch(/great|perfect|excellent|wrong/i)
    for (const list of Object.values(ACKS)) for (const f of list) expect(f).not.toMatch(/great|perfect|excellent|good answer|wrong/i)
  })
})

describe('gesture scheduler', () => {
  const plan = (text, st = {}) => planGestures(buildTimeline(text), text, st)
  it('open palm + brow raise on a question, timed in the last clause', () => {
    const text = 'You mentioned the counter. How did you verify it worked?'
    const tl = buildTimeline(text)
    const g = planGestures(tl, text, {})
    const palm = g.find((x) => x.type === 'palm')
    expect(palm).toBeTruthy()
    const how = tl.words.find((w) => w.text === 'How')
    expect(palm.t).toBeGreaterThan(tl.words[2].t)
    expect(palm.t).toBeLessThanOrEqual(how.t)
    expect(g.some((x) => x.type === 'brow')).toBe(true)
  })
  it('no palm for statements', () => {
    expect(plan('That is the end of the session.').some((x) => x.type === 'palm')).toBe(false)
  })
  it('counts on fingers when listing, carrying the count across sentences', () => {
    const st = {}
    const a = plan('First, tell me what you measured.', st).filter((x) => x.type === 'count')
    const b = plan('Second, how much did it improve?', st).filter((x) => x.type === 'count')
    expect(a.map((x) => x.n)).toEqual([1])
    expect(b.map((x) => x.n)).toEqual([2])
    const c = plan('Finally, what would you change?', st).filter((x) => x.type === 'count')
    expect(c.map((x) => x.n)).toEqual([3])
    expect(plan('Your first project sounds fun.', {}).some((x) => x.type === 'count')).toBe(false)
  })
  it('beats on stressed words, spaced out and alternating hands', () => {
    const g = plan('That is really important, specifically the architecture and implementation decisions you personally made.')
    const beats = g.filter((x) => x.type === 'beat')
    expect(beats.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].t - beats[i - 1].t).toBeGreaterThanOrEqual(850 - 1)
      expect(beats[i].hand).not.toBe(beats[i - 1].hand)
    }
    expect(isStressed('really')).toBe(true)
    expect(isStressed('the')).toBe(false)
    expect(isStressed('implementation')).toBe(true)
  })
  it('arm rig connects shoulder → elbow → hand within limits', () => {
    const sh = { x: 80, y: 182 }
    const seg = armSegments(sh, { x: 69, y: 238 }, { x: 101, y: 252 })
    const fk = armFK(sh, seg.a1, seg.a2, seg.len1, seg.len2)
    expect(fk.hand.x).toBeCloseTo(101, 3)
    expect(fk.hand.y).toBeCloseTo(252, 3)
    const far = armSegments(sh, { x: 80, y: 400 }, { x: 80, y: 600 }, { L1: 62, L2: 80 })
    expect(far.len1).toBeLessThanOrEqual(62.001)
    expect(far.len2).toBeLessThanOrEqual(80.001)
    expect(boneAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0)
    expect(countFingers(2)).toEqual([1, 1, 0.3, 0.3, 0.45])
  })
  it('backchannel nods after a stretch of talking then a pause, with spacing', () => {
    const bc = new Backchannel({ rng: seeded(3) })
    bc.reset(0)
    const nods = []
    // talk 1.5 s, pause 0.6 s, repeat
    for (let t = 0; t < 12000; t += 50) {
      const voiced = t % 2100 < 1500
      for (const e of bc.update(t, { level: voiced ? 0.2 : 0.0, words: 0 })) if (e.type === 'nod') nods.push(t)
    }
    expect(nods.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < nods.length; i++) expect(nods[i] - nods[i - 1]).toBeGreaterThan(2200)
  })
  it('backchannel also reacts to recognised/typed words', () => {
    const bc = new Backchannel({ rng: seeded(5) })
    bc.reset(0)
    const ev = bc.update(3000, { level: 0, words: 10 })
    expect(ev.some((e) => e.type === 'nod')).toBe(true)
  })
})

describe('performer', () => {
  it('produces finite poses in every mode and respects expressive off', () => {
    const p = new AriaPerformer({ rng: seeded(2) })
    let t = 0
    for (const mode of ['idle', 'listening', 'thinking', 'speaking']) {
      p.setMode(mode)
      if (mode === 'speaking') p.utterStart('First, how did you test it?', {}, t)
      for (let i = 0; i < 60; i++) {
        const pose = p.frame((t += 16))
        for (const v of [pose.mouth.open, pose.head.roll, pose.arms.R.a1, pose.arms.L.len2, pose.eyes.x]) expect(Number.isFinite(v)).toBe(true)
      }
    }
    // thinking pose raises the right hand toward the chin
    p.utterEnd(t); p.setMode('thinking')
    for (let i = 0; i < 120; i++) p.frame((t += 16))
    expect(p.s.hands.R.y).toBeLessThan(190)
    // expressive off: no hand-to-chin, hands stay down
    p.setExpressive(false)
    for (let i = 0; i < 160; i++) p.frame((t += 16))
    expect(p.s.hands.R.y).toBeGreaterThan(230)
  })
  it('mouth moves while speaking and closes after the utterance ends', () => {
    const p = new AriaPerformer({ rng: seeded(4) })
    p.setMode('speaking')
    p.utterStart('Okay, what was the hardest part of that project?', {}, 0)
    let maxOpen = 0
    let t = 0
    for (; t < 1500; t += 16) maxOpen = Math.max(maxOpen, p.frame(t).mouth.open)
    expect(maxOpen).toBeGreaterThan(0.4)
    p.utterEnd(t)
    let last
    for (let i = 0; i < 40; i++) last = p.frame((t += 16))
    expect(last.mouth.open).toBeLessThan(0.05)
  })
})
