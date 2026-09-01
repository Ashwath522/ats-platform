export type RiskFactors = {
  behavioralAnomaly: number // 0-100
  engagementDrop: number // 0-100
  concernSignals: number // 0-100
  consistencyIssues: number // 0-100
}

export type RiskScore = {
  overall: number // 0-100, higher is higher risk
  level: 'low' | 'medium' | 'high'
  factors: RiskFactors
  reasoning: string[]
}

export function calculateRiskScore(
  behavioralScore: number, // 0-100, higher is better behavior
  anomalyCount: number, // number of detected anomalies
  signalDeviation: number // percentage deviation from baseline
): RiskScore {
  const factors: RiskFactors = {
    behavioralAnomaly: Math.min(100, anomalyCount * 15),
    engagementDrop: Math.max(0, 100 - behavioralScore),
    concernSignals: Math.min(100, Math.abs(signalDeviation) * 0.5),
    consistencyIssues: 0, // Would be calculated from more signals in production
  }

  // Weighted average: behavioral anomaly (40%), engagement (30%), concerns (20%), consistency (10%)
  const overall = Math.round(
    (factors.behavioralAnomaly * 0.4 +
      factors.engagementDrop * 0.3 +
      factors.concernSignals * 0.2 +
      factors.consistencyIssues * 0.1) /
      1
  )

  let level: 'low' | 'medium' | 'high' = 'low'
  if (overall >= 60) {
    level = 'high'
  } else if (overall >= 40) {
    level = 'medium'
  }

  const reasoning: string[] = []

  if (factors.behavioralAnomaly > 30) {
    reasoning.push('Significant behavioral anomalies detected during interview')
  }
  if (behavioralScore < 40) {
    reasoning.push('Low engagement and behavioral signals throughout interview')
  }
  if (signalDeviation > 50) {
    reasoning.push('Major deviation from baseline behavior detected')
  }
  if (anomalyCount === 0 && behavioralScore > 75) {
    reasoning.push('Consistent, positive behavioral signals')
  }

  return {
    overall,
    level,
    factors,
    reasoning: reasoning.length > 0 ? reasoning : ['Behavioral assessment complete'],
  }
}

// Evidence-based decision support (NOT automatic rejection)
export function generateDecisionContext(
  behavioralScore: number,
  riskLevel: 'low' | 'medium' | 'high',
  interviewDuration: number
): string[] {
  const context: string[] = []

  if (interviewDuration < 600) {
    context.push('Interview was relatively brief - consider conducting follow-up')
  }

  if (riskLevel === 'high') {
    context.push('Note: This candidate shows risk factors that warrant human review')
    context.push('Consider requesting clarification on areas of concern')
  }

  if (behavioralScore > 80) {
    context.push('Candidate demonstrated strong engagement and confidence')
  }

  context.push('Remember: Behavioral signals support human decision-making, not replace it')
  context.push('Final hiring decision remains with the recruiter')

  return context
}
