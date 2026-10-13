import React, { useEffect, useMemo, useRef } from 'react'
import { AriaPerformer, RIG } from './performer.js'

/**
 * "Aria" — an original illustrated interviewer, drawn in SVG (head, torso,
 * two jointed arms with hands on a desk).
 *
 * All motion comes from an `AriaPerformer` (see performer.js): live lip sync
 * from the text being spoken, IK arm gestures, blinks, saccades, nods,
 * breathing. A requestAnimationFrame loop writes the pose straight into SVG
 * attributes, so React does not re-render per frame (phone friendly).
 *
 * Props
 *  - state: idle | speaking | listening | thinking (halo + body mode)
 *  - performer: shared AriaPerformer (the interview room feeds it speech events);
 *    if omitted an idle one is created (e.g. on the welcome card)
 *  - mouth: 'smile' holds a friendly smile while idle (welcome card)
 *  - size: tile width in px (height keeps the 240×270 aspect)
 */

const HEAD = RIG.head
const MOUTH_C = { x: 100, y: 133.5 }

export function mouthGeometry(m) {
  const smile = m.smile || 0
  const cx = MOUTH_C.x
  const cy = MOUTH_C.y - smile * 0.5
  const hw = 12.2 * m.wide * (1 - 0.3 * m.round) * (1 + 0.1 * smile)
  const op = 18.5 * m.open
  const cornerY = cy - smile * 3.2
  const iu = op * 0.3 + m.round * op * 0.15
  const id = Math.max(0, op * 0.7 + m.round * op * 0.1 - m.lowerIn * 2.2)
  const ut = 2.3 * (1 - m.press * 0.45)
  const lt = 3.1 * (1 - m.press * 0.4) - m.lowerIn * 0.6
  const kx = 0.55 + m.round * 0.25
  const f = (n) => n.toFixed(2)
  const lips =
    `M${f(cx - hw - 1.2)} ${f(cornerY)} ` +
    `C${f(cx - hw * kx)} ${f(cy - iu - ut - 1.3)} ${f(cx - 1.6)} ${f(cy - iu - ut - 1.6)} ${f(cx)} ${f(cy - iu - ut - 0.6)} ` +
    `C${f(cx + 1.6)} ${f(cy - iu - ut - 1.6)} ${f(cx + hw * kx)} ${f(cy - iu - ut - 1.3)} ${f(cx + hw + 1.2)} ${f(cornerY)} ` +
    `C${f(cx + hw * kx)} ${f(cy + id + lt + 1)} ${f(cx - hw * kx)} ${f(cy + id + lt + 1)} ${f(cx - hw - 1.2)} ${f(cornerY)}Z`
  const inner =
    `M${f(cx - hw)} ${f(cornerY + 0.2)} ` +
    `C${f(cx - hw * kx * 0.9)} ${f(cy - iu)} ${f(cx + hw * kx * 0.9)} ${f(cy - iu)} ${f(cx + hw)} ${f(cornerY + 0.2)} ` +
    `C${f(cx + hw * kx * 0.9)} ${f(cy + id)} ${f(cx - hw * kx * 0.9)} ${f(cy + id)} ${f(cx - hw)} ${f(cornerY + 0.2)}Z`
  return { lips, inner, hw, cx, cy, iu, id }
}

