import { describe, it, expect } from 'vitest'
import { parseStepResponse } from '../parse-step'

describe('parseStepResponse', () => {
  it('parses well-formed JSON', () => {
    const raw = JSON.stringify({ action: 'follow_up', question: 'Can you explain one concrete example?' })
    const parsed = parseStepResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.action).toBe('follow_up')
  })

  it('parses JSON inside markdown fences', () => {
    const raw = "Here is the response:\n```json\n{\"action\":\"next_base\",\"question\":\"What would you change?\"}\n```"
    const parsed = parseStepResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.action).toBe('next_base')
  })

  it('returns null for unparseable content', () => {
    const raw = 'I cannot answer that.'
    const parsed = parseStepResponse(raw)
    expect(parsed).toBeNull()
  })
})
