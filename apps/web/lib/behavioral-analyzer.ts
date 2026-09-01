export type BehavioralSignal = {
  type: 'attention' | 'engagement' | 'confidence' | 'concern' | 'clarity'
  value: number
  timestamp: number
}

export type BehavioralAnalysis = {
  overallScore: number
  signals: BehavioralSignal[]
  riskLevel: 'low' | 'medium' | 'high'
  anomalies: string[]
  recommendations: string[]
}

// Simulated behavioral analyzer - in production, this would use ML models
export function analyzeBehavioralSignals(
  signals: BehavioralSignal[],
  baseline?: BehavioralSignal[]
): BehavioralAnalysis {
  if (signals.length === 0) {
    return {
      overallScore: 0,
      signals: [],
      riskLevel: 'low',
      anomalies: [],
      recommendations: [],
    }
  }

  // Calculate average signal value
  const avgValue = signals.reduce((sum, s) => sum + s.value, 0) / signals.length

  // Detect anomalies (signals that deviate significantly from baseline or average)
  const anomalies: string[] = []
  if (baseline && baseline.length > 0) {
    const baselineAvg = baseline.reduce((sum, s) => sum + s.value, 0) / baseline.length
    const deviation = Math.abs(avgValue - baselineAvg)
    if (deviation > 30) {
      anomalies.push(`Significant behavioral deviation from baseline (+${deviation.toFixed(0)}%)`)
    }
  }

  // Detect concern signals
  const concernSignals = signals.filter((s) => s.type === 'concern')
  if (concernSignals.length > signals.length * 0.3) {
    anomalies.push('Elevated concern signals detected')
  }

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low'
  if (avgValue < 40) {
    riskLevel = 'high'
  } else if (avgValue < 60) {
    riskLevel = 'medium'
  }

  // Generate recommendations
  const recommendations: string[] = []
  if (riskLevel === 'high') {
    recommendations.push('Consider additional assessment or clarification questions')
    recommendations.push('Review interview recording for context')
  }
  if (concernSignals.length > 0) {
    recommendations.push('Investigate areas of concern more deeply')
  }
  if (avgValue > 85) {
    recommendations.push('Strong engagement signals - candidate demonstrated confidence')
  }

  // Round overall score
  const overallScore = Math.round(avgValue)

  return {
    overallScore,
    signals,
    riskLevel,
    anomalies,
    recommendations,
  }
}

// Baseline capture - collect initial behavioral data
export function createBaseline(signals: BehavioralSignal[]): BehavioralSignal[] {
  // In production, this would use multiple ML models to ensure stability
  // For now, we just return the raw signals as the baseline
  return signals
}

// Compare current behavior to baseline
export function compareToBaseline(
  currentSignals: BehavioralSignal[],
  baseline: BehavioralSignal[]
): {
  similarity: number
  deviations: Array<{ signal: BehavioralSignal; baselineValue: number; delta: number }>
} {
  const avgBaseline = baseline.reduce((sum, s) => sum + s.value, 0) / baseline.length
  const avgCurrent = currentSignals.reduce((sum, s) => sum + s.value, 0) / currentSignals.length

  const similarity = Math.max(0, 100 - Math.abs(avgCurrent - avgBaseline))

  const deviations = currentSignals
    .map((signal) => {
      const baselineValue = avgBaseline
      return {
        signal,
        baselineValue,
        delta: signal.value - baselineValue,
      }
    })
    .filter((d) => Math.abs(d.delta) > 20)

  return { similarity, deviations }
}