function applyPose(el, p) {
  const { mouth, head, body, brows, eyes, arms } = p
  const set = (node, attr, v) => node && node.setAttribute(attr, v)
  // whole character: lean-in + sway (pivot at the desk)
  set(el.char, 'transform', `translate(120 270) scale(${(1 + body.lean * 0.03).toFixed(4)}) rotate(${(body.sway * 0.5).toFixed(3)}) translate(-120 -270)`)
  set(el.torso, 'transform', `translate(0 ${(-body.breath * 0.5).toFixed(2)})`)
  // head: roll around the neck, nod = drop + chin tuck
  set(el.head, 'transform', `rotate(${head.roll.toFixed(2)} ${RIG.neck.x} ${RIG.neck.y}) translate(${HEAD.x} ${(HEAD.y + head.nod * 2 + head.y - body.breath * 0.4).toFixed(2)})`)
  set(el.features, 'transform', `translate(${(head.yaw * 2.4).toFixed(2)} ${(head.nod * 1.5).toFixed(2)})`)
  set(el.hairBack, 'transform', `translate(${(-head.yaw * 0.9).toFixed(2)} 0)`)
  // jaw follows the mouth opening
  set(el.face, 'ry', (46 + mouth.open * 2.4).toFixed(2))
  set(el.face, 'cy', (100 + mouth.open * 1.2).toFixed(2))
  // mouth
  const g = mouthGeometry(mouth)
  set(el.lips, 'd', g.lips)
  set(el.inner, 'd', g.inner)
  set(el.mclip, 'd', g.inner)
  set(el.teeth, 'x', (g.cx - g.hw).toFixed(2))
  set(el.teeth, 'width', (g.hw * 2).toFixed(2))
  set(el.teeth, 'y', (g.cy - g.iu - 1).toFixed(2))
  set(el.teeth, 'height', (0.01 + mouth.teeth * 4.2 + mouth.lowerIn * 1.5).toFixed(2))
  set(el.tongue, 'cy', (g.cy + g.id + 1.2 - mouth.tongue * 2.2).toFixed(2))
  set(el.tongue, 'rx', (g.hw * 0.62).toFixed(2))
  set(el.tongue, 'opacity', Math.min(1, mouth.open * 3).toFixed(2))
  set(el.cheeks, 'transform', `translate(0 ${(-mouth.smile * 1.6).toFixed(2)})`)
  // brows
  set(el.browL, 'transform', `translate(0 ${(-brows.l * 3.2 + brows.furrow * 0.8).toFixed(2)}) rotate(${(brows.furrow * 6).toFixed(2)} 92 85)`)
  set(el.browR, 'transform', `translate(0 ${(-brows.r * 3.2 + brows.furrow * 0.8).toFixed(2)}) rotate(${(-brows.furrow * 6).toFixed(2)} 108 85)`)
  // eyes
  const sy = (1 - eyes.blink * 0.9).toFixed(3)
  set(el.eyeL, 'transform', `translate(85 99) scale(1 ${sy}) translate(-85 -99)`)
  set(el.eyeR, 'transform', `translate(115 99) scale(1 ${sy}) translate(-115 -99)`)
  const gaze = `translate(${eyes.x.toFixed(2)} ${eyes.y.toFixed(2)})`
  set(el.pupilL, 'transform', gaze)
  set(el.pupilR, 'transform', gaze)
  set(el.lids, 'transform', `translate(0 ${(eyes.blink * 5.2).toFixed(2)})`)
  // arms (foreshortening rig: bone lengths vary)
  for (const side of ['R', 'L']) {
    const a = arms[side]
    const sh = RIG.shoulder[side]
    set(el[`up${side}`], 'transform', `translate(${sh.x} ${(sh.y - body.breath * 0.7).toFixed(2)}) rotate(${a.a1.toFixed(2)})`)
    const l1 = a.len1.toFixed(2)
    set(el[`u1${side}`], 'y2', l1)
    set(el[`u2${side}`], 'y2', l1)
    set(el[`u3${side}`], 'y2', Math.max(4, a.len1 - 4).toFixed(2))
    set(el[`fo${side}`], 'transform', `translate(0 ${l1}) rotate(${a.a2.toFixed(2)})`)
    const l2 = Math.max(0, a.len2 - 2).toFixed(2)
    set(el[`f1${side}`], 'y2', l2)
    set(el[`f2${side}`], 'y2', l2)
    set(el[`cf${side}`], 'y', (a.len2 - 5).toFixed(2))
    set(el[`hd${side}`], 'transform', `translate(0 ${(a.len2 + 1).toFixed(2)}) rotate(${a.ha.toFixed(2)}) scale(${(1.2 * a.hs).toFixed(3)})`)
    for (let i = 0; i < 5; i++) {
      const len = FINGER_LEN[i]
      set(el[`f${side}${i}`], 'height', (len * (0.28 + 0.72 * a.f[i])).toFixed(2))
    }
  }
}

