/**
 * Risk engine — connects real CV signals to a weighted risk score.
 * High risk requires corroboration except phone/spoof standalone signals.
 */

export type ProctoringEvent = {
  type: string
  severity: 'low' | 'medium' | 'high'
  metadata: Record<string, unknown>
  timestamp: string
}

export type RiskOutput = {
  score: number
  level: 'low' | 'medium' | 'high'
  breakdown: Record<string, number>
  evidenceCount: number
  timestamp: number
}

const SIGNAL_WEIGHTS: Record<string, number> = {
  phoneDetected: 50,
  multipleFaces: 30,
  spoofSuspected: 50,
  faceLeftFrame: 20,
  personAbsent: 20,
  repeatedOffScreenGaze: 15,
  tabSwitched: 15,
  longDownwardGaze: 10,
  slouching: 8,
  leaning: 6,
  darkLighting: 12,
  continuousFaceVisible: -5,
  goodLighting: -3,
}

const STANDALONE_HIGH_SIGNALS = new Set(['phoneDetected', 'spoofSuspected'])

const CONCERN_SIGNALS = [
  'multipleFaces',
  'faceLeftFrame',
  'personAbsent',
  'repeatedOffScreenGaze',
  'tabSwitched',
  'longDownwardGaze',
  'slouching',
  'leaning',
  'darkLighting',
] as const

const HIGH_RISK_THRESHOLD = 60
const MEDIUM_RISK_THRESHOLD = 30

function countActiveConcerns(signals: Record<string, boolean | number>): number {
  return CONCERN_SIGNALS.filter((key) => signals[key] === true || signals[key] === 1).length
}

export function calculateRiskScore(params: {
  events: ProctoringEvent[]
  currentSignals: Record<string, boolean | number>
}): RiskOutput {
  const { currentSignals, events } = params

  const breakdown: Record<string, number> = {}
  let rawScore = 0

  for (const [signal, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const value = currentSignals[signal]
    if (value === true || value === 1) {
      breakdown[signal] = Math.abs(weight)
      rawScore += weight
    }
  }

  const now = Date.now()
  const recentHighSeverity = events.filter(
    (event) =>
      event.severity === 'high' && now - new Date(event.timestamp).getTime() < 60_000,
  ).length
  const eventBoost = Math.min(recentHighSeverity * 5, 20)
  if (eventBoost > 0) {
    breakdown.recentHighSeverityEvents = eventBoost
    rawScore += eventBoost
  }

  let score = Math.min(100, Math.max(0, Math.round(rawScore)))

  // For phoneDetected and spoofSuspected, require at least 2 occurrences in last 60s
  // before treating them as standalone-high when there are no other corroborating concern signals.
  let standaloneHigh = false
  for (const signal of [...STANDALONE_HIGH_SIGNALS]) {
    const present = currentSignals[signal] === true || currentSignals[signal] === 1
    if (!present) continue

    // Map internal signal name to emitted event type
    const eventType = signal === 'phoneDetected' ? 'phone_detected' : signal === 'spoofSuspected' ? 'spoof_suspected' : null
    let occurrences = 0
    if (eventType) {
      occurrences = events.filter(
        (e) => e.type === eventType && now - new Date(e.timestamp).getTime() < 60_000,
      ).length
    }

    const otherConcerns = countActiveConcerns(currentSignals)

    // If there are other corroborating concern signals, allow standalone to count even if single occurrence
    if (otherConcerns >= 1) {
      standaloneHigh = true
      break
    }

    // Otherwise require at least 2 occurrences in last 60s
    if (occurrences >= 2) {
      standaloneHigh = true
      break
    }
  }
  const concernCount = countActiveConcerns(currentSignals)
  const corroborated = standaloneHigh || concernCount >= 2 || recentHighSeverity >= 1

  let level: 'low' | 'medium' | 'high' = 'low'
  if (score >= HIGH_RISK_THRESHOLD && corroborated) {
    level = 'high'
  } else if (score >= MEDIUM_RISK_THRESHOLD || (score >= HIGH_RISK_THRESHOLD && !corroborated)) {
    level = 'medium'
    if (score >= HIGH_RISK_THRESHOLD && !corroborated) {
      score = MEDIUM_RISK_THRESHOLD + 15
      breakdown.corroborationCap = score
    }
  }

  return {
    score,
    level,
    breakdown,
    evidenceCount: events.length,
    timestamp: now,
  }
}

export const HIGH_SEVERITY_EVENT_TYPES = new Set([
  'phone_detected',
  'multiple_faces',
  'face_left_frame',
  'person_absent_from_frame',
  'spoof_suspected',
  'liveness_failed',
  'extra_person',
  'looking_behind',
])
