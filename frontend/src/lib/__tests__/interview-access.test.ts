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

import { canTakeInterview } from '../interview-access'

describe('canTakeInterview Gatekeeper', () => {
  it('denies interview if application is still in ats_check', () => {
    const res = canTakeInterview({ status: 'ats_check', repo_match_score: null })
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('must be shortlisted')
  })

  it('denies interview if shortlisted but repo verification is incomplete', () => {
    const res = canTakeInterview({ status: 'shortlisted', repo_match_score: null, project_score: null })
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('must complete Repo / Project Verification')
  })

  it('allows interview after shortlist and repo verification complete', () => {
    const res = canTakeInterview({ status: 'shortlisted', repo_match_score: 85 })
    expect(res.allowed).toBe(true)
    expect(res.reason).toContain('unlocked')
  })
})