const FINGER_LEN = [10.5, 11.5, 10.5, 8.5, 9]

function Hand({ side, r }) {
  const s = side === 'R' ? 1 : -1 // thumb side flips between hands
  const xs = [-4.7 * s, -1.6 * s, 1.6 * s, 4.6 * s]
  return (
    <g>
      {xs.map((x, i) => (
        <g key={i} transform={`translate(${x} 10.5) rotate(${(i - 1.5) * 3 * s})`}>
          <rect ref={r(`f${side}${i}`)} x="-1.85" y="0" width="3.7" height={FINGER_LEN[i] * 0.6} rx="1.85" fill="url(#ariaSkin)" stroke="#c98d6a" strokeWidth="0.6" />
        </g>
      ))}
      <g transform={`translate(${-6.6 * s} 4.5) rotate(${48 * s})`}>
        <rect ref={r(`f${side}4`)} x="-2" y="0" width="4" height={FINGER_LEN[4] * 0.6} rx="2" fill="url(#ariaSkin)" stroke="#c98d6a" strokeWidth="0.6" />
      </g>
      <ellipse cx="0" cy="6.5" rx="7.2" ry="7.6" fill="url(#ariaSkin)" stroke="#c98d6a" strokeWidth="0.6" />
    </g>
  )
}

function Arm({ side, r }) {
  // solid strokes: gradients on zero-width line bboxes don't render
  const hx = side === 'R' ? -3 : 3
  return (
    <g ref={r(`up${side}`)}>
      <line ref={r(`u1${side}`)} x1="0" y1="0" x2="0" y2="56" stroke="#0a4f60" strokeWidth="17" strokeLinecap="round" />
      <line ref={r(`u2${side}`)} x1="0" y1="0" x2="0" y2="56" stroke="#14809a" strokeWidth="14.5" strokeLinecap="round" />
      <line ref={r(`u3${side}`)} x1={hx} y1="4" x2={hx} y2="52" stroke="#1a93ad" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <g ref={r(`fo${side}`)} transform="translate(0 56)">
        <line ref={r(`f1${side}`)} x1="0" y1="0" x2="0" y2="40" stroke="#0a4f60" strokeWidth="15" strokeLinecap="round" />
        <line ref={r(`f2${side}`)} x1="0" y1="0" x2="0" y2="40" stroke="#14809a" strokeWidth="12.5" strokeLinecap="round" />
        <rect ref={r(`cf${side}`)} x="-6.6" y="37" width="13.2" height="5" rx="2.2" fill="#f7f3ee" />
        <g ref={r(`hd${side}`)} transform="translate(0 43) scale(1.2)">
          <Hand side={side} r={r} />
        </g>
      </g>
    </g>
  )
}

