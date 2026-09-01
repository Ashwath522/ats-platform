import { describe, it, expect } from 'vitest'
import { canCandidateJoinInterview } from '../interview-access'

describe('canCandidateJoinInterview', () => {
  it('allows join within window for scheduled interview', () => {
    const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString() // 1 minute from now
    const res = canCandidateJoinInterview({ status: 'scheduled', scheduledAt, durationMinutes: 30, now: Date.now() })
    expect(res.allowed).toBe(true)
    expect(res.inTimeWindow).toBe(true)
  })

  it('denies join before window opens', () => {
    const scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes from now
    const res = canCandidateJoinInterview({ status: 'scheduled', scheduledAt, durationMinutes: 30, now: Date.now() })
    expect(res.allowed).toBe(false)
    expect(res.reason).toBe('Interview is outside the join window')
  })

  it('denies join after window closes', () => {
    const scheduledAt = new Date(Date.now() - 120 * 60 * 1000).toISOString() // 120 minutes ago
    const res = canCandidateJoinInterview({ status: 'scheduled', scheduledAt, durationMinutes: 30, now: Date.now() })
    expect(res.allowed).toBe(false)
    expect(res.inTimeWindow).toBe(false)
  })

  it('denies join for completed interview', () => {
    const scheduledAt = new Date().toISOString()
    const res = canCandidateJoinInterview({ status: 'completed', scheduledAt, durationMinutes: 30, now: Date.now() })
    expect(res.allowed).toBe(false)
    expect(res.reason).toBe('This interview is already completed')
  })
})
