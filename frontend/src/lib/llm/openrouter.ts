const DEFAULT_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const TIMEOUT_MS = 8000

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function stripReasoning(content: string): string {
  let cleaned = content.replace(/[\s\S]*?<\/think>/gi, '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return cleaned
}

function extractContent(data: Record<string, unknown>): string {
  const choices = data.choices as Array<{ message?: Record<string, unknown> }> | undefined
  const message = choices?.[0]?.message
  if (!message) return ''

  const content = message.content
  if (typeof content === 'string' && content.trim()) {
    return stripReasoning(content)
  }

  // Reasoning models may put the answer in reasoning; take trailing JSON if present
  const reasoning = message.reasoning
  if (typeof reasoning === 'string') {
    const jsonMatch = reasoning.match(/\{[\s\S]*"action"[\s\S]*\}/)
    if (jsonMatch) return jsonMatch[0]
    return stripReasoning(reasoning)
  }

  return ''
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string | null> {
  const env = import.meta.env
  const apiKey = env.VITE_OPENROUTER_API_KEY || (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : undefined)
  if (!apiKey) return null

  const rawBaseUrl = env.VITE_OPENROUTER_BASE_URL || (typeof process !== 'undefined' ? process.env?.OPENROUTER_BASE_URL : undefined) || DEFAULT_BASE_URL
  const baseUrl = rawBaseUrl.replace(/\/$/, '')
  const model = env.VITE_OPENROUTER_MODEL || (typeof process !== 'undefined' ? process.env?.OPENROUTER_MODEL : undefined) || DEFAULT_MODEL

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  const referer = env.VITE_OPENROUTER_HTTP_REFERER || (typeof process !== 'undefined' ? process.env?.OPENROUTER_HTTP_REFERER : undefined)
  if (referer) {
    headers['HTTP-Referer'] = referer
  }
  const title = env.VITE_OPENROUTER_X_TITLE || (typeof process !== 'undefined' ? process.env?.OPENROUTER_X_TITLE : undefined)
  if (title) {
    headers['X-Title'] = title
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 120,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('OpenRouter request failed:', res.status, errText.slice(0, 200))
      return null
    }

    const data = (await res.json()) as Record<string, unknown>
    const content = extractContent(data)
    if (content) console.error('[OpenRouter] LLM call succeeded')
    return content || null
  } catch (error) {
    console.error('OpenRouter request error:', error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}