export default function AvatarCharacter({ state = 'idle', performer, mouth, name = 'Aria', size = 240, onTap }) {
  const own = useMemo(() => (performer ? null : new AriaPerformer()), [performer])
  const perf = performer || own
  const els = useRef({})
  const r = (k) => (node) => { els.current[k] = node }
  const uid = useMemo(() => `a${Math.random().toString(36).slice(2, 8)}`, [])

  useEffect(() => { perf.setMode(state) }, [perf, state])
  useEffect(() => { perf.hold = mouth === 'smile' ? 'smile' : null }, [perf, mouth])

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    const upd = () => perf.setReducedMotion(!!(mq && mq.matches))
    upd()
    mq && mq.addEventListener && mq.addEventListener('change', upd)
    let raf = 0
    const loop = (now) => {
      applyPose(els.current, perf.frame(now))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      mq && mq.removeEventListener && mq.removeEventListener('change', upd)
    }
  }, [perf])

  const h = Math.round((size * RIG.H) / RIG.W)
  return (
    <button
      type="button"
      className={`aria-avatar aria-${state}`}
      style={{ width: size, height: h }}
      onClick={onTap}
      aria-label={`${name} — ${state}`}
    >
      <span className="aria-halo" />
      {state === 'thinking' && <span className="aria-think" aria-hidden="true"><i /><i /><i /></span>}
      <svg viewBox={`0 0 ${RIG.W} ${RIG.H}`} className="aria-svg" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="ariaBg" cx="50%" cy="32%" r="80%">
            <stop offset="0" stopColor="#24557f" />
            <stop offset="0.6" stopColor="#123150" />
            <stop offset="1" stopColor="#0a1d31" />
          </radialGradient>
          <linearGradient id="ariaSkin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4c9a8" />
            <stop offset="1" stopColor="#e3ab86" />
          </linearGradient>
          <linearGradient id="ariaHair" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b2417" />
            <stop offset="1" stopColor="#1e120b" />
          </linearGradient>
          <linearGradient id="ariaJacket" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#13788f" />
            <stop offset="1" stopColor="#0c5466" />
          </linearGradient>
          <linearGradient id="ariaSleeve" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0f6a7f" />
            <stop offset="0.5" stopColor="#168aa3" />
            <stop offset="1" stopColor="#0f6a7f" />
          </linearGradient>
          <clipPath id={`${uid}frame`}><rect x="0" y="0" width={RIG.W} height={RIG.H} rx="26" /></clipPath>
          <clipPath id={`${uid}eyeL`}><ellipse cx="85" cy="99" rx="6.4" ry="7.2" /></clipPath>
          <clipPath id={`${uid}eyeR`}><ellipse cx="115" cy="99" rx="6.4" ry="7.2" /></clipPath>
          <clipPath id={`${uid}mouth`}><path ref={r('mclip')} d="M88 133 L112 133 Z" /></clipPath>
        </defs>
        <g clipPath={`url(#${uid}frame)`}>
          <rect x="0" y="0" width={RIG.W} height={RIG.H} fill="url(#ariaBg)" />
          {/* soft backdrop: window light + shelf */}
          <rect x="164" y="26" width="58" height="84" rx="6" fill="#ffffff" opacity="0.05" />
          <rect x="18" y="40" width="44" height="4" rx="2" fill="#ffffff" opacity="0.06" />
          <circle cx="40" cy="34" r="7" fill="#2dd4bf" opacity="0.10" />
          <g ref={r('char')}>
            <g ref={r('torso')}>
              <path d="M38 272 Q42 198 82 174 L106 162 L134 162 L158 174 Q198 198 202 272 Z" fill="url(#ariaJacket)" />
              <path d="M106 162 L120 194 L134 162 Z" fill="#f7f3ee" />
              <path d="M106 162 L115 208 L120 194 Z M134 162 L125 208 L120 194 Z" fill="#0e6276" />
              <path d="M108 134 L108 158 Q120 167 132 158 L132 134 Z" fill="#d99c78" />
            </g>
            {/* desk */}
            <rect x="0" y="257" width={RIG.W} height="16" fill="#0b2034" />
            <rect x="0" y="257" width={RIG.W} height="1.6" fill="#2b5578" opacity="0.8" />
            <g ref={r('head')} transform={`translate(${HEAD.x} ${HEAD.y})`}>
              <g ref={r('hairBack')}>
                <path d="M52 92 Q48 40 100 34 Q152 40 148 92 L150 140 Q132 150 124 128 L76 128 Q68 150 50 140 Z" fill="url(#ariaHair)" />
              </g>
              <ellipse ref={r('face')} cx="100" cy="100" rx="38" ry="46" fill="url(#ariaSkin)" />
              <ellipse cx="62" cy="104" rx="6" ry="9" fill="#e3ab86" />
              <ellipse cx="138" cy="104" rx="6" ry="9" fill="#e3ab86" />
              <circle cx="62" cy="116" r="2.4" fill="#f5a524" />
              <circle cx="138" cy="116" r="2.4" fill="#f5a524" />
              <g ref={r('features')}>
                {/* eyes (pupils clipped to the whites; whole eye squashes on blinks) */}
                <g ref={r('eyeL')}>
                  <ellipse cx="85" cy="99" rx="6.4" ry="7.2" fill="#fff" />
                  <g clipPath={`url(#${uid}eyeL)`}>
                    <g ref={r('pupilL')}>
                      <circle cx="86" cy="100" r="4.2" fill="#3a2a1f" />
                      <circle cx="87.4" cy="98.4" r="1.4" fill="#fff" />
                    </g>
                  </g>
                </g>
                <g ref={r('eyeR')}>
                  <ellipse cx="115" cy="99" rx="6.4" ry="7.2" fill="#fff" />
                  <g clipPath={`url(#${uid}eyeR)`}>
                    <g ref={r('pupilR')}>
                      <circle cx="116" cy="100" r="4.2" fill="#3a2a1f" />
                      <circle cx="117.4" cy="98.4" r="1.4" fill="#fff" />
                    </g>
                  </g>
                </g>
                {/* eyelids: skin-coloured lids slide down on blinks */}
                <g ref={r('lids')}>
                  <path d="M77 91 Q85 86 93 91 L93 92.6 Q85 88.6 77 92.6 Z" fill="#e8b693" />
                  <path d="M107 91 Q115 86 123 91 L123 92.6 Q115 88.6 107 92.6 Z" fill="#e8b693" />
                  <path d="M78 92.4 Q85 88.4 92 92.4" stroke="#2a1910" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  <path d="M108 92.4 Q115 88.4 122 92.4" stroke="#2a1910" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                </g>
                {/* brows */}
                <g ref={r('browL')}><path d="M76 86 Q84 81 92 85" stroke="#2a1910" strokeWidth="3" fill="none" strokeLinecap="round" /></g>
                <g ref={r('browR')}><path d="M108 85 Q116 81 124 86" stroke="#2a1910" strokeWidth="3" fill="none" strokeLinecap="round" /></g>
                {/* nose + cheeks */}
                <path d="M100 104 Q97 116 101 118" stroke="#c98d6a" strokeWidth="2" fill="none" strokeLinecap="round" />
                <g ref={r('cheeks')}>
                  <ellipse cx="78" cy="119" rx="7" ry="4" fill="#ef9a8a" opacity="0.35" />
                  <ellipse cx="122" cy="119" rx="7" ry="4" fill="#ef9a8a" opacity="0.35" />
                </g>
                {/* mouth: lips, dark opening, teeth + tongue clipped to the opening */}
                <path ref={r('lips')} d="M86 133 Q100 137 114 133 Z" fill="#c4646d" />
                <path ref={r('inner')} d="M88 133 L112 133 Z" fill="#5c1b26" stroke="#7a2531" strokeWidth="1.3" strokeLinejoin="round" />
                <g clipPath={`url(#${uid}mouth)`}>
                  <ellipse ref={r('tongue')} cx="100" cy="140" rx="7" ry="3.6" fill="#e07a86" opacity="0" />
                  <rect ref={r('teeth')} x="88" y="131" width="24" height="0" rx="1.2" fill="#fbf7f2" />
                </g>
              </g>
              {/* fringe drawn over the forehead/brows edge */}
              <path d="M60 86 Q66 50 104 50 Q140 52 142 86 Q124 70 104 72 Q86 66 72 80 Q66 86 60 86 Z" fill="url(#ariaHair)" />
              {/* headset mic */}
              <path d="M60 100 Q58 128 84 134" stroke="#0b1f33" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <circle cx="86" cy="134" r="3" fill="#0b1f33" />
            </g>
            <Arm side="L" r={r} />
            <Arm side="R" r={r} />
          </g>
        </g>
        <rect x="1" y="1" width={RIG.W - 2} height={RIG.H - 2} rx="25" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
      </svg>
    </button>
  )
}
