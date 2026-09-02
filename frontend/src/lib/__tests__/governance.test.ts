import { describe, it, expect } from 'vitest'

describe('Candidate Governance & Proctoring Consent', () => {
  it('validates pre-interview consent requirements', () => {
    const isConsentGiven = (checkboxChecked: boolean) => checkboxChecked === true
    expect(isConsentGiven(false)).toBe(false)
    expect(isConsentGiven(true)).toBe(true)
  })

  it('determines data retention purge eligibility correctly', () => {
    const isExpired = (appliedAt: string, retentionDays: number = 30, now: number = Date.now()) => {
      const appTime = new Date(appliedAt).getTime()
      const diffDays = (now - appTime) / (1000 * 60 * 60 * 24)
      return diffDays > retentionDays
    }

    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

    expect(isExpired(oldDate, 30)).toBe(true)
    expect(isExpired(recentDate, 30)).toBe(false)
  })
})
