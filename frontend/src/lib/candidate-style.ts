export type CandidateStyle = {
  verbosity: 'brief' | 'balanced' | 'detailed'
  confidence: 'hesitant' | 'balanced' | 'confident'
  depth: 'high_level' | 'balanced' | 'technical'
  tone: 'calm' | 'balanced' | 'stressed'
}

const FILLER_PATTERN = /\b(um+|uh+|er+|like|you know|i guess|maybe|sort of|kind of)\b/gi
const HESITANT_PATTERN = /\b(i think|not sure|probably|hopefully|sorry|nervous|anxious)\b/gi
const CONFIDENT_PATTERN = /\b(i led|i owned|i delivered|we achieved|resulted in|improved|reduced|increased|\d+%|\d+ users)\b/gi
const TECHNICAL_PATTERN =
  /\b(api|architecture|database|latency|throughput|refactor|deploy|ci\/cd|microservice|schema|algorithm|typescript|react|kubernetes|aws|pipeline|backend|frontend|infrastructure|debug|profil)\b/gi
const STRESSED_PATTERN = /\b(sorry|nervous|stress|anxious|overwhelmed|hard to explain|rushed)\b/gi

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function scoreFromAnswers(answers: string[]): CandidateStyle {
  if (!answers.length) {
    return {
      verbosity: 'balanced',
      confidence: 'balanced',
      depth: 'balanced',
      tone: 'calm',
    }
  }

  const combined = answers.join(' ')
  const words = wordCount(combined)
  const avgWords = words / answers.length
  const fillerHits = (combined.match(FILLER_PATTERN) ?? []).length
  const hesitantHits = (combined.match(HESITANT_PATTERN) ?? []).length
  const confidentHits = (combined.match(CONFIDENT_PATTERN) ?? []).length
  const technicalHits = (combined.match(TECHNICAL_PATTERN) ?? []).length
  const stressedHits = (combined.match(STRESSED_PATTERN) ?? []).length

  const verbosity: CandidateStyle['verbosity'] =
    avgWords < 22 ? 'brief' : avgWords > 55 ? 'detailed' : 'balanced'

  const confidence: CandidateStyle['confidence'] =
    hesitantHits + fillerHits > confidentHits + 1
      ? 'hesitant'
      : confidentHits >= 2
        ? 'confident'
        : 'balanced'

  const depth: CandidateStyle['depth'] =
    technicalHits >= 3 ? 'technical' : technicalHits === 0 && avgWords < 30 ? 'high_level' : 'balanced'

  const tone: CandidateStyle['tone'] = stressedHits >= 2 ? 'stressed' : 'calm'

  return { verbosity, confidence, depth, tone }
}

export function analyzeCandidateStyle(priorQA: { question: string; answer: string }[]): CandidateStyle {
  return scoreFromAnswers(priorQA.map((item) => item.answer))
}

export function styleGuidance(style: CandidateStyle): string {
  const lines: string[] = []

  if (style.verbosity === 'brief') {
    lines.push('Candidate answers briefly — ask focused probes for one concrete example and one metric.')
  } else if (style.verbosity === 'detailed') {
    lines.push('Candidate is detailed — ask sharper tradeoff or decision questions, not broad repeats.')
  }

  if (style.confidence === 'hesitant') {
    lines.push('Candidate sounds hesitant — use warmer, shorter questions with one clear ask and optional brief transition like "Okay." or "Got it."')
  } else if (style.confidence === 'confident') {
    lines.push('Candidate is confident — go one level deeper on architecture, ownership, or scenario judgment.')
  }

  if (style.depth === 'technical') {
    lines.push('Candidate uses technical depth — probe implementation choices, constraints, and failure modes.')
  } else if (style.depth === 'high_level') {
    lines.push('Candidate stays high-level — ask for a specific example with steps and outcome.')
  }

  if (style.tone === 'stressed') {
    lines.push('Candidate may be stressed — keep pacing calm, one question only, no stacked asks.')
  }

  return lines.join(' ')
}
