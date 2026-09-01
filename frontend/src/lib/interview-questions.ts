export type InterviewQuestion = {
  question: string
  expectedPoints?: string[]
}

export type QuestionSet = {
  mode: 'ai' | 'custom'
  questions: InterviewQuestion[]
}

type JdSignals = {
  skills: string[]
  responsibilities: string[]
  requirements: string[]
  topRequirement: string
  themes: string[]
}

const SKILL_PATTERN =
  /\b(?:React|Next\.?js|Node\.?js|Python|Java(?:Script)?|TypeScript|AWS|GCP|Azure|SQL|PostgreSQL|MongoDB|Redis|Docker|Kubernetes|Terraform|GraphQL|REST|API|CI\/CD|Agile|Scrum|Figma|UX|UI|machine learning|ML|AI|data (?:engineering|analysis|pipeline)|ETL|Spark|Kafka|Salesforce|SAP|Excel|Tableau|Power BI|stakeholder management|cross-functional|leadership|communication|analytics|security|compliance|SaaS|B2B|microservices|system design|performance optimization|testing|QA|DevOps|mobile|iOS|Android|Swift|Kotlin|Go|Rust|C\+\+|\.NET|Ruby|Rails|PHP|Laravel|Vue|Angular|Svelte|Tailwind|CSS|HTML|accessibility|WCAG|WebRTC|design systems?)\b/gi

const WEAK_SKILL_TOKENS = new Set(['ai', 'ml', 'ux', 'ui', 'api', 'saas', 'b2b'])

function uniquePreserveCase(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

function normalizeRequirementLine(line: string): string {
  return line
    .replace(/^\d+\+?\s*years?\s*(?:of\s*)?(?:experience\s*)?(?:with|in|building|using)?\s*/i, '')
    .replace(/^(?:strong|deep|solid|proven|hands-on)\s+/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJdSignals(jobTitle: string, description: string): JdSignals {
  const text = description.trim()
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  let currentSection = 'general'
  const requirements: string[] = []
  const responsibilities: string[] = []

  for (const line of lines) {
    if (/^requirements?\s*:?\s*$/i.test(line)) {
      currentSection = 'requirements'
      continue
    }
    if (/^responsibilit(?:y|ies)\s*:?\s*$/i.test(line)) {
      currentSection = 'responsibilities'
      continue
    }

    if (/^[-•*]|\d+[.)]\s/.test(line)) {
      const bullet = line.replace(/^[-•*]\s*|\d+[.)]\s*/, '').trim()
      if (bullet.length < 12) continue
      if (currentSection === 'requirements') requirements.push(bullet)
      else if (currentSection === 'responsibilities') responsibilities.push(bullet)
    }
  }

  const skillMatches = uniquePreserveCase((text.match(SKILL_PATTERN) ?? []).map((s) => s.trim()))
  const prioritizedSkills = skillMatches.sort((a, b) => {
    const aWeak = WEAK_SKILL_TOKENS.has(a.toLowerCase()) ? 1 : 0
    const bWeak = WEAK_SKILL_TOKENS.has(b.toLowerCase()) ? 1 : 0
    return aWeak - bWeak
  })

  const requirementThemes = requirements
    .map(normalizeRequirementLine)
    .filter((line) => line.length > 3 && line.length < 90)

  const fallbackResponsibilities = lines
    .filter((line) => line.length > 20 && !/^requirements?|^responsibilit|^we are|^about/i.test(line))
    .slice(0, 4)

  const resolvedResponsibilities =
    responsibilities.length > 0 ? responsibilities.slice(0, 5) : fallbackResponsibilities

  const themes = uniquePreserveCase([...prioritizedSkills, ...requirementThemes]).slice(0, 6)
  const topRequirement = resolvedResponsibilities[0] ?? requirementThemes[0] ?? jobTitle

  return {
    skills: prioritizedSkills.slice(0, 5),
    responsibilities: resolvedResponsibilities,
    requirements: requirementThemes,
    topRequirement: topRequirement.slice(0, 160),
    themes,
  }
}

function pickSkill(themes: string[], index: number, fallback: string): string {
  return themes[index] ?? themes[0] ?? fallback
}

function shortenPhrase(text: string, maxWords = 6): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(and|or|the|a|an)\s+/i, '')

  const words = clean.split(/\s+/).slice(0, maxWords)
  let result = words.join(' ')

  result = result.replace(/[,:;–—-]+$/, '').trim()

  if (result && !/^[A-Z]{2,}/.test(result)) {
    result = result.charAt(0).toLowerCase() + result.slice(1)
  }
  return result
}

