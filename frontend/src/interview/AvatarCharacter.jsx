import React, { useEffect, useRef, useState } from 'react'

/**
 * "Aria" — an original illustrated interviewer character drawn in SVG.
 * Lip-sync: the parent passes word events; we turn each word into a short
 * sequence of mouth shapes (visemes). Eyes blink on a random timer, the head
 * sways gently, and the halo shows state (listening / thinking / speaking).
 */

const MOUTHS = {
  rest: 'M86 132 Q100 140 114 132',
  M: 'M88 133 Q100 135 112 133',
  small: 'M89 131 Q100 141 111 131 Q100 136 89 131 Z',
  E: 'M85 130 Q100 142 115 130 Q100 137 85 130 Z',
  A: 'M88 129 Q100 150 112 129 Q100 134 88 129 Z',
  O: 'M93 128 Q100 146 107 128 Q100 124 93 128 Z',
  smile: 'M84 130 Q100 146 116 130 Q100 138 84 130 Z',
}

export function visemesForWord(word) {
  const w = (word || '').toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return ['small']
  const seq = []
  for (const ch of w) {
    let v = 'small'
    if ('aih'.includes(ch)) v = 'A'
    else if ('e'.includes(ch)) v = 'E'
    else if ('ouwq'.includes(ch)) v = 'O'
    else if ('mbp'.includes(ch)) v = 'M'
    else if ('fv'.includes(ch)) v = 'M'
    if (seq[seq.length - 1] !== v) seq.push(v)
  }
  return seq.slice(0, 4)
}

export function useLipSync() {
  const [mouth, setMouth] = useState('rest')
  const timers = useRef([])

  function clear() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  function onWord({ word, est = 300 }) {
    clear()
    const seq = visemesForWord(word)
    const step = Math.max(55, Math.min(140, est / (seq.length + 1)))
    seq.forEach((v, i) => timers.current.push(setTimeout(() => setMouth(v), i * step)))
    timers.current.push(setTimeout(() => setMouth('small'), seq.length * step))
  }

  function reset(to = 'rest') {
    clear()
    setMouth(to)
  }

  useEffect(() => clear, [])
  return { mouth, onWord, reset }
}

export default function AvatarCharacter({ state = 'idle', mouth = 'rest', level = 0, name = 'Aria', size = 220, onTap }) {
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    let t
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true)
        setTimeout(() => setBlink(false), 130)
        loop()
      }, 2200 + Math.random() * 2600)
    }
    loop()
    return () => clearTimeout(t)
  }, [])

  const listeningScale = state === 'listening' ? 1 + Math.min(level * 3.2, 0.14) : 1
  const browLift = state === 'speaking' && (mouth === 'A' || mouth === 'O') ? -2 : state === 'thinking' ? -3 : 0
  const eyeLook = state === 'thinking' ? { dx: 3, dy: -3 } : { dx: 0, dy: 0 }
  const d = MOUTHS[mouth] || MOUTHS.rest

  return (
    <button
      type="button"
      className={`aria-avatar aria-${state}`}
      style={{ width: size, height: size }}
      onClick={onTap}
      aria-label={`${name} — ${state}`}
    >
      <span className="aria-halo" style={{ transform: `scale(${listeningScale})` }} />
      {state === 'thinking' && <span className="aria-orbit" />}
      <svg viewBox="0 0 200 200" className="aria-svg" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="ariaBg" cx="50%" cy="40%" r="65%">
            <stop offset="0" stopColor="#1f4e79" />
            <stop offset="1" stopColor="#0b1f33" />
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
          <clipPath id="ariaClip"><circle cx="100" cy="100" r="98" /></clipPath>
        </defs>
        <circle cx="100" cy="100" r="98" fill="url(#ariaBg)" />
        <g clipPath="url(#ariaClip)">
          {/* shoulders + jacket */}
          <path d="M28 205 Q34 160 76 152 L124 152 Q166 160 172 205 Z" fill="url(#ariaJacket)" />
          <path d="M84 152 L100 178 L116 152 Z" fill="#f7f3ee" />
          <path d="M84 152 L94 186 L100 178 Z M116 152 L106 186 L100 178 Z" fill="#0e6276" />
          {/* neck */}
          <path d="M88 136 L88 156 Q100 164 112 156 L112 136 Z" fill="#d99c78" />
          <g className="aria-head">
            {/* back hair */}
            <path d="M52 92 Q48 40 100 34 Q152 40 148 92 L150 140 Q132 150 124 128 L76 128 Q68 150 50 140 Z" fill="url(#ariaHair)" />
            {/* face */}
            <ellipse cx="100" cy="100" rx="38" ry="46" fill="url(#ariaSkin)" />
            {/* ears + earrings */}
            <ellipse cx="62" cy="104" rx="6" ry="9" fill="#e3ab86" />
            <ellipse cx="138" cy="104" rx="6" ry="9" fill="#e3ab86" />
            <circle cx="62" cy="116" r="2.4" fill="#f5a524" />
            <circle cx="138" cy="116" r="2.4" fill="#f5a524" />
            {/* fringe */}
            <path d="M60 86 Q66 50 104 50 Q140 52 142 86 Q124 70 104 72 Q86 66 72 80 Q66 86 60 86 Z" fill="url(#ariaHair)" />
            {/* brows */}
            <g transform={`translate(0 ${browLift})`} style={{ transition: 'transform 160ms ease' }}>
              <path d="M76 86 Q84 81 92 85" stroke="#2a1910" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M108 85 Q116 81 124 86" stroke="#2a1910" strokeWidth="3" fill="none" strokeLinecap="round" />
            </g>
            {/* eyes */}
            <g style={{ transform: `translate(${eyeLook.dx}px, ${eyeLook.dy}px)`, transition: 'transform 300ms ease' }}>
              {blink ? (
                <>
                  <path d="M78 99 Q85 102 92 99" stroke="#2a1910" strokeWidth="2.6" fill="none" strokeLinecap="round" />
                  <path d="M108 99 Q115 102 122 99" stroke="#2a1910" strokeWidth="2.6" fill="none" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <ellipse cx="85" cy="99" rx="6.4" ry="7.2" fill="#fff" />
                  <ellipse cx="115" cy="99" rx="6.4" ry="7.2" fill="#fff" />
                  <circle cx="86" cy="100" r="4.2" fill="#3a2a1f" />
                  <circle cx="116" cy="100" r="4.2" fill="#3a2a1f" />
                  <circle cx="87.4" cy="98.4" r="1.4" fill="#fff" />
                  <circle cx="117.4" cy="98.4" r="1.4" fill="#fff" />
                </>
              )}
            </g>
            {/* nose + cheeks */}
            <path d="M100 104 Q97 116 101 118" stroke="#c98d6a" strokeWidth="2" fill="none" strokeLinecap="round" />
            <ellipse cx="78" cy="118" rx="7" ry="4" fill="#ef9a8a" opacity="0.35" />
            <ellipse cx="122" cy="118" rx="7" ry="4" fill="#ef9a8a" opacity="0.35" />
            {/* mouth */}
            <path d={d} fill={mouth === 'rest' || mouth === 'M' ? 'none' : '#8f2f3a'} stroke="#7a2531" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" style={{ transition: 'd 70ms linear' }} />
            {/* headset mic */}
            <path d="M60 100 Q58 128 84 134" stroke="#0b1f33" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <circle cx="86" cy="134" r="3" fill="#0b1f33" />
          </g>
        </g>
        <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      </svg>
    </button>
  )
}
