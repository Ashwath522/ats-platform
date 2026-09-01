type Parsed = { action?: string; question?: string } | null

export function parseStepResponse(raw: string): Parsed {
  try {
    // Try direct parse first
    let parsedObj: Record<string, unknown> | null = null
    try {
      parsedObj = JSON.parse(raw)
    } catch {
      // Attempt to extract first JSON object substring from model output
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          parsedObj = JSON.parse(match[0])
        } catch {
          parsedObj = null
        }
      }
    }
    const parsed = parsedObj as { action?: string; question?: string }
    const question = parsed.question?.trim()
    if (!question || question.length < 8) return null

    if (parsed.action === 'follow_up') {
      return { action: 'follow_up', question: question }
    }
    if (parsed.action === 'next_base') {
      return { action: 'next_base', question: question }
    }
  } catch {
    // fall through
  }
  return null
}

export function sanitizeQuestion(question: string): string {
  return question
    .replace(/^['"]|['"]$/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