function spokenQuestion(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function toGerundPhrase(text: string, maxWords = 6): string {
  const short = shortenPhrase(text, maxWords)
  const [first, ...rest] = short.split(/\s+/)
  const verb = (first ?? '').toLowerCase()

  const gerunds: Record<string, string> = {
    own: 'owning',
    improve: 'improving',
    partner: 'partnering',
    lead: 'leading',
    build: 'building',
    develop: 'developing',
    manage: 'managing',
    drive: 'driving',
    deliver: 'delivering',
    design: 'designing',
    implement: 'implementing',
    optimize: 'optimizing',
    collaborate: 'collaborating',
    maintain: 'maintaining',
    scale: 'scaling',
    present: 'presenting',
    define: 'defining',
    prioritize: 'prioritizing',
    conduct: 'conducting',
    work: 'working',
  }

  if (gerunds[verb]) {
    return `${gerunds[verb]} ${rest.join(' ')}`.trim()
  }
  return short
}


function responsibilityTopic(text: string): string {
  const firstClause = text.split(/\s+(?:and|or|,)\s+/i)[0] ?? text
  return toGerundPhrase(firstClause, 5)
}

export function generateAiQuestions(jobTitle: string, description: string): InterviewQuestion[] {
  const role = jobTitle.trim() || 'this role'
  const context = description.trim()
  const jd = extractJdSignals(role, context)
  const skillA = pickSkill(jd.themes, 0, 'the primary tools for this role')
  const skillB = pickSkill(jd.themes, 1, skillA)
  const skillC = pickSkill(jd.themes, 2, skillB)
  const respA = jd.responsibilities[0] ?? jd.requirements[0] ?? `key deliverables as a ${role}`
  const respB = jd.responsibilities[1] ?? jd.requirements[1] ?? jd.topRequirement
  const topReq = shortenPhrase(jd.topRequirement, 110 / 4)

  const questions: InterviewQuestion[] = [
    {
      question: spokenQuestion(
        context
          ? `Before we dive in, what specifically interested you about this ${role} role, especially the work involving ${skillA}?`
          : `Before we dive in, what specifically interested you about this ${role} opportunity?`,
      ),
      expectedPoints: ['role motivation', 'JD alignment', skillA],
    },
    {
      question: spokenQuestion(
        `Walk me through a project where you used ${skillA} to support ${responsibilityTopic(respA)}.`,
      ),
      expectedPoints: [skillA, 'concrete example', respA],
    },
    {
      question: spokenQuestion(
        jd.responsibilities.length > 1
          ? `Tell me about a time you focused on ${responsibilityTopic(respB)} — what was your approach and what changed because of your work?`
          : `Tell me about a time you applied ${skillB} under real delivery pressure — what was your approach and what changed because of your work?`,
      ),
      expectedPoints: [skillB, 'approach', 'impact'],
    },
    {
      question: spokenQuestion(
        `Imagine you're three weeks into this ${role} role and ${responsibilityTopic(topReq)} is at risk — how would you diagnose the issue and what would you do first?`,
      ),
      expectedPoints: ['problem-solving', 'prioritization', topReq],
    },
    {
      question: spokenQuestion(
        `Give me an example where ${skillC} created a tradeoff with speed, quality, or stakeholders — how did you decide?`,
      ),
      expectedPoints: ['tradeoffs', 'decision-making', skillC],
    },
    {
      question: spokenQuestion(
        `I'd like to go deeper on ${responsibilityTopic(topReq)} — describe the most complex situation you've handled in this area and how you measured success.`,
      ),
      expectedPoints: ['depth', topReq, 'metrics'],
    },
    {
      question: spokenQuestion(
        `Looking at this ${role} position and the emphasis on ${skillA}, what's one meaningful outcome you'd want to deliver in your first 60 days?`,
      ),
      expectedPoints: ['priorities', 'ownership', 'reflection'],
    },
  ]

  if (jd.responsibilities.length >= 3) {
    const respC = jd.responsibilities[2]
    questions.splice(4, 0, {
      question: spokenQuestion(
        `Describe a situation where ${responsibilityTopic(respC)} was unclear or blocked — what did you do?`,
      ),
      expectedPoints: ['scenario', respC, 'judgment'],
    })
  }

  return questions.slice(0, 8)
}

function lightCleanQuestion(raw: string): string {
  let question = raw.trim().replace(/\s+/g, ' ')
  if (!question) return question

  question = question.charAt(0).toUpperCase() + question.slice(1)
  if (!/[?.!]$/.test(question)) {
    question += '?'
  }
  return question
}

export function parseCustomQuestions(raw: string): InterviewQuestion[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [question, ...points] = line.split('|').map((part) => part.trim())
      return {
        question: lightCleanQuestion(question),
        expectedPoints: points.length ? points : undefined,
      }
    })
}
