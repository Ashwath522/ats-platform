import { describe, it, expect } from 'vitest'
import { calculateRiskScore } from '../risk-engine'
import type { ProctoringEvent } from '../risk-engine'

const now = Date.now()

describe('risk engine', () => {
  it('single phoneDetected is medium', () => {
    const res = calculateRiskScore({ events: [], currentSignals: { phoneDetected: true } })
    expect(res.level).toBe('medium')
  })

  it('two phone events within 60s can reach high when weighted', () => {
    const events: ProctoringEvent[] = [
      { type: 'phone_detected', severity: 'high', metadata: {}, timestamp: new Date(now - 1000).toISOString() },
      { type: 'phone_detected', severity: 'high', metadata: {}, timestamp: new Date(now - 2000).toISOString() },
    ]
    const res = calculateRiskScore({ events, currentSignals: { phoneDetected: true } })
    expect(res.level).toBe('high')
  })

  it('multiple concern signals can reach high without phone/spoof', () => {
    const res = calculateRiskScore({ events: [], currentSignals: { faceLeftFrame: true, darkLighting: true, multipleFaces: true } })
    expect(res.level).toBe('high')
  })

  it('clean session remains low', () => {
    const res = calculateRiskScore({ events: [], currentSignals: { continuousFaceVisible: true, goodLighting: true } })
    expect(res.level).toBe('low')
  })
})
