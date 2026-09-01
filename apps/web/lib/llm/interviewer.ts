import { chatCompletion } from '@/lib/llm/openrouter'
import {
  analyzeCandidateStyle,
  styleGuidance,
  type CandidateStyle,
} from '@/lib/candidate-style'

export type InterviewStepAction = 'follow_up' | 'next_base' | 'complete' | 'ended_by_candidate'

export type InterviewStepResult = {
  action: InterviewStepAction
  question?: string
  nextBaseIndex?: number
  weakAnswerFlag?: boolean
}

export function detectExitIntent(answer: string): boolean {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return false
  const exitPatterns = [
    /\b(let'?s|lets)\s+(end|stop|quit)\b/,
    /\bi'?m\s+(done|finished)\b/,
    /\bi\s+am\s+(done|finished)\b/,
    /\bnot\s+interested\b/,
    /\bwant\s+to\s+(end|stop|quit)\b/,
    /\bend\s+(the\s+)?(interview|test|session)\b/,
    /\bcan\s+we\s+(end|stop)\b/,
    /\bi\s+(want|wish|need)\s+to\s+(leave|exit)\b/,
    /\bstop\s+the\s+interview\b/,
  ]
  return exitPatterns.some((pattern) => pattern.test(normalized))
}

export function detectNonSubstantiveAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return true // empty answer is non-substantive
  
  // Single word or very short non-answers
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length === 1 && words[0].length <= 3) return true // single short word like "idk", "no", "yes"
  
  // Explicit refusal patterns
  const refusalPatterns = [
    /^(idk|i\s*don'?t\s*know|i\s+have\s+no\s+idea|no\s+idea|not\s+sure|n\/a|skip|pass|next)$/,
    /^(end\s+it|let'?s\s+end|quit|stop|done)$/,
  ]
  if (refusalPatterns.some((p) => p.test(normalized))) return true
  
  // Very short answers (under 15 characters) that aren't natural short responses
  if (normalized.length < 15 && !/^(yes|no|i think|i don'?t|good|bad|okay|ok|sure)/.test(normalized)) {
    return true
  }
  
  return false
}

export function detectHostileLanguage(answer: string): boolean {
  const normalized = answer.toLowerCase()
  const hostilePatterns = [
    // Profanity only
    /\b(f[u\*]ck|shit|asshole)\b/,
    // Direct attacks: "you/this/that is/are stupid/idiot/moron"
    /\b(you|this|that)\s+(is|are|'s)\s+(an?\s+)?(stupid|idiot|moron)\b/,
    // Explicit dismissal phrases
    /\b(go to hell|eff you|you suck|this is a waste|waste of my time)\b/,
  ]
  return hostilePatterns.some((pattern) => pattern.test(normalized))
}

export function countRecentNonSubstantiveAnswers(priorQA: { question: string; answer: string }[], currentAnswer: string): number {
  // Count how many of the last 3 answers (including current) are non-substantive
  const recentAnswers = [...priorQA.slice(-2).map((qa) => qa.answer), currentAnswer]
  return recentAnswers.filter((answer) => detectNonSubstantiveAnswer(answer)).length
}

export type DecideNextStepParams = {
  jobTitle: string
  jobDescription: string
  baseQuestions: string[]
  baseQuestionIndex: number
  isFollowUpQuestion: boolean
  currentQuestion: string
  candidateAnswer: string
  priorQA: { question: string; answer: string }[]
  storyCompleteness?: StoryCompleteness
  coveredCompetencies?: Set<string>
}

export type StoryCompleteness = {
  problem: number // 0-1: did they articulate the problem/context?
  action: number // 0-1: did they describe their approach/action?
  metrics: number // 0-1: did they provide data/numbers?
  outcome: number // 0-1: did they state the result/impact?
  impact: number // 0-1: is business/user impact clear?
  tradeoff: number // 0-1: did they mention constraints/tradeoffs?
  validation: number // 0-1: how did they validate success?
}

export function calculateStoryCompleteness(answer: string): StoryCompleteness {
  const normalized = answer.toLowerCase()
  
  // Check for each dimension using keyword patterns
  const problem = /\b(problem|issue|challenge|situation|context|background|why|goal)\b/.test(normalized) ? 1 : 0
  const action = /\b(approach|solution|method|built|designed|created|implemented|developed|decided|action)\b/.test(normalized) ? 1 : 0
  const metrics = /(\d+%|\d+\s*(users|customers|requests|ms|seconds|hours|days|millions?|thousands?)|improvement|reduced|increased|doubled)/.test(normalized) ? 1 : 0
  const outcome = /\b(result|outcome|delivered|shipped|launched|achieved|completed|finished|deployed)\b/.test(normalized) ? 1 : 0
  const impact = /\b(impact|benefit|save|improve|increase|reduce|optimize|performance|efficiency|quality|value|revenue|growth)\b/.test(normalized) ? 1 : 0
  const tradeoff = /\b(tradeoff|compromise|constraint|limitation|downside|risk|complexity|cost|versus|instead|but|however|choose)\b/.test(normalized) ? 1 : 0
  const validation = /\b(validated|measured|tested|verified|monitored|tracked|feedback|metric|learned|analyzed)\b/.test(normalized) ? 1 : 0
  
  return { problem, action, metrics, outcome, impact, tradeoff, validation }
}

export function scoreCompleteness(completeness: StoryCompleteness): number {
  // Weighted average: some dimensions are more critical
  const weights = {
    problem: 0.15,
    action: 0.2,
    metrics: 0.2,
    outcome: 0.15,
    impact: 0.15,
    tradeoff: 0.1,
    validation: 0.05,
  }
  return (
    completeness.problem * weights.problem +
    completeness.action * weights.action +
    completeness.metrics * weights.metrics +
    completeness.outcome * weights.outcome +
    completeness.impact * weights.impact +
    completeness.tradeoff * weights.tradeoff +
    completeness.validation * weights.validation
  )
}

export function detectFrustrationOrClosure(answer: string): boolean {
  const normalized = answer.toLowerCase()
  const frustrationPatterns = [
    /\b(i'?ve\s+already\s+answered|already\s+told|covered\s+this|we'?\s*ve\s+covered)\b/i,
    /\b(going\s+in\s+circles|same\s+question|asked\s+me\s+that|already\s+asked)\b/i,
    /\b(i'?m\s+(done|finished|tired|frustrated)|let'?s\s+move\s+on|think\s+we'?re\s+good|that'?s\s+it)\b/i,
    /\b(i\s+don'?t\s+want\s+to\s+repeat|not\s+going\s+to\s+repeat|stop\s+asking)\b/i,
    /\b(enough|no\s+more|that'?s\s+all|nothing\s+else\s+to\s+add)\b/i,
  ]
  return frustrationPatterns.some((pattern) => pattern.test(normalized))
}

export function extractCompetenciesFromQuestion(question: string): string[] {
  const normalized = question.toLowerCase()
  const competencies: string[] = []
  
  const competencyKeywords = {
    'analytics': /\b(analytic|data|metric|measurement|dashboard|query|sql|python|analysis)\b/,
    'leadership': /\b(lead|team|delegate|mentor|direct|manage|motivat|culture|vision)\b/,
    'communication': /\b(communicat|present|explain|stakeholder|persuad|pitch|discuss|document)\b/,
    'prioritization': /\b(priorit|roadmap|triage|scope|deadline|resource|constraint)\b/,
    'problem-solving': /\b(problem|troubleshoot|debug|solution|algorithm|complex)\b/,
    'technical-depth': /\b(architecure|system|design|api|database|scale|performance|optimization)\b/,
    'ownership': /\b(own|responsible|accountab|took\s+charge|drove|initiated)\b/,
    'collaboration': /\b(collaborat|partner|cross-team|aligned|stakeholder|consensus)\b/,
  }
  
  for (const [comp, pattern] of Object.entries(competencyKeywords)) {
    if (pattern.test(normalized)) {
      competencies.push(comp)
    }
  }
  
  return competencies.length > 0 ? competencies : ['general']
}

const SYSTEM_PROMPT = `You are a skilled human interviewer conducting a live spoken interview.

Rules:
- Respond with JSON only: {"action":"follow_up"|"next_base","question":"..."}
- One question only, 1-2 sentences max, natural spoken English
- Professional, warm, concise — like a real hiring manager
- Adapt tone to the candidateStyle and styleGuidance in the payload
- brief candidate → focused example/metric probes
- detailed candidate → sharper tradeoff/decision questions
- hesitant candidate → warmer shorter questions, optional brief transition ("Okay." "Got it." "Let's go one level deeper.")
- confident technical candidate → deeper architecture/scenario probes
- No markdown, bullets, labels, or "as an AI"
- Never mention scoring, proctoring, risk, or evaluation
- Never repeat a prior question verbatim
- Max one follow-up between base questions (caller enforces this)
- Use follow_up ONLY if the answer lacks critical details: impact metrics, specific ownership, tradeoffs, or concrete examples
- The storyCompletenessScore (0-1) is provided: high scores (>0.8) indicate the candidate has thoroughly covered the topic
- For next_base, return the exact next base question text provided in the payload
- Do not expose chain-of-thought or reasoning`

const TRANSITIONS = ['Okay.', 'Got it.', "Let's go one level deeper."]

import { parseStepResponse, sanitizeQuestion } from './parse-step'

function referenceFromAnswer(answer: string): string {
  const trimmed = answer.trim()
  if (!trimmed) return 'that'
  const firstSentence = trimmed.split(/[.!?]+/).find((part) => part.trim().length > 0)?.trim() ?? trimmed
  const words = firstSentence.split(/\s+/).filter(Boolean)
  if (words.length <= 8) return firstSentence
  return `${words.slice(0, 8).join(' ')}…`
}

function transitionFor(style: CandidateStyle): string {
  if (style.confidence === 'hesitant' || style.tone === 'stressed') return TRANSITIONS[0]
  if (style.depth === 'technical' || style.confidence === 'confident') return TRANSITIONS[2]
  return TRANSITIONS[1]
}

function heuristicFollowUp(params: DecideNextStepParams, style: CandidateStyle): string {
  const hook = referenceFromAnswer(params.candidateAnswer)
  const lead = transitionFor(style)

  if (style.verbosity === 'brief') {
    return `${lead} You mentioned ${hook} — can you give one concrete example with a measurable result?`
  }
  if (style.verbosity === 'detailed' && style.depth === 'technical') {
    return `${lead} On ${hook}, what tradeoff did you accept and why?`
  }
  if (style.confidence === 'hesitant') {
    return `${lead} Could you walk me through one specific moment from ${hook}?`
  }
  if (style.confidence === 'confident' && style.depth === 'technical') {
    return `${lead} How would you scale or harden the approach behind ${hook}?`
  }
  return `${lead} You mentioned ${hook} — what was the measurable outcome, and what tradeoffs did you navigate?`
}

function heuristicNextStep(params: DecideNextStepParams, style: CandidateStyle): InterviewStepResult {
  const wordCount = params.candidateAnswer.split(/\s+/).filter(Boolean).length
  const isLastBase = params.baseQuestionIndex >= params.baseQuestions.length - 1
  const needsFollowUp =
    !params.isFollowUpQuestion &&
    (wordCount < 22 || (style.verbosity === 'brief' && wordCount < 35) || style.depth === 'high_level')

  if (needsFollowUp) {
    return {
      action: 'follow_up',
      question: heuristicFollowUp(params, style),
    }
  }

  if (isLastBase) {
    return { action: 'complete' }
  }

  const nextIndex = params.baseQuestionIndex + 1
  return {
    action: 'next_base',
    question: params.baseQuestions[nextIndex],
    nextBaseIndex: nextIndex,
  }
}

function buildPriorSummary(priorQA: { question: string; answer: string }[]): string {
  if (!priorQA.length) return 'None yet.'
  return priorQA
    .slice(-4)
    .map((item, index) => `Q${index + 1}: ${item.question}\nA${index + 1}: ${item.answer.slice(0, 320)}`)
    .join('\n\n')
}

export async function decideNextInterviewStep(params: DecideNextStepParams): Promise<InterviewStepResult> {
  const isLastBase = params.baseQuestionIndex >= params.baseQuestions.length - 1
  const nextBaseQuestion = params.baseQuestions[params.baseQuestionIndex + 1]
  const candidateStyle = analyzeCandidateStyle(params.priorQA)

  // Immediate exit intent check: must be deterministic and never call the LLM
  if (detectExitIntent(params.candidateAnswer)) {
    return { action: 'ended_by_candidate' }
  }

  // NEW: Disengagement/quit detection (runs before completeness scoring)
  if (detectHostileLanguage(params.candidateAnswer)) {
    console.log('[engine decision: complete] (hostile language detected)')
    return { action: 'complete' }
  }

  // NEW: Non-substantive answer detection
  const isNonSubstantive = detectNonSubstantiveAnswer(params.candidateAnswer)
  if (isNonSubstantive && !params.isFollowUpQuestion) {
    const consecutiveNonSubstantive = countRecentNonSubstantiveAnswers(params.priorQA, params.candidateAnswer)
    // If 3+ consecutive non-substantive answers (current + last 2), end interview early
    if (consecutiveNonSubstantive >= 3) {
      console.log('[engine decision: complete] (3+ consecutive non-substantive answers)')
      return { action: 'complete' }
    }
    // Otherwise skip follow_up and move to next base question
    if (isLastBase) {
      return { action: 'complete' }
    }
    const nextIndex = params.baseQuestionIndex + 1
    console.log('[engine decision: next_base] (non-substantive answer, skipping follow_up)')
    return {
      action: 'next_base',
      question: params.baseQuestions[nextIndex],
      nextBaseIndex: nextIndex,
    }
  }

  // Calculate story completeness for this answer (existing Bug 2 fix)
  const completeness = calculateStoryCompleteness(params.candidateAnswer)
  const completenessScore = scoreCompleteness(completeness)
  
  // Check for frustration or explicit closure signals (existing Bug 2 fix)
  const candidateSignaledDone = detectFrustrationOrClosure(params.candidateAnswer)
  
  // Decision Priority Order (existing Bug 2 fix):
  // (a) candidateSignaledDone → force move on with brief acknowledgment
  if (candidateSignaledDone && !params.isFollowUpQuestion) {
    if (isLastBase) {
      return { action: 'complete' }
    }
    const nextIndex = params.baseQuestionIndex + 1
    console.log(`[engine decision: next_base] (candidate signaled closure) completeness: ${completenessScore.toFixed(2)}`)
    return {
      action: 'next_base',
      question: params.baseQuestions[nextIndex],
      nextBaseIndex: nextIndex,
    }
  }

  // (b) completeness >= 0.8 threshold → force move on (existing Bug 2 fix)
  const completenessThreshold = 0.8
  if (completenessScore >= completenessThreshold && !params.isFollowUpQuestion) {
    if (isLastBase) {
      return { action: 'complete' }
    }
    const nextIndex = params.baseQuestionIndex + 1
    console.log(`[engine decision: next_base] (high completeness: ${completenessScore.toFixed(2)}) → next competency`)
    return {
      action: 'next_base',
      question: params.baseQuestions[nextIndex],
      nextBaseIndex: nextIndex,
    }
  }

  if (params.isFollowUpQuestion) {
    if (isLastBase) return { action: 'complete' }
    const nextIndex = params.baseQuestionIndex + 1
    const wordCount = params.candidateAnswer.trim().split(/\s+/).filter(Boolean).length
    const isNonAnswer = /\b(i\s+don'?t\s+know|no\s+idea|not\s+sure|n\/a)\b/i.test(params.candidateAnswer)
    return {
      action: 'next_base',
      question: params.baseQuestions[nextIndex],
      nextBaseIndex: nextIndex,
      weakAnswerFlag: wordCount < 8 || isNonAnswer,
    }
  }

  // (c) Otherwise → LLM decides follow_up or next_base (with completeness context)
  const userPayload = {
    jobTitle: params.jobTitle,
    jobDescriptionExcerpt: params.jobDescription.slice(0, 800),
    currentBaseQuestion: params.currentQuestion,
    candidateAnswerTranscript: params.candidateAnswer.slice(0, 1400),
    priorQASummary: buildPriorSummary(params.priorQA),
    candidateStyle,
    styleGuidance: styleGuidance(candidateStyle),
    nextBaseQuestion: nextBaseQuestion ?? null,
    isLastBaseQuestion: isLastBase,
    storyCompletenessScore: completenessScore,
    storyCompletenessDetails: completeness,
    decisionGuide: {
      follow_up:
        'Use only if answer lacks critical details: impact metrics, ownership, tradeoffs, or specific example. Must be different from prior questions on same topic.',
      next_base: 'Use if answer is sufficient with good coverage of problem/action/outcome/impact. Set question to nextBaseQuestion exactly.',
    },
  }

  const raw = await chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(userPayload) },
  ])

  if (raw) {
    const parsed = parseStepResponse(raw)
    if (parsed) {
      if (parsed.action === 'follow_up') {
        console.log(`[engine decision: follow_up] completeness: ${completenessScore.toFixed(2)}`)
        return { action: 'follow_up', question: sanitizeQuestion(parsed.question ?? '') }
      }
      if (parsed.action === 'next_base') {
        if (isLastBase) return { action: 'complete' }
        const nextIndex = params.baseQuestionIndex + 1
        console.log(`[engine decision: next_base] completeness: ${completenessScore.toFixed(2)}`)
        return {
          action: 'next_base',
          question: sanitizeQuestion(parsed.question ?? nextBaseQuestion ?? ''),
          nextBaseIndex: nextIndex,
        }
      }
    }
  }

  // NEW: Add warning when LLM call fails and fallback triggers
  console.log(`[warning] LLM call failed, using heuristic decision — check API key/timeout`)
  console.log(`[engine decision: heuristic fallback] completeness: ${completenessScore.toFixed(2)}`)
  return heuristicNextStep(params, candidateStyle)
}

// parsing helper is in ./parse-step for unit tests
